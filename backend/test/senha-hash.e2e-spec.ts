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

// Prova da frase da pagina /seguranca ("guardada so como hash bcrypt, nunca em texto"): le a
// coluna senhaHash CRUA do banco, como dono, nos 3 pontos que gravam senha (cadastro de clinica,
// colega criado pelo ADMIN e troca da propria senha). Postgres real.

const sufixo = randomUUID().slice(0, 8);
const SENHA = 'tijolo-azul-lua-4821';
const SENHA_COLEGA = 'garrafa-verde-sol-7730';
const SENHA_NOVA = 'janela-roxa-mar-1957';

let app: NestExpressApplication;
const criadas: string[] = [];
const http = () => app.getHttpServer();

async function hashDoBanco(clinicaId: string, psicologoId: string) {
  const p = await comoOwner(
    clinicaId,
    (tx) =>
      tx.psicologo.findFirstOrThrow({
        where: { id: psicologoId, clinicaId },
        select: { senhaHash: true },
      }),
    { psicologoId },
  );
  return p.senhaHash;
}

async function conferirSoHash(
  clinicaId: string,
  psicologoId: string,
  senha: string,
) {
  const hash = await hashDoBanco(clinicaId, psicologoId);
  // bcrypt: "$2a$", "$2b$" ou "$2y$" + custo + 53 caracteres = 60.
  expect(hash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
  expect(hash).not.toContain(senha);
  expect(hash).not.toBe(senha);
  // controle: o hash corresponde a senha (a coluna nao e lixo qualquer).
  expect(await bcrypt.compare(senha, hash)).toBe(true);
}

beforeAll(async () => {
  app = await criarAppSemLimite();
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

it('cadastro, colega e troca de senha: o banco guarda so hash bcrypt', async () => {
  const email = `sh-admin-${sufixo}@teste.local`;
  const cad = await request(http())
    .post('/clinicas')
    .set(CLIENTE_API)
    .send(corpoClinica(email, { senha: SENHA }))
    .expect(201);
  const { clinicaId, psicologoId } = cad.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);

  // 1) cadastro de clinica
  await conferirSoHash(clinicaId, psicologoId, SENHA);

  const ok = await request(http())
    .post('/auth/login')
    .set(CLIENTE_API)
    .send({ email, senha: SENHA })
    .expect(200);
  const token = (ok.body as { token: string }).token;

  // 2) colega criado pelo ADMIN (senha provisoria)
  const emailColega = `sh-colega-${sufixo}@teste.local`;
  const colega = await request(http())
    .post('/psicologos')
    .set(CLIENTE_API)
    .set('Authorization', `Bearer ${token}`)
    .send({
      nome: 'Colega Teste',
      email: emailColega,
      senha: SENHA_COLEGA,
      abordagemPadrao: 'ACT',
    })
    .expect(201);
  const colegaId = (colega.body as { psicologoId: string }).psicologoId;
  expect(colegaId).toEqual(expect.any(String));
  await conferirSoHash(clinicaId, colegaId, SENHA_COLEGA);

  // 3) troca da propria senha
  await request(http())
    .post('/auth/trocar-senha')
    .set(CLIENTE_API)
    .set('Authorization', `Bearer ${token}`)
    .send({ senhaAtual: SENHA, novaSenha: SENHA_NOVA })
    .expect(200);
  await conferirSoHash(clinicaId, psicologoId, SENHA_NOVA);
});
