import { randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// Item 62/57: senha provisoria criada pelo ADMIN, troca obrigatoria e voluntaria,
// versao do token (`tv`). Postgres real.

// Rota SO de teste, sem @PermiteSenhaProvisoria() e sem @Papeis: prova que rota nova
// nasce bloqueada enquanto a senha for provisoria.
@Controller('teste-b3')
class RotaTesteController {
  @Get()
  ok() {
    return { ok: true };
  }
}

const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `ts-${n}-${sufixo}@teste.local`;
const SENHA = 'senha-forte-123';
const NOVA = 'nova-senha-456';
const TROCA_OBRIGATORIA = {
  statusCode: 403,
  message: 'Troca de senha obrigatoria',
  error: 'Forbidden',
};

let app: NestExpressApplication;
const criadas: string[] = [];

type Admin = { clinicaId: string; id: string; token: string };

function login(e: string, senha = SENHA, a = app) {
  return request(a.getHttpServer())
    .post('/auth/login')
    .send({ email: e, senha });
}

async function tokenDe(e: string, senha = SENHA, a = app) {
  const res = await login(e, senha, a);
  expect(res.status).toBe(200);
  return (res.body as { token: string }).token;
}

async function novaClinica(e: string): Promise<Admin> {
  const res = await request(app.getHttpServer())
    .post('/clinicas')
    .send(corpoClinica(e, { senha: SENHA }))
    .expect(201);
  const { clinicaId, psicologoId } = res.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);
  return { clinicaId, id: psicologoId, token: await tokenDe(e) };
}

async function criarColega(admin: Admin, e: string) {
  const res = await request(app.getHttpServer())
    .post('/psicologos')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ nome: 'Colega', email: e, senha: SENHA, abordagemPadrao: 'TCC' })
    .expect(201);
  return (res.body as { psicologoId: string }).psicologoId;
}

const comToken = (r: request.Test, token: string) =>
  r.set('Authorization', `Bearer ${token}`);
const get = (rota: string, token: string, a = app) =>
  comToken(request(a.getHttpServer()).get(rota), token);
const trocar = (token: string, corpo: object, a = app) =>
  comToken(
    request(a.getHttpServer()).post('/auth/trocar-senha').send(corpo),
    token,
  );

const decodificar = (token: string) =>
  JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  ) as Record<string, unknown>;

let admin: Admin;

beforeAll(async () => {
  app = await criarAppSemLimite({ controllers: [RotaTesteController] });
  admin = await novaClinica(email('admin'));
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

describe('senha provisoria: fluxo completo', () => {
  it('ADMIN cria colega -> bloqueio -> erros da troca -> troca -> token antigo 401 -> senha antiga nao loga', async () => {
    const e = email('colega');
    const colegaId = await criarColega(admin, e);
    const provisorio = await tokenDe(e);
    expect(decodificar(provisorio).tv).toBe(0);

    // /eu passa e mostra senhaProvisoria true
    const eu = await get('/eu', provisorio).expect(200);
    expect(eu.body).toMatchObject({
      psicologoId: colegaId,
      papel: 'PSICOLOGO',
      senhaProvisoria: true,
    });

    // qualquer outra rota autenticada: 403 com o corpo do contrato
    for (const rota of ['/psicologos', '/teste-b3']) {
      const r = await get(rota, provisorio).expect(403);
      expect(r.body).toEqual(TROCA_OBRIGATORIA);
    }

    // senha atual errada = 422 (nao 401: o front desloga em todo 401)
    const errada = await trocar(provisorio, {
      senhaAtual: 'senha-errada-999',
      novaSenha: NOVA,
    }).expect(422);
    expect(errada.body).toMatchObject({
      statusCode: 422,
      message: 'Senha atual incorreta',
    });
    // nova igual a atual = 400; 73 bytes = 400; extra = 400; vazia = 400
    await trocar(provisorio, { senhaAtual: SENHA, novaSenha: SENHA }).expect(
      400,
    );
    await trocar(provisorio, {
      senhaAtual: SENHA,
      novaSenha: 'a'.repeat(73),
    }).expect(400);
    await trocar(provisorio, {
      senhaAtual: SENHA,
      novaSenha: NOVA,
      extra: 1,
    }).expect(400);
    await trocar(provisorio, { senhaAtual: '', novaSenha: NOVA }).expect(400);
    await trocar(provisorio, {
      senhaAtual: SENHA,
      novaSenha: '1234567',
    }).expect(400);
    // nada disso trocou a senha nem revogou o token
    await get('/eu', provisorio).expect(200);

    // correta = 200 { token } com tv novo
    const ok = await trocar(provisorio, {
      senhaAtual: SENHA,
      novaSenha: NOVA,
    }).expect(200);
    expect(Object.keys(ok.body as object)).toEqual(['token']);
    const novo = (ok.body as { token: string }).token;
    expect(decodificar(novo)).toMatchObject({
      sub: colegaId,
      clinicaId: admin.clinicaId,
      tv: 1,
    });

    // token antigo = 401 generico
    await get('/eu', provisorio).expect(401, {
      statusCode: 401,
      message: 'Unauthorized',
    });

    // o novo funciona e libera as rotas
    const eu2 = await get('/eu', novo).expect(200);
    expect(eu2.body).toMatchObject({ senhaProvisoria: false });
    await get('/teste-b3', novo).expect(200, { ok: true });
    // PSICOLOGO na rota do ADMIN volta ao 403 generico de papel
    const papel = await get('/psicologos', novo).expect(403);
    expect(papel.body).toEqual({
      statusCode: 403,
      message: 'Forbidden resource',
      error: 'Forbidden',
    });

    // a senha provisoria (a unica que o ADMIN conhece) nao loga mais
    await login(e, SENHA).expect(401);
    await tokenDe(e, NOVA);

    // banco: hash novo, flag false, versao 1
    const p = await app.get(TenantPrismaService).run(admin.clinicaId, (tx) =>
      tx.psicologo.findFirstOrThrow({
        where: { id: colegaId, clinicaId: admin.clinicaId },
      }),
    );
    expect(p).toMatchObject({ senhaProvisoria: false, tokenVersao: 1 });
    expect(await bcrypt.compare(NOVA, p.senhaHash)).toBe(true);
  });

  it('cadastro de clinica: ADMIN nasce com senha definitiva (sem bloqueio)', async () => {
    const eu = await get('/eu', admin.token).expect(200);
    expect(eu.body).toMatchObject({ papel: 'ADMIN', senhaProvisoria: false });
    await get('/teste-b3', admin.token).expect(200);
  });
});

describe('troca voluntaria e versao do token (tv)', () => {
  it('troca voluntaria invalida TODAS as sessoes da conta; outra conta segue valendo', async () => {
    const c = await novaClinica(email('duas'));
    const sessao1 = c.token;
    const sessao2 = await tokenDe(email('duas'));
    await get('/eu', sessao2).expect(200);
    const res = await trocar(sessao1, {
      senhaAtual: SENHA,
      novaSenha: NOVA,
    }).expect(200);
    await get('/eu', sessao1).expect(401);
    await get('/eu', sessao2).expect(401);
    await get('/eu', (res.body as { token: string }).token).expect(200);
    // outra conta nao e afetada
    await get('/eu', admin.token).expect(200);
    // trocar de novo (voltar) incrementa outra vez
    const volta = await trocar((res.body as { token: string }).token, {
      senhaAtual: NOVA,
      novaSenha: SENHA,
    }).expect(200);
    expect(decodificar((volta.body as { token: string }).token).tv).toBe(2);
  });

  it('tv desatualizado, sem tv e tv texto = 401; tv certo = 200', async () => {
    const jwt = new JwtService({ secret: process.env.NOTTA_JWT_SECRET });
    const assinar = (extra: object) =>
      jwt.sign(
        { sub: admin.id, clinicaId: admin.clinicaId, ...extra },
        { algorithm: 'HS256', expiresIn: '1h' },
      );
    await get('/eu', assinar({ tv: 0 })).expect(200);
    for (const extra of [
      {},
      { tv: 1 },
      { tv: -1 },
      { tv: '0' },
      { tv: null },
    ]) {
      const r = await get('/eu', assinar(extra));
      expect({ extra, status: r.status }).toEqual({ extra, status: 401 });
    }
  });

  it('sem token = 401; ADMIN nao troca a senha do colega (so a propria, pelo token)', async () => {
    await request(app.getHttpServer())
      .post('/auth/trocar-senha')
      .send({ senhaAtual: SENHA, novaSenha: NOVA })
      .expect(401);
    // o corpo nao aceita alvo: so a conta do token muda
    await trocar(admin.token, {
      senhaAtual: SENHA,
      novaSenha: NOVA,
      psicologoId: randomUUID(),
    }).expect(400);
  });

  it('duas trocas simultaneas com a mesma senha antiga: so uma vence, a outra = 422', async () => {
    const c = await novaClinica(email('corrida'));
    const [r1, r2] = await Promise.all([
      trocar(c.token, { senhaAtual: SENHA, novaSenha: 'vencedora-1' }),
      trocar(c.token, { senhaAtual: SENHA, novaSenha: 'vencedora-2' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 422]);
    // o token devolvido pela vencedora vale (tv = 1, nao ficou velho por uma 2a troca)
    const venceu = r1.status === 200 ? r1 : r2;
    await get('/eu', (venceu.body as { token: string }).token).expect(200);
  });
});

describe('teto de hashes concorrentes (mesmo semaforo do login)', () => {
  it('12 trocas simultaneas: acima de 8 em andamento = 503 + Retry-After 1, o resto 422', async () => {
    const c = await novaClinica(email('teto'));
    const respostas = await Promise.all(
      Array.from({ length: 12 }, () =>
        trocar(c.token, { senhaAtual: 'errada-errada', novaSenha: NOVA }),
      ),
    );
    const status = respostas.map((r) => r.status);
    expect(status.filter((s) => s === 503).length).toBeGreaterThan(0);
    expect(status.every((s) => s === 503 || s === 422)).toBe(true);
    const r503 = respostas.find((r) => r.status === 503)!;
    expect(r503.headers['retry-after']).toBe('1');
  });
});

// App REAL (com throttles). Cada teste cria o proprio app: armazenamento em memoria novo.
describe('limite trocar-senha (10/hora por psicologo)', () => {
  let real: NestExpressApplication;
  let x: Admin;
  let y: Admin;

  beforeAll(async () => {
    x = await novaClinica(email('lim-x'));
    y = await novaClinica(email('lim-y'));
  });

  beforeEach(async () => {
    real = await criarApp();
  });

  afterEach(async () => {
    await real.close();
  });

  it('11a troca na hora = 429 + Retry-After; outro psicologo (mesmo IP) nao e afetado', async () => {
    // Corpo invalido conta (o guard roda antes da validacao) e nao gasta bcrypt.
    for (let i = 0; i < 10; i++) await trocar(x.token, {}, real).expect(400);
    const res = await trocar(x.token, {}, real).expect(429);
    const retry = Number(res.headers['retry-after']);
    expect(Number.isInteger(retry) && retry > 3000).toBe(true);
    expect(res.body).toEqual({
      statusCode: 429,
      message: 'Muitas tentativas. Tente mais tarde.',
    });
    await trocar(y.token, {}, real).expect(400);
  });

  it('nao mistura com os outros limites: equipe, login e /clinicas seguem com os proprios', async () => {
    const http = real.getHttpServer();
    for (let i = 0; i < 10; i++) await trocar(x.token, {}, real).expect(400);
    // equipe (20/h), login (5/min por e-mail) e /eu nao herdam o 429 da troca
    await comToken(request(http).post('/psicologos').send({}), x.token).expect(
      400,
    );
    await tokenDe(email('lim-x'), SENHA, real);
    await get('/eu', x.token, real).expect(200);
    // e a troca nao herda os limites deles: 20 POSTs na equipe nao bloqueiam a troca de y
    for (let i = 0; i < 20; i++) {
      await comToken(
        request(http).post('/psicologos').send({}),
        y.token,
      ).expect(400);
    }
    await trocar(y.token, {}, real).expect(400);
  });
});
