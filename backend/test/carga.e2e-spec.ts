import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';
import { portaoBcrypt } from './portao-bcrypt';
import { CLIENTE_API } from './cliente-api';

// Robustez sob carga: erro de infraestrutura NUNCA vira 401 (o front desloga no 401)
// e toda rota autenticada tem limite por psicologo (throttler `api`, 300/min).
const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `carga-${n}-${sufixo}@teste.local`;
const SENHA = 'senha-forte-123';
const criadas: string[] = [];
let tokens: string[] = [];

beforeAll(async () => {
  const setup = await criarAppSemLimite();
  const http = setup.getHttpServer();
  for (const n of ['a', 'b']) {
    const res = await request(http)
      .post('/clinicas')
      .set(CLIENTE_API)
      .send(corpoClinica(email(n), { senha: SENHA }))
      .expect(201);
    criadas.push((res.body as { clinicaId: string }).clinicaId);
    const login = await request(http)
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: email(n), senha: SENHA })
      .expect(200);
    tokens.push((login.body as { token: string }).token);
  }
  await setup.close();
});

afterAll(async () => {
  const limpar = await criarAppSemLimite();
  await apagarClinicas(limpar, criadas);
  await limpar.close();
  tokens = [];
});

// N GET /eu simultaneos por HTTP de verdade (servidor ouvindo numa porta).
async function rajada(app: NestExpressApplication, token: string, n: number) {
  if (!app.getHttpServer().listening) await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/eu`;
  const contagem: Record<number, number> = {};
  await Promise.all(
    Array.from({ length: n }, async () => {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await r.arrayBuffer();
      contagem[r.status] = (contagem[r.status] ?? 0) + 1;
    }),
  );
  return contagem;
}

describe('banco/pool fora: 503, nunca 401', () => {
  const falha = () =>
    Promise.reject(new Error('P2028 Unable to start a transaction'));
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await criarApp({
      tenant: { run: falha, runLogin: falha, runComoUsuario: falha },
    });
  });
  afterAll(() => app.close());

  it('token valido -> 503 corpo fixo + Retry-After 2, sem detalhe do erro', async () => {
    const token = await app.get(JwtService).signAsync({
      sub: randomUUID(),
      clinicaId: randomUUID(),
      tv: 0,
      sid: randomUUID(),
    });
    const res = await request(app.getHttpServer())
      .get('/eu')
      .set('Authorization', `Bearer ${token}`)
      .expect(503);
    expect(res.body).toEqual({
      statusCode: 503,
      message: 'Servico indisponivel',
    });
    expect(res.headers['retry-after']).toBe('2');
    expect(JSON.stringify(res.body)).not.toContain('P2028');
  });

  it('token invalido com banco fora continua 401', async () => {
    await request(app.getHttpServer())
      .get('/eu')
      .set('Authorization', 'Bearer lixo.lixo.lixo')
      .expect(401);
    await request(app.getHttpServer()).get('/eu').expect(401);
  });
});

describe('carga real (Postgres)', () => {
  it('300 GET /eu simultaneos: so 200, 429 ou 503; nenhum 401', async () => {
    const app = await criarApp();
    try {
      const c = await rajada(app, tokens[0], 300);
      expect(c[401]).toBeUndefined();
      expect(
        Object.keys(c).every((s) => ['200', '429', '503'].includes(s)),
      ).toBe(true);
      expect(c[200]).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});

describe('throttler api: 300/min por psicologo em rota autenticada', () => {
  it('301a do mesmo psicologo = 429 + Retry-After; outro psicologo e /saude seguem', async () => {
    const app = await criarApp();
    try {
      // Lotes de 4 (abaixo do teto de simultaneas) = 300 requisicoes.
      for (let lote = 0; lote < 75; lote++) {
        expect(await rajada(app, tokens[0], 4)).toEqual({ 200: 4 });
      }
      const http = app.getHttpServer();
      const res = await request(http)
        .get('/eu')
        .set('Authorization', `Bearer ${tokens[0]}`)
        .expect(429);
      expect(res.body).toEqual({
        statusCode: 429,
        message: 'Muitas tentativas. Tente mais tarde.',
      });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      // Conta o psicologo em TODA rota autenticada (nao por rota).
      await request(http)
        .get('/psicologos')
        .set('Authorization', `Bearer ${tokens[0]}`)
        .expect(429);
      await request(http)
        .get('/eu')
        .set('Authorization', `Bearer ${tokens[1]}`)
        .expect(200);
      await request(http).get('/saude').expect(200);
    } finally {
      await app.close();
    }
  });

  it('rota publica nao conta no api (login segue so com os proprios limites)', async () => {
    const app = await criarApp();
    try {
      const http = app.getHttpServer();
      // 25 /saude nao passam por limite nenhum.
      for (let i = 0; i < 25; i++)
        await request(http).get('/saude').expect(200);
      // Login: o 6o do mesmo e-mail ainda e o 429 do login-chave.
      for (let i = 0; i < 5; i++) {
        await request(http)
          .post('/auth/login')
          .set(CLIENTE_API)
          .send({ email: email('a'), senha: 'errada-123' })
          .expect(401);
      }
      await request(http)
        .post('/auth/login')
        .set(CLIENTE_API)
        .send({ email: email('a'), senha: 'errada-123' })
        .expect(429);
    } finally {
      await app.close();
    }
  });
});

// Tetos de hash (global 8 e 2 por IP/ /64), deterministicos: o bcrypt.compare das senhas
// `errada-123` fica preso num portao (test/portao-bcrypt.ts), entao quem passa pelos tetos
// segura a vaga ate o teste abrir e quem e recusado responde na hora. Sem sleep e sem supor
// quanto o bcrypt demora.
describe('tetos de hash (login)', () => {
  const proxy = process.env.NOTTA_TRUST_PROXY;
  afterEach(() => {
    jest.restoreAllMocks();
    if (proxy === undefined) delete process.env.NOTTA_TRUST_PROXY;
    else process.env.NOTTA_TRUST_PROXY = proxy;
  });

  async function subir(comProxy = false) {
    if (comProxy) process.env.NOTTA_TRUST_PROXY = '1'; // IP vem do X-Forwarded-For
    const app = await criarAppSemLimite();
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const login = async (em: string, senha: string, ip?: string) => {
      const r = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...CLIENTE_API,
          ...(ip && { 'X-Forwarded-For': ip }),
        },
        body: JSON.stringify({ email: em, senha }),
      });
      return {
        status: r.status,
        retry: r.headers.get('retry-after'),
        corpo: (await r.json()) as unknown,
      };
    };
    return { app, base, login };
  }

  const FIXO_503 = { statusCode: 503, message: 'Servico indisponivel' };

  it('12 logins do mesmo IP: so 2 fazem hash (teto por IP); os outros 10 = 503 + Retry-After 1', async () => {
    const portao = portaoBcrypt('errada-123');
    const { app, login } = await subir();
    try {
      const r = await portao.soltarDepoisDe(
        Array.from({ length: 12 }, (_, i) =>
          login(email(`ip${i}`), 'errada-123'),
        ),
        10,
      );
      expect(portao.presas()).toBe(2);
      expect(r.filter((x) => x.status === 401)).toHaveLength(2);
      const recusados = r.filter((x) => x.status === 503);
      expect(recusados).toHaveLength(10);
      for (const x of recusados) {
        expect(x.retry).toBe('1');
        expect(x.corpo).toEqual(FIXO_503);
      }
    } finally {
      portao.restaurar();
      await app.close();
    }
  });

  it('12 logins de IPs diferentes: so 8 fazem hash (teto global); os outros 4 = 503', async () => {
    const portao = portaoBcrypt('errada-123');
    const { app, login } = await subir(true);
    try {
      const r = await portao.soltarDepoisDe(
        Array.from({ length: 12 }, (_, i) =>
          login(email(`gl${i}`), 'errada-123', `198.51.100.${i + 1}`),
        ),
        4,
      );
      expect(portao.presas()).toBe(8);
      expect(r.filter((x) => x.status === 401)).toHaveLength(8);
      const recusados = r.filter((x) => x.status === 503);
      expect(recusados).toHaveLength(4);
      for (const x of recusados) expect(x.retry).toBe('1');
    } finally {
      portao.restaurar();
      await app.close();
    }
  });

  // M-3 da 2a revisao: um unico /64 nao ocupa as 8 vagas globais.
  it('20 logins de um /64 (IPv6 diferentes): so 2 fazem hash; outro IP loga (200) durante a rajada', async () => {
    const portao = portaoBcrypt('errada-123');
    const { app, login } = await subir(true);
    try {
      // 20 do mesmo /64 (4 primeiros grupos iguais) + 1 de outro IP com a senha certa.
      const rajada = Array.from({ length: 20 }, (_, i) =>
        login(email(`rj${i}`), 'errada-123', `2001:db8:1:2:${i + 1}::1`),
      );
      const outro = login(email('a'), SENHA, '198.51.100.7');
      // As 18 recusadas e o login do outro IP terminam sem o portao.
      const todas = await portao.soltarDepoisDe([...rajada, outro], 19);
      expect(portao.presas()).toBe(2);
      expect(todas[20].status).toBe(200);
      const doBloco = todas.slice(0, 20);
      expect(doBloco.filter((x) => x.status === 401)).toHaveLength(2);
      expect(doBloco.filter((x) => x.status === 503)).toHaveLength(18);
    } finally {
      portao.restaurar();
      await app.close();
    }
  });

  it('com 12 logins em andamento o event loop segue livre: /saude em < 500 ms (bcrypt real, no threadpool)', async () => {
    const { app, base, login } = await subir(true);
    try {
      const logins = Array.from({ length: 12 }, (_, i) =>
        login(email(`cpu${i}`), 'errada-123', `203.0.113.${i + 1}`),
      );
      const ts = performance.now();
      const saude = await fetch(`${base}/saude`);
      const msSaude = performance.now() - ts;
      const r = await Promise.all(logins);
      console.log(
        `carga: /saude ${Math.round(msSaude)} ms; status ${r.map((x) => x.status).join(',')}`,
      );
      expect(saude.status).toBe(200);
      expect(msSaude).toBeLessThan(500);
      // Nao supomos quantos passam (depende da velocidade): so que nada vira 500/401 de infra.
      expect(r.every((x) => [401, 503].includes(x.status))).toBe(true);
    } finally {
      await app.close();
    }
  });
});

// Pool/transacao esgotados DENTRO do handler (o guard ja passou): filtro global -> 503.
describe('P2028/P2024 no handler: 503, sem detalhe e sem log', () => {
  it.each(['P2028', 'P2024'])(
    '%s -> 503 fixo + Retry-After 2',
    async (code) => {
      const linhas: string[] = [];
      const guardar = (...args: unknown[]) => {
        linhas.push(args.map((x) => String(x)).join(' '));
      };
      const app = await criarApp({
        logger: {
          log: guardar,
          error: guardar,
          warn: guardar,
          debug: guardar,
          verbose: guardar,
          fatal: guardar,
        },
      });
      try {
        const tenant = app.get(TenantPrismaService);
        const run = tenant.run.bind(tenant);
        jest
          .spyOn(tenant, 'run')
          .mockImplementationOnce(run) // guard
          .mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError(
              `detalhe-secreto ${code}`,
              {
                code,
                clientVersion: 'x',
              },
            ),
          );
        const res = await request(app.getHttpServer())
          .get('/eu')
          .set('Authorization', `Bearer ${tokens[0]}`)
          .expect(503);
        expect(res.body).toEqual({
          statusCode: 503,
          message: 'Servico indisponivel',
        });
        expect(res.headers['retry-after']).toBe('2');
        expect(linhas.join('\n')).not.toMatch(/detalhe-secreto|stack|at /);
        // controle: outro erro do Prisma segue 500 (filtro nao engole tudo)
        jest
          .spyOn(tenant, 'run')
          .mockImplementationOnce(run)
          .mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError('x', {
              code: 'P2002',
              clientVersion: 'x',
            }),
          );
        await request(app.getHttpServer())
          .get('/eu')
          .set('Authorization', `Bearer ${tokens[0]}`)
          .expect(500);
      } finally {
        jest.restoreAllMocks();
        await app.close();
      }
    },
  );
});
