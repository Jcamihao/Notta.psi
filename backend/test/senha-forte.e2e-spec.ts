import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { comoOwner } from './acesso-owner';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';
import { CLIENTE_API } from './cliente-api';

// Item 45: politica de senha forte nos 3 pontos (cadastro, colega, trocar senha). Login nao usa.
// Postgres real.

const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `sf-${n}-${sufixo}@teste.local`;
const FORTE = 'tijolo-azul-lua-4821';
const FORTE_2 = 'garrafa-verde-sol-7730';

// [senha, motivo]: um por motivo e os casos de lista.
const FRACAS: [string, string][] = [
  ['Xq7!vB2m', 'CURTA'],
  ['Senha1234!', 'COMUM'],
  ['P@ssw0rd!!!', 'COMUM'],
  ['FLAMENGO2026', 'COMUM'],
  ['1234567890', 'REPETIDA'],
  ['qwertyuiop', 'REPETIDA'],
  ['aaaaaaaaaaaa', 'REPETIDA'],
];

let app: NestExpressApplication;
const criadas: string[] = [];
const http = () => app.getHttpServer();

const cadastrar = (corpo: object) =>
  request(http()).post('/clinicas').set(CLIENTE_API).send(corpo);
const colega = (token: string, corpo: object) =>
  request(http())
    .post('/psicologos')
    .set(CLIENTE_API)
    .set('Authorization', `Bearer ${token}`)
    .send(corpo);
const trocar = (token: string, corpo: object) =>
  request(http())
    .post('/auth/trocar-senha')
    .set(CLIENTE_API)
    .set('Authorization', `Bearer ${token}`)
    .send(corpo);
const login = (e: string, senha: string) =>
  request(http())
    .post('/auth/login')
    .set(CLIENTE_API)
    .send({ email: e, senha });

const corpoPsi = (e: string, extra: object = {}) => ({
  nome: 'Novo Psi',
  email: e,
  senha: FORTE,
  abordagemPadrao: 'ACT',
  ...extra,
});

async function novaClinica(n: string, senha = FORTE) {
  const e = email(n);
  const res = await cadastrar(corpoClinica(e, { senha })).expect(201);
  const { clinicaId, psicologoId } = res.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);
  const ok = await login(e, senha).expect(200);
  return {
    e,
    clinicaId,
    psicologoId,
    token: (ok.body as { token: string }).token,
  };
}

// Mensagem FIXA por motivo: o corpo nunca traz a senha, trecho dela nem a lista.
const MENSAGEM: Record<string, string> = {
  CURTA: 'Senha fraca: use pelo menos 10 caracteres',
  COMUM: 'Senha fraca: esta senha e muito comum',
  PESSOAL: 'Senha fraca: nao use seu nome nem seu e-mail na senha',
  REPETIDA: 'Senha fraca: evite repeticoes e sequencias como 1234567890',
};

function conferirCorpo(corpo: unknown, motivo: string) {
  expect(corpo).toEqual({
    statusCode: 422,
    message: MENSAGEM[motivo],
    motivo,
  });
}

let a: Awaited<ReturnType<typeof novaClinica>>;

beforeAll(async () => {
  app = await criarAppSemLimite();
  a = await novaClinica('admin-a');
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

describe('POST /clinicas', () => {
  it.each(FRACAS)(
    'recusa %s com 422 %s e nao cria nada',
    async (senha, motivo) => {
      const e = email(
        `cad-${motivo}-${senha.length}-${randomUUID().slice(0, 4)}`,
      );
      const res = await cadastrar(corpoClinica(e, { senha })).expect(422);
      conferirCorpo(res.body, motivo);
      await login(e, senha).expect(401);
    },
  );

  it('recusa senha com a parte local do e-mail ou o nome (PESSOAL)', async () => {
    const e = `joana.prado-${sufixo}@teste.local`;
    const r1 = await cadastrar(
      corpoClinica(e, { senha: `x-joana.prado-${sufixo}-Kz` }),
    ).expect(422);
    conferirCorpo(r1.body, 'PESSOAL');
    const r2 = await cadastrar(
      corpoClinica(email('nome'), {
        nomePsicologo: 'Fernanda Albuquerque',
        senha: 'Minha#ALBUQUERQUE-81',
      }),
    ).expect(422);
    conferirCorpo(r2.body, 'PESSOAL');
  });

  it('senha igual ao e-mail = PESSOAL', async () => {
    const e = email('igual-ao-email');
    const res = await cadastrar(corpoClinica(e, { senha: e })).expect(422);
    conferirCorpo(res.body, 'PESSOAL');
  });

  it('aceita senha forte (10 caracteres exatos)', async () => {
    const e = email('forte10');
    const res = await cadastrar(
      corpoClinica(e, { senha: 'Xq7!vB2mKz' }),
    ).expect(201);
    criadas.push((res.body as { clinicaId: string }).clinicaId);
    await login(e, 'Xq7!vB2mKz').expect(200);
  });

  it('senha fraca com e-mail JA CADASTRADO = 422 (nao 409): a politica nao serve de sonda', async () => {
    const res = await cadastrar(
      corpoClinica(a.e, { senha: 'Senha1234!' }),
    ).expect(422);
    expect(JSON.stringify(res.body)).not.toContain('cadastrado');
  });
});

describe('POST /psicologos (colega com senha provisoria)', () => {
  it.each(FRACAS)(
    'recusa %s com 422 %s e nao cria o colega',
    async (senha, motivo) => {
      const e = email(
        `col-${motivo}-${senha.length}-${randomUUID().slice(0, 4)}`,
      );
      const res = await colega(a.token, corpoPsi(e, { senha })).expect(422);
      conferirCorpo(res.body, motivo);
      // nada foi criado: o mesmo e-mail ainda cria com senha forte
      await colega(a.token, corpoPsi(e)).expect(201);
    },
  );

  it('recusa senha com o nome ou o e-mail do colega (PESSOAL)', async () => {
    const res = await colega(
      a.token,
      corpoPsi(email('col-pessoal'), {
        nome: 'Ricardo Menezes',
        senha: 'ricardo#Menezes-2026',
      }),
    ).expect(422);
    conferirCorpo(res.body, 'PESSOAL');
  });

  it('aceita provisoria forte', async () => {
    await colega(a.token, corpoPsi(email('col-ok'))).expect(201);
  });

  it('409 de e-mail repetido tem o MESMO corpo para e-mail da propria clinica e de outra', async () => {
    const b = await novaClinica('admin-b');
    const naMinha = await colega(a.token, corpoPsi(a.e)).expect(409);
    const emOutra = await colega(a.token, corpoPsi(b.e)).expect(409);
    expect(emOutra.body).toEqual(naMinha.body);
    expect(naMinha.body).toEqual({
      statusCode: 409,
      message: 'E-mail ja cadastrado',
      error: 'Conflict',
    });
  });
});

describe('POST /auth/trocar-senha', () => {
  it.each(FRACAS)(
    'recusa %s com 422 %s e a senha antiga continua valendo',
    async (senha, motivo) => {
      const c = await novaClinica(
        `tr-${motivo}-${senha.length}-${randomUUID().slice(0, 4)}`,
      );
      const res = await trocar(c.token, {
        senhaAtual: FORTE,
        novaSenha: senha,
      }).expect(422);
      conferirCorpo(res.body, motivo);
      await login(c.e, FORTE).expect(200);
    },
  );

  it('recusa senha com o proprio e-mail ou nome (PESSOAL)', async () => {
    const c = await novaClinica('tr-pessoal');
    const local = c.e.split('@')[0];
    const res = await trocar(c.token, {
      senhaAtual: FORTE,
      novaSenha: `${local}#Kz9`,
    }).expect(422);
    conferirCorpo(res.body, 'PESSOAL');
    const nome = await trocar(c.token, {
      senhaAtual: FORTE,
      novaSenha: 'Teste-da-ANA-77-x',
    }).expect(422);
    conferirCorpo(nome.body, 'PESSOAL');
  });

  it('a mesma senha atual continua 400 (regra antiga)', async () => {
    const c = await novaClinica('tr-igual');
    await trocar(c.token, { senhaAtual: FORTE, novaSenha: FORTE }).expect(400);
  });

  it('aceita forte: 200 e entra com a nova', async () => {
    const c = await novaClinica('tr-ok');
    await trocar(c.token, { senhaAtual: FORTE, novaSenha: FORTE_2 }).expect(
      200,
    );
    await login(c.e, FORTE_2).expect(200);
    await login(c.e, FORTE).expect(401);
  });
});

describe('login nao usa a politica', () => {
  it('conta antiga com senha fraca continua entrando, mas so troca para forte', async () => {
    const c = await novaClinica('login-antigo');
    const fraca = '12345678';
    const hash = await bcrypt.hash(fraca, 4);
    await comoOwner(
      c.clinicaId,
      (tx) =>
        tx.psicologo.updateMany({
          where: { id: c.psicologoId, clinicaId: c.clinicaId },
          data: { senhaHash: hash },
        }),
      { psicologoId: c.psicologoId },
    );
    const ok = await login(c.e, fraca).expect(200);
    const token = (ok.body as { token: string }).token;
    const r = await trocar(token, {
      senhaAtual: fraca,
      novaSenha: '87654321',
    }).expect(422);
    conferirCorpo(r.body, 'CURTA');
    await trocar(token, { senhaAtual: fraca, novaSenha: FORTE_2 }).expect(200);
    await login(c.e, FORTE_2).expect(200);
  });
});
