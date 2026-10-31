import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';

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
      .send(corpoClinica(email(n), { senha: SENHA }))
      .expect(201);
    criadas.push((res.body as { clinicaId: string }).clinicaId);
    const login = await request(http)
      .post('/auth/login')
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
    const token = await app
      .get(JwtService)
      .signAsync({ sub: randomUUID(), clinicaId: randomUUID() });
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
      for (let lote = 0; lote < 6; lote++) {
        expect(await rajada(app, tokens[0], 50)).toEqual({ 200: 50 });
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
          .send({ email: email('a'), senha: 'errada-123' })
          .expect(401);
      }
      await request(http)
        .post('/auth/login')
        .send({ email: email('a'), senha: 'errada-123' })
        .expect(429);
    } finally {
      await app.close();
    }
  });
});
