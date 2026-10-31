import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// App REAL (com os throttles). Cada teste cria o proprio app: armazenamento em memoria novo.
const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `lim-${n}-${sufixo}@teste.local`;
const SENHA = 'senha-forte-123';

let app: NestExpressApplication;
let cadastrada: { clinicaId: string; email: string };

const login = (emailLogin: string, senha = 'senha-errada-1', ip?: string) => {
  const r = request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: emailLogin, senha });
  return ip ? r.set('X-Forwarded-For', ip) : r;
};

function esperar429(res: request.Response, emailUsado?: string) {
  expect(res.status).toBe(429);
  const retry = Number(res.headers['retry-after']);
  expect(Number.isInteger(retry) && retry > 0).toBe(true);
  if (emailUsado) {
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain(
      emailUsado.trim().toLowerCase(),
    );
  }
}

const proxyOriginal = process.env.NOTTA_TRUST_PROXY;

beforeAll(async () => {
  const setup = await criarAppSemLimite();
  const res = await request(setup.getHttpServer())
    .post('/clinicas')
    .send(corpoClinica(email('ok'), { senha: SENHA }))
    .expect(201);
  cadastrada = {
    clinicaId: (res.body as { clinicaId: string }).clinicaId,
    email: email('ok'),
  };
  await setup.close();
});

afterAll(async () => {
  const limpar = await criarAppSemLimite();
  await apagarClinicas(limpar, [cadastrada.clinicaId]);
  await limpar.close();
});

beforeEach(async () => {
  delete process.env.NOTTA_TRUST_PROXY;
  app = await criarApp();
});

afterEach(async () => {
  await app.close();
  if (proxyOriginal === undefined) delete process.env.NOTTA_TRUST_PROXY;
  else process.env.NOTTA_TRUST_PROXY = proxyOriginal;
});

describe('limite de tentativas', () => {
  it('login: 5 erros com o mesmo e-mail -> 6o = 429 + Retry-After; outro e-mail do mesmo IP segue 401', async () => {
    const alvo = email('alvo');
    for (let i = 0; i < 5; i++) await login(alvo).expect(401);
    esperar429(await login(alvo), alvo);
    await login(email('outro')).expect(401);
  });

  it('login: caixa e espacos do e-mail contam na MESMA chave', async () => {
    const base = email('caixa');
    const variantes = [
      base,
      ` ${base}`,
      base.toUpperCase(),
      `  ${base.toUpperCase()}  `,
      base,
    ];
    for (const v of variantes) await login(v).expect(401);
    esperar429(await login(` ${base.toUpperCase()}`), base);
  });

  it('login: sucesso tambem conta (6o login certo = 429)', async () => {
    for (let i = 0; i < 5; i++)
      await login(cadastrada.email, SENHA).expect(200);
    esperar429(await login(cadastrada.email, SENHA), cadastrada.email);
  });

  it('login: 20 por IP (e-mails diferentes) -> 21o = 429', async () => {
    for (let i = 0; i < 20; i++) await login(email(`ip${i}`)).expect(401);
    esperar429(await login(email('ip-novo')), email('ip-novo'));
  });

  it('/clinicas: 6o no mesmo IP = 429 (conta antes da validacao)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/clinicas').send({}).expect(400);
    }
    esperar429(await request(app.getHttpServer()).post('/clinicas').send({}));
  });

  it('/saude nao tem limite de tentativas', async () => {
    for (let i = 0; i < 25; i++) {
      await request(app.getHttpServer()).get('/saude').expect(200);
    }
  });

  it('NOTTA_TRUST_PROXY=1: IPs diferentes via X-Forwarded-For tem limites separados', async () => {
    await app.close();
    process.env.NOTTA_TRUST_PROXY = '1';
    app = await criarApp();
    const alvo = email('proxy');
    for (let i = 0; i < 5; i++)
      await login(alvo, undefined, '203.0.113.1').expect(401);
    esperar429(await login(alvo, undefined, '203.0.113.1'));
    await login(alvo, undefined, '203.0.113.2').expect(401);
  });

  it('sem NOTTA_TRUST_PROXY o X-Forwarded-For e ignorado', async () => {
    const alvo = email('semproxy');
    for (let i = 0; i < 5; i++)
      await login(alvo, undefined, '203.0.113.1').expect(401);
    esperar429(await login(alvo, undefined, '203.0.113.2'));
  });
});

describe('IPv6: todos os limites por IP agrupam o /64', () => {
  // 3 enderecos do MESMO /64 contam como um; outro /64 tem contador proprio. IPv4 inalterado
  // (testes acima).
  const mesmo64 = [
    '2001:db8:1:2::a',
    '2001:db8:1:2::b',
    '2001:db8:1:2:ffff:1:2:3',
  ];

  beforeEach(async () => {
    await app.close();
    process.env.NOTTA_TRUST_PROXY = '1';
    app = await criarApp();
  });

  it('login-chave: 5 erros do mesmo e-mail em 3 IPs do mesmo /64 -> 6o = 429; outro /64 segue 401', async () => {
    const alvo = email('v6chave');
    for (let i = 0; i < 5; i++) {
      await login(alvo, undefined, mesmo64[i % 3]).expect(401);
    }
    esperar429(await login(alvo, undefined, mesmo64[2]), alvo);
    await login(alvo, undefined, '2001:db8:1:3::a').expect(401);
  });

  it('login-ip: 20 e-mails diferentes em 3 IPs do mesmo /64 -> 21o = 429', async () => {
    for (let i = 0; i < 20; i++) {
      await login(email(`v6ip${i}`), undefined, mesmo64[i % 3]).expect(401);
    }
    esperar429(await login(email('v6ip-novo'), undefined, mesmo64[1]));
  });

  it('/clinicas: 5 em 3 IPs do mesmo /64 -> 6o = 429', async () => {
    const post = (ip: string) =>
      request(app.getHttpServer())
        .post('/clinicas')
        .set('X-Forwarded-For', ip)
        .send({});
    for (let i = 0; i < 5; i++) await post(mesmo64[i % 3]).expect(400);
    esperar429(await post(mesmo64[0]));
  });
});
