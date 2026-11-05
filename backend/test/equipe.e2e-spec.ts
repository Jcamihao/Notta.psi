import { randomUUID } from 'node:crypto';
import { LoggerService } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { comoOwner } from './acesso-owner';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';
import { CLIENTE_API } from './cliente-api';

const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `eq-${n}-${sufixo}@teste.local`;
const SENHA = 'senha-forte-123';
const FORBIDDEN = {
  statusCode: 403,
  message: 'Forbidden resource',
  error: 'Forbidden',
};

type Clinica = { clinicaId: string; adminId: string; token: string };

let app: NestExpressApplication;
const criadas: string[] = [];

async function login(e: string, senha = SENHA, a = app) {
  const res = await request(a.getHttpServer())
    .post('/auth/login')
    .set(CLIENTE_API)
    .send({ email: e, senha })
    .expect(200);
  return (res.body as { token: string }).token;
}

async function novaClinica(e: string, a = app): Promise<Clinica> {
  const res = await request(a.getHttpServer())
    .post('/clinicas')
    .set(CLIENTE_API)
    .send(corpoClinica(e, { senha: SENHA }))
    .expect(201);
  const { clinicaId, psicologoId } = res.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);
  return { clinicaId, adminId: psicologoId, token: await login(e, SENHA, a) };
}

const corpoPsi = (e: string, extra: object = {}) => ({
  nome: 'Novo Psi',
  email: e,
  senha: SENHA,
  abordagemPadrao: 'ACT',
  ...extra,
});

const post = (token: string | undefined, corpo: object, a = app) => {
  const r = request(a.getHttpServer()).post('/psicologos').send(corpo);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

const get = (token?: string) => {
  const r = request(app.getHttpServer()).get('/psicologos');
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

let a: Clinica;
let b: Clinica;
let psiA: { id: string; token: string };

beforeAll(async () => {
  app = await criarAppSemLimite();
  a = await novaClinica(email('admin-a'));
  b = await novaClinica(email('admin-b'));
  const res = await post(a.token, corpoPsi(email('psi-a'))).expect(201);
  // Senha provisoria (item 62): sem a troca, toda rota alem de /eu daria 403
  // "Troca de senha obrigatoria" e o teste de papel nao provaria nada.
  const provisorio = await login(email('psi-a'));
  const troca = await request(app.getHttpServer())
    .post('/auth/trocar-senha')
    .set(CLIENTE_API)
    .set('Authorization', `Bearer ${provisorio}`)
    .send({ senhaAtual: SENHA, novaSenha: 'senha-definitiva-1' })
    .expect(200);
  psiA = {
    id: (res.body as { psicologoId: string }).psicologoId,
    token: (troca.body as { token: string }).token,
  };
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

describe('POST /psicologos', () => {
  it('ADMIN cria: 201 { psicologoId }, PSICOLOGO na clinica do ADMIN, hash bcrypt custo 12', async () => {
    const e = email('novo');
    const res = await post(a.token, corpoPsi(` ${e.toUpperCase()} `)).expect(
      201,
    );
    expect(res.body).toEqual({
      psicologoId: expect.any(String) as string,
      ativo: true,
      desativadoEm: null,
    });
    const { psicologoId } = res.body as { psicologoId: string };
    const p = await app
      .get(TenantPrismaService)
      .run(a.clinicaId, (tx) =>
        tx.psicologo.findFirstOrThrow({ where: { id: psicologoId } }),
      );
    expect(p).toMatchObject({
      clinicaId: a.clinicaId,
      email: e,
      nome: 'Novo Psi',
      papel: 'PSICOLOGO',
      abordagemPadrao: 'ACT',
    });
    expect(p.senhaHash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare(SENHA, p.senhaHash)).toBe(true);

    // o novo faz login e /eu mostra a mesma clinica e papel PSICOLOGO
    const t = await login(e);
    const eu = await request(app.getHttpServer())
      .get('/eu')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(eu.body).toMatchObject({
      psicologoId,
      papel: 'PSICOLOGO',
      senhaProvisoria: true,
      clinica: { id: a.clinicaId },
    });
  });

  it('clinicaId / papel no corpo = 400 (campo extra), nada criado', async () => {
    const e = email('extra');
    for (const extra of [
      { clinicaId: b.clinicaId },
      { papel: 'ADMIN' },
      { psicologoId: randomUUID() },
    ]) {
      await post(a.token, corpoPsi(e, extra)).expect(400);
    }
    const n = await app
      .get(TenantPrismaService)
      .run(b.clinicaId, (tx) => tx.psicologo.count({ where: { email: e } }));
    expect(n).toBe(0);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: e, senha: SENHA })
      .expect(401);
  });

  it('PSICOLOGO = 403 generico; sem token = 401', async () => {
    const res = await post(psiA.token, corpoPsi(email('x403'))).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
    await post(undefined, corpoPsi(email('x401'))).expect(401, {
      statusCode: 401,
      message: 'Unauthorized',
    });
  });

  it('409 para e-mail duplicado (caixa/espacos) e para e-mail de OUTRA clinica', async () => {
    const conflito = {
      statusCode: 409,
      message: 'E-mail ja cadastrado',
      error: 'Conflict',
    };
    await post(a.token, corpoPsi(`  ${email('psi-a').toUpperCase()}`)).expect(
      409,
      conflito,
    );
    await post(a.token, corpoPsi(email('admin-b'))).expect(409, conflito);
  });

  it.each([
    ['senha de 73 bytes', { senha: 'a'.repeat(73) }],
    ['40 emojis (160 bytes)', { senha: '😀'.repeat(40) }],
    ['senha de 7', { senha: 'a'.repeat(7) }],
    ['nome vazio', { nome: '   ' }],
    ['nome 121', { nome: 'n'.repeat(121) }],
    ['abordagem invalida', { abordagemPadrao: 'XYZ' }],
    ['e-mail invalido', { email: 'nao-e-email' }],
    ['e-mail 255', { email: `${'a'.repeat(243)}@teste.local` }],
  ])('400: %s', async (_n, extra) => {
    await post(a.token, corpoPsi(email('inv'), extra)).expect(400);
  });

  it('senha de 72 bytes passa', async () => {
    await post(
      a.token,
      corpoPsi(email('s72'), { senha: 'a'.repeat(72) }),
    ).expect(201);
  });
});

describe('GET /psicologos', () => {
  type Item = Record<string, unknown>;

  it('so a equipe da propria clinica, ordem criadoEm crescente, inclui o proprio ADMIN, sem senhaHash', async () => {
    const res = await get(a.token).expect(200);
    const lista = res.body as Item[];
    expect(lista[0]).toMatchObject({
      psicologoId: a.adminId,
      papel: 'ADMIN',
      email: email('admin-a'),
    });
    expect(lista.map((p) => p.psicologoId)).toContain(psiA.id);
    expect(lista.map((p) => p.psicologoId)).not.toContain(b.adminId);
    for (const p of lista) {
      expect(Object.keys(p).sort()).toEqual(
        [
          'abordagemPadrao',
          'ativo',
          'criadoEm',
          'desativadoEm',
          'email',
          'nome',
          'papel',
          'psicologoId',
        ].sort(),
      );
    }
    const datas = lista.map((p) => Date.parse(p.criadoEm as string));
    expect(datas.every((d) => !Number.isNaN(d))).toBe(true);
    expect([...datas].sort((x, y) => x - y)).toEqual(datas);
    expect(JSON.stringify(res.body)).not.toMatch(/senhaHash|\$2[aby]\$/);
  });

  it('ADMIN de B ve so B (nunca A)', async () => {
    const res = await get(b.token).expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({ psicologoId: b.adminId, papel: 'ADMIN' }),
    ]);
  });

  it('PSICOLOGO = 403 generico; sem token = 401', async () => {
    const res = await get(psiA.token).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
    await get().expect(401);
  });

  it('token valido de psicologo apagado = 401', async () => {
    const c = await novaClinica(email('apagado'));
    await get(c.token).expect(200);
    // Sessao tem FK RESTRICT para Psicologo: sai antes.
    await comoOwner(
      c.clinicaId,
      async (tx) => {
        await tx.sessao.deleteMany({ where: { clinicaId: c.clinicaId } });
        await tx.psicologo.deleteMany({ where: { clinicaId: c.clinicaId } });
      },
      { psicologoId: c.adminId },
    );
    await get(c.token).expect(401);
    await post(c.token, corpoPsi(email('apagado-2'))).expect(401);
  });
});

describe('logs', () => {
  it('nenhum log contem senha nem hash (criar ok, 409, 400 e 500)', async () => {
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
    const senha = `senha-log-${sufixo}`;
    const e = email('log');
    try {
      const res = await post(a.token, corpoPsi(e, { senha }), appLog).expect(
        201,
      );
      await post(a.token, corpoPsi(e, { senha }), appLog).expect(409);
      await post(
        a.token,
        corpoPsi(email('log2'), { senha: `${senha}${'x'.repeat(80)}` }),
        appLog,
      ).expect(400);
      const tenant = appLog.get(TenantPrismaService);
      const run = tenant.run.bind(tenant);
      // erro inesperado SO na criacao (o guard tambem usa run): vira 500
      jest
        .spyOn(tenant, 'run')
        .mockImplementationOnce(run) // guard
        .mockRejectedValueOnce(new Error(`falha com ${senha}`));
      await post(a.token, corpoPsi(email('log3'), { senha }), appLog).expect(
        500,
      );
      const hash = await run(a.clinicaId, (tx) =>
        tx.psicologo.findFirstOrThrow({
          where: { id: (res.body as { psicologoId: string }).psicologoId },
        }),
      ).then((p) => p.senhaHash);

      const tudo = [
        ...linhas,
        ...saida.flatMap((s) => s.mock.calls.map((c) => String(c[0]))),
      ].join('\n');
      // controle: a captura funciona (o 500 foi logado)
      expect(tudo).toContain('falha ao criar psicologo');
      expect(tudo).not.toContain(senha);
      expect(tudo).not.toContain(hash);
      expect(tudo).not.toContain('$2');
    } finally {
      saida.forEach((s) => s.mockRestore());
      await appLog.close();
    }
  });
});

// App REAL (com throttles). Cada teste cria o proprio app: armazenamento em memoria novo.
describe('limite de tentativas da equipe (20/hora por psicologo)', () => {
  let real: NestExpressApplication;

  beforeEach(async () => {
    real = await criarApp();
  });

  afterEach(async () => {
    await real.close();
  });

  it('21o POST na hora = 429 + Retry-After; outro psicologo (mesmo IP) nao e afetado; GET sem limite', async () => {
    // Corpo invalido conta (o guard roda antes da validacao) e nao gasta bcrypt.
    for (let i = 0; i < 20; i++) await post(a.token, {}, real).expect(400);
    const res = await post(a.token, {}, real).expect(429);
    const retry = Number(res.headers['retry-after']);
    expect(Number.isInteger(retry) && retry > 3000).toBe(true);
    expect(res.body).toEqual({
      statusCode: 429,
      message: 'Muitas tentativas. Tente mais tarde.',
    });
    await post(b.token, {}, real).expect(400);
    for (let i = 0; i < 25; i++) {
      await request(real.getHttpServer())
        .get('/psicologos')
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200);
    }
  });

  it('login e /clinicas seguem com os proprios limites (nao herdam o da equipe)', async () => {
    const http = real.getHttpServer();
    // login certo funciona (sem crash do tracker da equipe) e o 6o = 429 (5/min por e-mail)
    for (let i = 0; i < 5; i++) await login(email('admin-a'), SENHA, real);
    await request(http)
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: email('admin-a'), senha: SENHA })
      .expect(429);
    for (let i = 0; i < 5; i++) {
      await request(http)
        .post('/clinicas')
        .set(CLIENTE_API)
        .send({})
        .expect(400);
    }
    await request(http).post('/clinicas').set(CLIENTE_API).send({}).expect(429);
    // e a equipe nao herda os deles: 20 POSTs passam do 5 do cadastro e do login
    for (let i = 0; i < 20; i++) await post(b.token, {}, real).expect(400);
  });
});
