import { randomUUID } from 'node:crypto';
import { LoggerService } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { comoOwner, mudarPapelComoOwner } from './acesso-owner';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';
import { CLIENTE_API } from './cliente-api';

const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `${n}-${sufixo}@teste.local`;
const SENHA = 'senha-forte-123';

let app: NestExpressApplication;
const criadas: string[] = [];

type Cadastro = { clinicaId: string; psicologoId: string; email: string };

async function cadastrar(n: string, extra: object = {}): Promise<Cadastro> {
  const res = await request(app.getHttpServer())
    .post('/clinicas')
    .set(CLIENTE_API)
    .send(corpoClinica(email(n), { senha: SENHA, ...extra }))
    .expect(201);
  const body = res.body as Cadastro;
  criadas.push(body.clinicaId);
  return { ...body, email: email(n) };
}

function login(emailLogin: string, senha = SENHA) {
  return request(app.getHttpServer())
    .post('/auth/login')
    .set(CLIENTE_API)
    .send({ email: emailLogin, senha });
}

async function tokenDe(c: Cadastro) {
  const res = await login(c.email).expect(200);
  return (res.body as { token: string }).token;
}

function decodificar(parte: string) {
  return JSON.parse(Buffer.from(parte, 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

const eu = (token?: string) => {
  const r = request(app.getHttpServer()).get('/eu');
  return token === undefined ? r : r.set('Authorization', `Bearer ${token}`);
};

let a: Cadastro;
let b: Cadastro;

beforeAll(async () => {
  app = await criarAppSemLimite();
  a = await cadastrar('a', {
    nomeClinica: 'Clinica A',
    abordagemPadrao: 'ACT',
  });
  b = await cadastrar('b', { nomeClinica: 'Clinica B' });
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

afterEach(() => jest.restoreAllMocks());

describe('POST /auth/login', () => {
  it('200 com JWT HS256, exp - iat = 15 min, claims sub, clinicaId, tv e sid; corpo {usuario, token}', async () => {
    const res = await login(a.email).expect(200);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'token',
      'usuario',
    ]);
    const [h, p] = (res.body as { token: string }).token.split('.');
    expect(decodificar(h).alg).toBe('HS256');
    const payload = decodificar(p);
    expect(payload.sub).toBe(a.psicologoId);
    expect(payload.clinicaId).toBe(a.clinicaId);
    expect(payload.tv).toBe(0);
    expect((payload.exp as number) - (payload.iat as number)).toBe(900);
    expect(payload.sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.papel).toBeUndefined();
  });

  it('e-mail com caixa e espacos diferentes loga', async () => {
    await login(`  ${a.email.toUpperCase()} `).expect(200);
  });

  it('senha errada e e-mail inexistente: mesmo status e MESMO corpo', async () => {
    const errada = await login(a.email, 'senha-errada-999');
    const inexistente = await login(email('ninguem'));
    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(errada.body).toEqual(inexistente.body);
    expect(errada.body).toMatchObject({
      statusCode: 401,
      message: 'Credenciais invalidas',
    });
  });

  it('bcrypt.compare roda tambem para e-mail inexistente (hash falso, custo 12)', async () => {
    const spy = jest.spyOn(bcrypt, 'compare');
    await login(email('fantasma')).expect(401);
    expect(spy).toHaveBeenCalledTimes(1);
    const hash = spy.mock.calls[0][1];
    expect(bcrypt.getRounds(hash)).toBe(12);
  });

  it('campo extra e senha de 73 bytes -> 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: a.email, senha: SENHA, extra: 1 })
      .expect(400);
    await login(a.email, 'a'.repeat(73)).expect(400);
  });
});

describe('GET /eu e JwtAuthGuard', () => {
  it('token valido -> 200 com os dados do contrato', async () => {
    const res = await eu(await tokenDe(a)).expect(200);
    expect(res.body).toEqual({
      psicologoId: a.psicologoId,
      nome: 'Ana Teste',
      email: a.email,
      papel: 'ADMIN',
      abordagemPadrao: 'ACT',
      senhaProvisoria: false,
      clinica: { id: a.clinicaId, nome: 'Clinica A' },
    });
  });

  it('todos os tokens invalidos -> 401 com o MESMO corpo generico', async () => {
    const segredo = process.env.NOTTA_JWT_SECRET!;
    const jwt = new JwtService({ secret: segredo });
    const outro = new JwtService({ secret: 'outro-segredo-'.repeat(4) });
    const agora = Math.floor(Date.now() / 1000);
    // `sid` de uma sessao REAL do `a`: so assim cada caso abaixo falha pelo motivo que o nome diz.
    const { sid } = jwt.decode<{ sid: string }>(await tokenDe(a));
    const claims = { sub: a.psicologoId, clinicaId: a.clinicaId, tv: 0, sid };
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');

    const casos: [string, string | undefined][] = [
      ['sem header', undefined],
      ['Bearer lixo', 'lixo'],
      [
        'alg none',
        `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, iat: agora, exp: agora + 600 })}.`,
      ],
      ['HS512', jwt.sign(claims, { algorithm: 'HS512', expiresIn: '1h' })],
      [
        'outro segredo',
        outro.sign(claims, { algorithm: 'HS256', expiresIn: '1h' }),
      ],
      [
        'expirado',
        jwt.sign(
          { ...claims, iat: agora - 7200, exp: agora - 3600 },
          { algorithm: 'HS256' },
        ),
      ],
      ['sem exp', jwt.sign(claims, { algorithm: 'HS256' })],
      [
        'sem tv',
        jwt.sign(
          { sub: a.psicologoId, clinicaId: a.clinicaId, sid },
          { algorithm: 'HS256', expiresIn: '1h' },
        ),
      ],
      [
        'sem sid',
        jwt.sign(
          { sub: a.psicologoId, clinicaId: a.clinicaId, tv: 0 },
          { algorithm: 'HS256', expiresIn: '1h' },
        ),
      ],
      [
        'sid de sessao que nao existe',
        jwt.sign(
          { ...claims, sid: randomUUID() },
          { algorithm: 'HS256', expiresIn: '1h' },
        ),
      ],
      [
        'tv desatualizado',
        jwt.sign({ ...claims, tv: 1 }, { algorithm: 'HS256', expiresIn: '1h' }),
      ],
      [
        'clinicaId de outra clinica com sub valido',
        jwt.sign(
          { sub: a.psicologoId, clinicaId: b.clinicaId, sid },
          { algorithm: 'HS256', expiresIn: '1h' },
        ),
      ],
      [
        'sub nao-UUID',
        jwt.sign(
          { sub: 'nao-uuid', clinicaId: a.clinicaId, sid },
          { algorithm: 'HS256', expiresIn: '1h' },
        ),
      ],
      [
        'clinicaId nao-UUID',
        jwt.sign(
          { sub: a.psicologoId, clinicaId: 'x', sid },
          { algorithm: 'HS256', expiresIn: '1h' },
        ),
      ],
    ];

    const referencia = (await eu().expect(401)).body as object;
    expect(referencia).toEqual({ statusCode: 401, message: 'Unauthorized' });
    for (const [nome, token] of casos) {
      const res = await eu(token);
      expect({ nome, status: res.status }).toEqual({ nome, status: 401 });
      expect(res.body).toEqual(referencia);
    }
    // controle: o mesmo jeito de assinar, com claims certos, passa
    await eu(jwt.sign(claims, { algorithm: 'HS256', expiresIn: '1h' })).expect(
      200,
    );
  });

  it('psicologo apagado depois do login -> 401', async () => {
    const c = await cadastrar('apagado');
    const token = await tokenDe(c);
    await eu(token).expect(200);
    // Sessao tem FK RESTRICT para Psicologo: sai antes.
    await comoOwner(
      c.clinicaId,
      async (tx) => {
        await tx.sessao.deleteMany({ where: { psicologoId: c.psicologoId } });
        await tx.psicologo.deleteMany({
          where: { id: c.psicologoId, clinicaId: c.clinicaId },
        });
      },
      { psicologoId: c.psicologoId },
    );
    await eu(token).expect(401);
  });

  it('papel mudado no banco aparece no proximo /eu (sem novo login)', async () => {
    const c = await cadastrar('papel');
    const token = await tokenDe(c);
    expect((await eu(token).expect(200)).body).toMatchObject({
      papel: 'ADMIN',
    });
    await mudarPapelComoOwner(c.clinicaId, c.psicologoId, 'PSICOLOGO');
    expect((await eu(token).expect(200)).body).toMatchObject({
      papel: 'PSICOLOGO',
    });
  });

  it('/saude continua publica', async () => {
    await request(app.getHttpServer()).get('/saude').expect(200);
  });
});

describe('logs', () => {
  it('nenhum log contem senha, token ou hash (fluxos ok e com falha)', async () => {
    const linhas: string[] = [];
    const guardar = (...args: unknown[]) => {
      linhas.push(
        args
          .map((x) =>
            x instanceof Error ? `${x.message} ${x.stack}` : JSON.stringify(x),
          )
          .join(' '),
      );
    };
    const logger: LoggerService = {
      log: guardar,
      error: guardar,
      warn: guardar,
      debug: guardar,
      verbose: guardar,
      fatal: guardar,
    };
    const saida = [
      jest.spyOn(process.stdout, 'write'),
      jest.spyOn(process.stderr, 'write'),
    ];
    const appLog = await criarAppSemLimite({ logger });
    const http = appLog.getHttpServer();
    // Forte e sem o e-mail/nome dentro (a politica do item 45 recusa senha com a parte local).
    const senha = `tijolo-azul-${sufixo}`;
    const fraca = 'Senha1234!';
    const e = email('log');
    try {
      const cad = await request(http)
        .post('/clinicas')
        .set(CLIENTE_API)
        .send(corpoClinica(e, { senha }))
        .expect(201);
      criadas.push((cad.body as { clinicaId: string }).clinicaId);
      await request(http)
        .post('/clinicas')
        .set(CLIENTE_API)
        .send(corpoClinica(e, { senha }))
        .expect(409);
      await request(http)
        .post('/clinicas')
        .set(CLIENTE_API)
        .send(corpoClinica(email('log2'), { senha: 'a'.repeat(80) }))
        .expect(400);
      const ok = await request(http)
        .post('/auth/login')
        .set(CLIENTE_API)
        .send({ email: e, senha })
        .expect(200);
      const token = (ok.body as { token: string }).token;
      await request(http)
        .post('/auth/login')
        .set(CLIENTE_API)
        .send({ email: e, senha: `${senha}-errada` })
        .expect(401);
      await request(http)
        .get('/eu')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(http)
        .get('/eu')
        .set('Authorization', `Bearer ${token}x`)
        .expect(401);
      // senha fraca (item 45): 422 e a senha, mesmo recusada, nao vai a nenhum log
      await request(http)
        .post('/clinicas')
        .set(CLIENTE_API)
        .send(corpoClinica(email('log4'), { senha: fraca }))
        .expect(422);
      // erro inesperado no cadastro (vira 500)
      jest
        .spyOn(appLog.get(TenantPrismaService), 'run')
        .mockRejectedValueOnce(new Error(`falha com ${senha}`));
      await request(http)
        .post('/clinicas')
        .set(CLIENTE_API)
        .send(corpoClinica(email('log3'), { senha }))
        .expect(500);

      const hash = await appLog
        .get(TenantPrismaService)
        .run((cad.body as { clinicaId: string }).clinicaId, (tx) =>
          tx.psicologo.findFirstOrThrow({ where: { email: e } }),
        )
        .then((p) => p.senhaHash);

      const tudo = [
        ...linhas,
        ...saida.flatMap((s) => s.mock.calls.map((c) => String(c[0]))),
      ].join('\n');
      // controle: a captura funciona (o erro do cadastro foi logado)
      expect(tudo).toContain('falha ao criar clinica');
      expect(tudo).not.toContain(senha);
      expect(tudo).not.toContain(fraca);
      expect(tudo).not.toContain(token);
      expect(tudo).not.toContain(token.split('.')[2]);
      expect(tudo).not.toContain(hash);
      expect(tudo).not.toContain('$2');
    } finally {
      await appLog.close();
    }
  });
});

describe('boot', () => {
  const original = process.env.NOTTA_JWT_SECRET;
  afterEach(() => {
    process.env.NOTTA_JWT_SECRET = original;
  });

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['curta (31)', 'x'.repeat(31)],
    [
      'valor do .env.example antigo',
      'troque-isto-por-um-segredo-longo-e-aleatorio-fake',
    ],
    ['baixa entropia (64 iguais)', 'y'.repeat(64)],
    [
      'valor do .env.example antigo com espaco e sufixo',
      ' troque-isto-por-um-segredo-longo-e-aleatorio-fake2',
    ],
    [
      'valor do .env.example antigo em maiusculas',
      'TROQUE-ISTO-POR-UM-SEGREDO-LONGO-E-ALEATORIO-FAKE',
    ],
    ['0123456789abcdef x2', '0123456789abcdef0123456789abcdef'],
    ['de tutorial', 'my-super-secret-jwt-key-for-production'],
    ['15 caracteres distintos', 'abcdefghijklmno'.repeat(4)],
  ])(
    'NOTTA_JWT_SECRET %s derruba o boot sem ecoar o valor',
    async (_n, valor) => {
      if (valor === undefined) delete process.env.NOTTA_JWT_SECRET;
      else process.env.NOTTA_JWT_SECRET = valor;
      let msg = '';
      try {
        const x = await criarApp();
        await x.close();
      } catch (err) {
        msg = (err as Error).message;
      }
      expect(msg).toMatch(/NOTTA_JWT_SECRET/);
      if (valor) expect(msg).not.toContain(valor);
    },
  );

  it('NOTTA_JWT_SECRET com 32 caracteres (16+ distintos) sobe', async () => {
    process.env.NOTTA_JWT_SECRET = 'abcdefghijklmnop'.repeat(2);
    const x = await criarApp();
    await x.close();
  });
});
