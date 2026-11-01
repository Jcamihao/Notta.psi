import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuditoriaService } from '../src/auditoria/auditoria.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// Item 11 ponta a ponta: cada rota de paciente grava EXATAMENTE 1 linha na trilha, na mesma
// transacao, sem nenhum dado do paciente.
const sufixo = randomUUID().slice(0, 8);
const SENHA = 'senha-forte-123';
type Usuario = { clinicaId: string; psicologoId: string; token: string };
type Linha = {
  acao: string;
  recurso: string;
  recursoId: string | null;
  psicologoId: string;
};

let app: NestExpressApplication;
const criadas: string[] = [];
let n = 0;

const http = () => request(app.getHttpServer());
const com = (u: Usuario | undefined, r: request.Test) =>
  u ? r.set('Authorization', `Bearer ${u.token}`) : r;

// Clinica nova por teste: a trilha comeca vazia e os testes nao se misturam.
async function novoUsuario(): Promise<Usuario> {
  const email = `aud-${++n}-${sufixo}@teste.local`;
  const res = await http()
    .post('/clinicas')
    .send(corpoClinica(email, { senha: SENHA }))
    .expect(201);
  const { clinicaId, psicologoId } = res.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);
  const login = await http()
    .post('/auth/login')
    .send({ email, senha: SENHA })
    .expect(200);
  return {
    clinicaId,
    psicologoId,
    token: (login.body as { token: string }).token,
  };
}

const trilha = (u: Usuario) =>
  app.get(TenantPrismaService).runComoUsuario(u, (tx) =>
    tx.auditoria.findMany({
      select: {
        acao: true,
        recurso: true,
        recursoId: true,
        psicologoId: true,
      },
      orderBy: { criadoEm: 'asc' },
    }),
  ) as Promise<Linha[]>;

const contaPacientes = (u: Usuario) =>
  app.get(TenantPrismaService).runComoUsuario(u, (tx) => tx.paciente.count());

beforeAll(async () => {
  app = await criarAppSemLimite();
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

describe('trilha de auditoria nas rotas de paciente', () => {
  it('POST, GET /:id, GET /, PATCH: exatamente 1 linha cada, com acao/recurso/recursoId certos', async () => {
    const u = await novoUsuario();
    const criado = await com(u, http().post('/pacientes'))
      .send({ nome: 'Maria da Silva' })
      .expect(201);
    const id = (criado.body as { id: string }).id;
    expect(await trilha(u)).toEqual([
      {
        acao: 'CRIOU',
        recurso: 'Paciente',
        recursoId: id,
        psicologoId: u.psicologoId,
      },
    ]);

    await com(u, http().get(`/pacientes/${id}`)).expect(200);
    expect((await trilha(u)).slice(1)).toEqual([
      {
        acao: 'LEU',
        recurso: 'Paciente',
        recursoId: id,
        psicologoId: u.psicologoId,
      },
    ]);

    await com(u, http().get('/pacientes')).expect(200);
    expect((await trilha(u)).slice(2)).toEqual([
      {
        acao: 'LISTOU',
        recurso: 'Paciente',
        recursoId: null,
        psicologoId: u.psicologoId,
      },
    ]);

    await com(u, http().patch(`/pacientes/${id}`))
      .send({ telefone: '11 99999-0000' })
      .expect(200);
    const todas = await trilha(u);
    expect(todas).toHaveLength(4);
    expect(todas[3]).toEqual({
      acao: 'EDITOU',
      recurso: 'Paciente',
      recursoId: id,
      psicologoId: u.psicologoId,
    });
  });

  it('404 (inexistente e de colega), 400 e 401 nao gravam nada', async () => {
    const u = await novoUsuario();
    const outro = await novoUsuario();
    const alheio = (
      await com(outro, http().post('/pacientes'))
        .send({ nome: 'Alheio' })
        .expect(201)
    ).body as { id: string };
    await com(u, http().get(`/pacientes/${randomUUID()}`)).expect(404);
    await com(u, http().get(`/pacientes/${alheio.id}`)).expect(404);
    await com(u, http().patch(`/pacientes/${alheio.id}`))
      .send({ nome: 'X' })
      .expect(404);
    await com(u, http().patch(`/pacientes/${randomUUID()}`))
      .send({ nome: 'X' })
      .expect(404);
    await com(u, http().patch(`/pacientes/${alheio.id}`))
      .send({})
      .expect(400);
    await com(u, http().post('/pacientes')).send({}).expect(400);
    await com(u, http().get('/pacientes/nao-e-uuid')).expect(400);
    await com(undefined, http().get('/pacientes')).expect(401);
    expect(await trilha(u)).toEqual([]);
    // a trilha do outro so tem o proprio POST (o 404 do colega nao gravou nele)
    expect(await trilha(outro)).toHaveLength(1);
  });

  it('a linha nao contem nome, e-mail, telefone nem nascimento (todas as colunas, no banco cru)', async () => {
    const u = await novoUsuario();
    const res = await com(u, http().post('/pacientes'))
      .send({
        nome: 'Fulana Sigilosa',
        nascimento: '1985-01-02',
        telefone: '11 98888-7777',
        email: 'fulana.sigilosa@exemplo.com',
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    await com(u, http().get(`/pacientes/${id}`)).expect(200);
    await com(u, http().patch(`/pacientes/${id}`))
      .send({ nome: 'Sigilosa Nova' })
      .expect(200);
    const cruas = await app
      .get(TenantPrismaService)
      .runComoUsuario(u, (tx) => tx.$queryRaw`SELECT * FROM "Auditoria"`);
    expect(Array.isArray(cruas) && cruas.length).toBe(3);
    const tudo = JSON.stringify(cruas);
    for (const puro of [
      'Fulana',
      'Sigilosa',
      '1985',
      '98888',
      'exemplo.com',
      'Nova',
    ]) {
      expect(tudo).not.toContain(puro);
    }
    // colunas exatas: nada de coluna extra com conteudo
    expect(Object.keys((cruas as object[])[0]).sort()).toEqual([
      'acao',
      'clinicaId',
      'criadoEm',
      'id',
      'psicologoId',
      'recurso',
      'recursoId',
    ]);
  });

  it('atomicidade: falha da auditoria no POST responde erro E nao deixa paciente criado', async () => {
    const u = await novoUsuario();
    const antes = await contaPacientes(u);
    const spy = jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('trilha caiu'));
    const res = await com(u, http().post('/pacientes'))
      .send({ nome: 'Nao Pode Ficar' })
      .expect(500);
    spy.mockRestore();
    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(await contaPacientes(u)).toBe(antes);
    expect(await trilha(u)).toEqual([]);
  });

  it('atomicidade no PATCH: falha da auditoria desfaz a edicao', async () => {
    const u = await novoUsuario();
    const id = (
      (
        await com(u, http().post('/pacientes'))
          .send({ nome: 'Original' })
          .expect(201)
      ).body as { id: string }
    ).id;
    const spy = jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('trilha caiu'));
    await com(u, http().patch(`/pacientes/${id}`))
      .send({ nome: 'Mudado' })
      .expect(500);
    spy.mockRestore();
    const lido = await com(u, http().get(`/pacientes/${id}`)).expect(200);
    expect((lido.body as { nome: string }).nome).toBe('Original');
  });
});
