import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuditoriaService } from '../src/auditoria/auditoria.service';
import { ConsentimentoService } from '../src/consentimento/consentimento.service';
import { TERMO_VIGENTE } from '../src/consentimento/termo-consentimento';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// Item 10 ponta a ponta: consentimento por paciente, append-only, maquina de estados,
// auditoria na mesma transacao.
const sufixo = randomUUID().slice(0, 8);
const SENHA = 'senha-forte-123';
type Usuario = { clinicaId: string; psicologoId: string; token: string };
type Resumo = {
  estado: string;
  desde: string | null;
  historico: {
    seq: number;
    evento: string;
    termoVersao: string;
    origem: string;
    em: string;
  }[];
};

let app: NestExpressApplication;
const criadas: string[] = [];
let n = 0;

const http = () => request(app.getHttpServer());
const com = (u: { token: string } | undefined, r: request.Test) =>
  u ? r.set('Authorization', `Bearer ${u.token}`) : r;
const ver = (u: Usuario | undefined, id: string) =>
  com(u, http().get(`/pacientes/${id}/consentimento`));
const registrar = (u: Usuario | undefined, id: string, corpo: object) =>
  com(u, http().post(`/pacientes/${id}/consentimento`).send(corpo));
const evento = (u: Usuario, id: string, e: 'CONCEDIDO' | 'REVOGADO') =>
  registrar(u, id, { evento: e });

async function login(email: string) {
  const res = await http()
    .post('/auth/login')
    .send({ email, senha: SENHA })
    .expect(200);
  return (res.body as { token: string }).token;
}

// Clinica nova por teste: trilha e linhas comecam vazias e os testes nao se misturam.
async function novoUsuario(): Promise<Usuario> {
  const email = `cons-${++n}-${sufixo}@teste.local`;
  const res = await http()
    .post('/clinicas')
    .send(corpoClinica(email, { senha: SENHA }))
    .expect(201);
  const { clinicaId, psicologoId } = res.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);
  return { clinicaId, psicologoId, token: await login(email) };
}

async function novoPaciente(u: Usuario, nome = 'Paciente Teste') {
  const res = await com(u, http().post('/pacientes'))
    .send({ nome })
    .expect(201);
  return (res.body as { id: string }).id;
}

const linhas = (u: Usuario) =>
  app
    .get(TenantPrismaService)
    .runComoUsuario(u, (tx) =>
      tx.consentimento.findMany({ orderBy: { seq: 'asc' } }),
    );

const trilha = (u: Usuario) =>
  app.get(TenantPrismaService).runComoUsuario(u, (tx) =>
    tx.auditoria.findMany({
      where: { recurso: 'Consentimento' },
      select: { acao: true, recurso: true, recursoId: true },
      orderBy: { criadoEm: 'asc' },
    }),
  );

beforeAll(async () => {
  app = await criarAppSemLimite();
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

describe('GET /pacientes/:id/consentimento', () => {
  it('paciente novo: NENHUM, desde null, historico vazio', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);
    const res = await ver(u, id).expect(200);
    expect(res.body).toEqual({ estado: 'NENHUM', desde: null, historico: [] });
  });
});

describe('POST /pacientes/:id/consentimento: fluxo completo', () => {
  it('conceder -> revogar -> re-conceder: 3 linhas novas, nada sobrescrito, historico em ordem', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);

    const c1 = await evento(u, id, 'CONCEDIDO').expect(201);
    const r1 = c1.body as Resumo;
    expect(r1.estado).toBe('CONCEDIDO');
    expect(r1.historico).toHaveLength(1);
    expect(r1.desde).toBe(r1.historico[0].em);
    const primeira = (await linhas(u))[0];
    expect(primeira.termoVersao).toBe(TERMO_VIGENTE.versao);
    expect(primeira.termoTexto).toBe(TERMO_VIGENTE.texto);
    expect(primeira.origem).toBe('PSICOLOGO');
    expect(primeira.conviteId).toBeNull();
    expect(primeira.termoTexto.length).toBeGreaterThan(40);

    const r2 = (await evento(u, id, 'REVOGADO').expect(201)).body as Resumo;
    expect(r2.estado).toBe('REVOGADO');
    const r3 = (await evento(u, id, 'CONCEDIDO').expect(201)).body as Resumo;
    expect(r3.estado).toBe('CONCEDIDO');

    expect(
      r3.historico.map((h) => [h.seq, h.evento, h.termoVersao, h.origem]),
    ).toEqual([
      [1, 'CONCEDIDO', TERMO_VIGENTE.versao, 'PSICOLOGO'],
      [2, 'REVOGADO', TERMO_VIGENTE.versao, 'PSICOLOGO'],
      [3, 'CONCEDIDO', TERMO_VIGENTE.versao, 'PSICOLOGO'],
    ]);
    expect(r3.desde).toBe(r3.historico[2].em);
    // GET devolve o mesmo corpo do ultimo POST
    expect((await ver(u, id).expect(200)).body).toEqual(r3);

    // nada foi sobrescrito: a 1a linha continua igual, as 3 existem
    const todas = await linhas(u);
    expect(todas.map((l) => [l.seq, l.evento])).toEqual([
      [1, 'CONCEDIDO'],
      [2, 'REVOGADO'],
      [3, 'CONCEDIDO'],
    ]);
    expect(todas[0]).toEqual(primeira);
    // REVOGADO guarda a versao/texto vigente do concedido anterior
    expect(todas[1].termoTexto).toBe(todas[0].termoTexto);
  });

  it('transicoes invalidas = 409 "Transicao invalida" e nada gravado', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);
    const invalida = {
      statusCode: 409,
      message: 'Transicao invalida',
      error: 'Conflict',
    };
    // NENHUM -> REVOGADO
    expect((await evento(u, id, 'REVOGADO').expect(409)).body).toEqual(
      invalida,
    );
    await evento(u, id, 'CONCEDIDO').expect(201);
    // CONCEDIDO -> CONCEDIDO
    expect((await evento(u, id, 'CONCEDIDO').expect(409)).body).toEqual(
      invalida,
    );
    await evento(u, id, 'REVOGADO').expect(201);
    // REVOGADO -> REVOGADO
    expect((await evento(u, id, 'REVOGADO').expect(409)).body).toEqual(
      invalida,
    );
    expect(await linhas(u)).toHaveLength(2);
    // so as 2 gravacoes validas auditadas (409 nao grava)
    expect(await trilha(u)).toHaveLength(2);
  });

  it('concorrencia: 2 POST simultaneos iguais = 1 ok e 1 409; 1 linha so', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);
    for (const e of ['CONCEDIDO', 'REVOGADO'] as const) {
      const rs = await Promise.all([evento(u, id, e), evento(u, id, e)]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    }
    expect((await linhas(u)).map((l) => l.seq)).toEqual([1, 2]);
    expect(await trilha(u)).toHaveLength(2);
  });

  it('validacao: evento invalido, ausente, campo extra e id nao-uuid = 400', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);
    await registrar(u, id, { evento: 'TALVEZ' }).expect(400);
    await registrar(u, id, {}).expect(400);
    await registrar(u, id, {
      evento: 'CONCEDIDO',
      termoTexto: 'meu termo',
    }).expect(400);
    await registrar(u, id, { evento: 'CONCEDIDO', seq: 5 }).expect(400);
    await registrar(u, id, {
      evento: 'CONCEDIDO',
      psicologoId: randomUUID(),
    }).expect(400);
    await ver(u, 'nao-e-uuid').expect(400);
    expect(await linhas(u)).toEqual([]);
  });
});

describe('isolamento e autenticacao', () => {
  it('paciente de outra clinica, de colega e inexistente: 404 IDENTICO em GET e POST; nada gravado', async () => {
    const dono = await novoUsuario();
    const intruso = await novoUsuario();
    const id = await novoPaciente(dono);
    const inexistente = randomUUID();
    const rGet = await ver(intruso, inexistente).expect(404);
    const rPost = await evento(intruso, inexistente, 'CONCEDIDO').expect(404);
    expect((await ver(intruso, id).expect(404)).body).toEqual(rGet.body);
    expect((await evento(intruso, id, 'CONCEDIDO').expect(404)).body).toEqual(
      rPost.body,
    );
    expect(await linhas(dono)).toEqual([]);
    expect(await linhas(intruso)).toEqual([]);
    // 404 nao audita
    expect(await trilha(intruso)).toEqual([]);
  });

  it('colega da MESMA clinica: 403 com senha provisoria; depois de trocar a senha, 404 (nao ve paciente do ADMIN)', async () => {
    const admin = await novoUsuario();
    const id = await novoPaciente(admin);
    const email = `colega-${sufixo}-${++n}@teste.local`;
    await com(admin, http().post('/psicologos'))
      .send({ nome: 'Colega', email, senha: SENHA, abordagemPadrao: 'TCC' })
      .expect(201);
    const colega = { token: await login(email) };
    await ver(colega, id).expect(403);
    await evento(colega as Usuario, id, 'CONCEDIDO').expect(403);
    const nova = await com(colega, http().post('/auth/trocar-senha'))
      .send({ senhaAtual: SENHA, novaSenha: 'outra-senha-456' })
      .expect(200);
    const livre = { token: (nova.body as { token: string }).token };
    await ver(livre, id).expect(404);
    await evento(livre as Usuario, id, 'CONCEDIDO').expect(404);
    expect(await linhas(admin)).toEqual([]);
  });

  it('sem token = 401', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);
    await ver(undefined, id).expect(401);
    await registrar(undefined, id, { evento: 'CONCEDIDO' }).expect(401);
  });
});

describe('auditoria', () => {
  it('GET grava LEU, POST grava CONCEDEU/REVOGOU, todos com recurso Consentimento e recursoId = paciente', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);
    await ver(u, id).expect(200);
    await evento(u, id, 'CONCEDIDO').expect(201);
    await evento(u, id, 'REVOGADO').expect(201);
    expect(await trilha(u)).toEqual([
      { acao: 'LEU', recurso: 'Consentimento', recursoId: id },
      { acao: 'CONCEDEU', recurso: 'Consentimento', recursoId: id },
      { acao: 'REVOGOU', recurso: 'Consentimento', recursoId: id },
    ]);
  });

  it('atomicidade no POST: falha da auditoria responde 500 e NAO deixa o consentimento gravado', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);
    const spy = jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('trilha caiu'));
    const res = await evento(u, id, 'CONCEDIDO').expect(500);
    spy.mockRestore();
    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(await linhas(u)).toEqual([]);
    expect((await ver(u, id).expect(200)).body).toMatchObject({
      estado: 'NENHUM',
    });
  });

  it('atomicidade no GET: falha da auditoria responde 500 (sem leitura sem registro)', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);
    const spy = jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('trilha caiu'));
    await ver(u, id).expect(500);
    spy.mockRestore();
  });
});

describe('estado em /pacientes e exigirConcedido', () => {
  it('lista e detalhe trazem `consentimento` (NENHUM, CONCEDIDO, REVOGADO)', async () => {
    const u = await novoUsuario();
    const a = await novoPaciente(u, 'Ana');
    const b = await novoPaciente(u, 'Bia');
    const c = await novoPaciente(u, 'Caio');
    await evento(u, b, 'CONCEDIDO').expect(201);
    await evento(u, c, 'CONCEDIDO').expect(201);
    await evento(u, c, 'REVOGADO').expect(201);

    const lista = (await com(u, http().get('/pacientes')).expect(200)).body as {
      nome: string;
      consentimento: string;
    }[];
    expect(lista.map((p) => [p.nome, p.consentimento])).toEqual([
      ['Ana', 'NENHUM'],
      ['Bia', 'CONCEDIDO'],
      ['Caio', 'REVOGADO'],
    ]);
    for (const [id, esperado] of [
      [a, 'NENHUM'],
      [b, 'CONCEDIDO'],
      [c, 'REVOGADO'],
    ]) {
      const d = await com(u, http().get(`/pacientes/${id}`)).expect(200);
      expect((d.body as { consentimento: string }).consentimento).toBe(
        esperado,
      );
    }
  });

  it('exigirConcedido: 403 em NENHUM e REVOGADO, passa em CONCEDIDO (banco real)', async () => {
    const u = await novoUsuario();
    const id = await novoPaciente(u);
    const exigir = () =>
      app
        .get(TenantPrismaService)
        .runComoUsuario(u, (tx) =>
          app.get(ConsentimentoService).exigirConcedido(tx, u, id),
        );
    await expect(exigir()).rejects.toMatchObject({
      status: 403,
      message: 'Consentimento nao concedido',
    });
    await evento(u, id, 'CONCEDIDO').expect(201);
    await expect(exigir()).resolves.toBeUndefined();
    await evento(u, id, 'REVOGADO').expect(201);
    await expect(exigir()).rejects.toMatchObject({ status: 403 });
    // revogar nao apaga o que ja existe
    expect(await linhas(u)).toHaveLength(2);
  });
});
