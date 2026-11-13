import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuditoriaService } from '../src/auditoria/auditoria.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { comoOwner } from './acesso-owner';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';
import { CLIENTE_API } from './cliente-api';

// Item 12 ponta a ponta: documento clinico cifrado, rascunho, so com consentimento CONCEDIDO.
const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `doc-${n}-${sufixo}@teste.local`;
const SENHA = 'senha-forte-123';
const ERRO_500 = { statusCode: 500, message: 'Internal Server Error' };
const TEXTO = 'Paciente relatou insonia e conflito com o pai (sigiloso).';

type Documento = {
  id: string;
  pacienteId: string;
  tipo: string;
  dataSessao: string | null;
  conteudo: string;
  status: string;
  aprovadoEm: string | null;
  substituiId: string | null;
  criadoEm: string;
  atualizadoEm: string;
};
type Usuario = { clinicaId: string; psicologoId: string; token: string };

let app: NestExpressApplication;
const criadas: string[] = [];

const http = () => request(app.getHttpServer());
const com = (token: string | undefined, r: request.Test) =>
  token ? r.set('Authorization', `Bearer ${token}`) : r;
const post = (u: Usuario | undefined, pacienteId: string, corpo: object) =>
  com(u?.token, http().post(`/pacientes/${pacienteId}/documentos`).send(corpo));
const lista = (u: Usuario | undefined, pacienteId: string) =>
  com(u?.token, http().get(`/pacientes/${pacienteId}/documentos`));
const ler = (u: Usuario | undefined, pacienteId: string, id: string) =>
  com(u?.token, http().get(`/pacientes/${pacienteId}/documentos/${id}`));

async function login(e: string, senha = SENHA) {
  const res = await http()
    .post('/auth/login')
    .set(CLIENTE_API)
    .send({ email: e, senha })
    .expect(200);
  return (res.body as { token: string }).token;
}

async function novaClinica(e: string): Promise<Usuario> {
  const res = await http()
    .post('/clinicas')
    .set(CLIENTE_API)
    .send(corpoClinica(e, { senha: SENHA }))
    .expect(201);
  const { clinicaId, psicologoId } = res.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);
  return { clinicaId, psicologoId, token: await login(e) };
}

// Colega criado pelo ADMIN ja com a senha trocada (senao toda rota daria 403).
async function novoColega(admin: Usuario, e: string): Promise<Usuario> {
  const res = await http()
    .post('/psicologos')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ nome: 'Colega', email: e, senha: SENHA, abordagemPadrao: 'ACT' })
    .expect(201);
  const provisorio = await login(e);
  const troca = await http()
    .post('/auth/trocar-senha')
    .set(CLIENTE_API)
    .set('Authorization', `Bearer ${provisorio}`)
    .send({ senhaAtual: SENHA, novaSenha: 'senha-definitiva-1' })
    .expect(200);
  return {
    clinicaId: admin.clinicaId,
    psicologoId: (res.body as { psicologoId: string }).psicologoId,
    token: (troca.body as { token: string }).token,
  };
}

// Paciente novo (com ou sem consentimento CONCEDIDO).
async function novoPaciente(u: Usuario, concedido = true) {
  const res = await com(u.token, http().post('/pacientes'))
    .send({ nome: 'Paciente Teste' })
    .expect(201);
  const id = (res.body as { id: string }).id;
  if (concedido) {
    await com(u.token, http().post(`/pacientes/${id}/consentimento`))
      .send({ evento: 'CONCEDIDO' })
      .expect(201);
  }
  return id;
}

const criar = async (
  u: Usuario,
  pacienteId: string,
  corpo: object = { tipo: 'EVOLUCAO', conteudo: TEXTO },
) => (await post(u, pacienteId, corpo).expect(201)).body as Documento;

// Linha crua do banco, como o proprio psicologo (RLS), para provar o que esta gravado.
const linhaCrua = (u: Usuario, id: string) =>
  app
    .get(TenantPrismaService)
    .runComoUsuario(u, (tx) =>
      tx.documento.findFirstOrThrow({ where: { id } }),
    );
const contaDocs = (u: Usuario) =>
  app.get(TenantPrismaService).runComoUsuario(u, (tx) => tx.documento.count());
const trilha = (u: Usuario) =>
  app.get(TenantPrismaService).runComoUsuario(u, (tx) =>
    tx.auditoria.findMany({
      where: { recurso: 'Documento' },
      select: { acao: true, recurso: true, recursoId: true },
      orderBy: { criadoEm: 'asc' },
    }),
  );

let a: Usuario; // ADMIN da clinica A
let psi: Usuario; // colega na clinica A
let b: Usuario; // ADMIN da clinica B

beforeAll(async () => {
  app = await criarAppSemLimite();
  a = await novaClinica(email('admin-a'));
  b = await novaClinica(email('admin-b'));
  psi = await novoColega(a, email('psi'));
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

describe('POST /pacientes/:id/documentos', () => {
  it.each(['NOTA_BRUTA', 'EVOLUCAO', 'ANAMNESE'])(
    '201 tipo %s: RASCUNHO, conteudo decifrado, sem *Cifrado, dono = token',
    async (tipo) => {
      const pid = await novoPaciente(a);
      const res = await post(a, pid, {
        tipo,
        dataSessao: '2026-11-02',
        conteudo: TEXTO,
      }).expect(201);
      const d = res.body as Documento;
      expect(Object.keys(d).sort()).toEqual([
        'aprovadoEm',
        'atualizadoEm',
        'conteudo',
        'criadoEm',
        'dataSessao',
        'descarteEm',
        'geradoPorIa',
        'id',
        'pacienteId',
        'status',
        'substituiId',
        'tipo',
      ]);
      expect(d).toMatchObject({
        pacienteId: pid,
        tipo,
        dataSessao: '2026-11-02',
        conteudo: TEXTO,
        status: 'RASCUNHO',
      });
      const crua = await linhaCrua(a, d.id);
      expect(crua).toMatchObject({
        clinicaId: a.clinicaId,
        psicologoId: a.psicologoId,
        pacienteId: pid,
      });
    },
  );

  it('so tipo e conteudo: dataSessao null; texto NAO e aparado', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid, {
      tipo: 'NOTA_BRUTA',
      conteudo: '  linha 1\n\n  linha 2  \n',
    });
    expect(d.dataSessao).toBeNull();
    expect(d.conteudo).toBe('  linha 1\n\n  linha 2  \n');
    expect((await ler(a, pid, d.id).expect(200)).body).toMatchObject({
      conteudo: '  linha 1\n\n  linha 2  \n',
    });
  });

  it('banco sem texto puro: coluna no formato v1.k1.*, iv aleatorio', async () => {
    const pid = await novoPaciente(a);
    const d1 = await criar(a, pid);
    const d2 = await criar(a, pid);
    const c1 = (await linhaCrua(a, d1.id)).conteudoCifrado;
    const c2 = (await linhaCrua(a, d2.id)).conteudoCifrado;
    expect(c1).toMatch(/^v1\.k1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(c1).not.toContain('insonia');
    expect(c1).not.toBe(c2);
    const todas = await app
      .get(TenantPrismaService)
      .runComoUsuario(
        a,
        (tx) => tx.$queryRaw`SELECT * FROM "Documento" WHERE id = ${d1.id}`,
      );
    expect(JSON.stringify(todas)).not.toContain('insonia');
    expect(JSON.stringify(todas)).not.toContain('sigiloso');
  });

  it('aceita 20000 caracteres com acentos e emoji (dentro do limite de corpo de 256 kb)', async () => {
    const pid = await novoPaciente(a);
    const acentos = 'é'.repeat(20000);
    const d = await criar(a, pid, { tipo: 'NOTA_BRUTA', conteudo: acentos });
    expect(d.conteudo).toBe(acentos);
    // emoji = 2 unidades UTF-16 e 4 bytes UTF-8: 10000 emoji = 20000 unidades
    const emojis = '😀'.repeat(10000);
    const e = await criar(a, pid, { tipo: 'NOTA_BRUTA', conteudo: emojis });
    expect((await ler(a, pid, e.id).expect(200)).body).toMatchObject({
      conteudo: emojis,
    });
  });

  it('AAD: cifrado copiado entre documentos = 500 generico, sem devolver texto, na leitura', async () => {
    const pid = await novoPaciente(a);
    const d1 = await criar(a, pid, {
      tipo: 'NOTA_BRUTA',
      conteudo: 'texto UM',
    });
    const d2 = await criar(a, pid, {
      tipo: 'NOTA_BRUTA',
      conteudo: 'texto DOIS secreto',
    });
    const c2 = (await linhaCrua(a, d2.id)).conteudoCifrado;
    // o praxis_app nao tem UPDATE: troca o cifrado como owner (so teste), sob a policy
    await comoOwner(
      a.clinicaId,
      (tx) =>
        tx.documento.updateMany({
          where: { id: d1.id },
          data: { conteudoCifrado: c2 },
        }),
      { psicologoId: a.psicologoId },
    );
    const erro = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const res = await ler(a, pid, d1.id).expect(500);
    const logado = JSON.stringify(erro.mock.calls);
    erro.mockRestore();
    expect(res.body).toEqual(ERRO_500);
    expect(JSON.stringify(res.body)).not.toContain('secreto');
    expect(logado).not.toContain('secreto');
    expect(logado).not.toContain('DOIS');
    // o intacto continua legivel
    expect((await ler(a, pid, d2.id).expect(200)).body).toMatchObject({
      conteudo: 'texto DOIS secreto',
    });
  });

  it('sem consentimento (NENHUM) = 403 e nada gravado nem auditado', async () => {
    const pid = await novoPaciente(a, false);
    const antes = await contaDocs(a);
    const trilhaAntes = (await trilha(a)).length;
    const res = await post(a, pid, {
      tipo: 'EVOLUCAO',
      conteudo: TEXTO,
    }).expect(403);
    expect((res.body as { message: string }).message).toBe(
      'Consentimento nao concedido',
    );
    expect(await contaDocs(a)).toBe(antes);
    expect(await trilha(a)).toHaveLength(trilhaAntes);
  });

  it('consentimento REVOGADO: POST = 403 mas a LEITURA do que ja existe continua 200', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid);
    await com(a.token, http().post(`/pacientes/${pid}/consentimento`))
      .send({ evento: 'REVOGADO' })
      .expect(201);
    await post(a, pid, { tipo: 'EVOLUCAO', conteudo: 'novo' }).expect(403);
    expect((await ler(a, pid, d.id).expect(200)).body).toMatchObject({
      conteudo: TEXTO,
    });
    expect((await lista(a, pid).expect(200)).body).toHaveLength(1);
    // volta a CONCEDIDO: cria de novo
    await com(a.token, http().post(`/pacientes/${pid}/consentimento`))
      .send({ evento: 'CONCEDIDO' })
      .expect(201);
    await criar(a, pid);
  });

  it('paciente alheio (colega, outra clinica) e inexistente = 404 IGUAL, antes do 403; nada gravado', async () => {
    const dele = await novoPaciente(psi, false);
    const deB = await novoPaciente(b);
    const corpo = { tipo: 'EVOLUCAO', conteudo: TEXTO };
    const esperado = (await post(a, randomUUID(), corpo).expect(404))
      .body as object;
    expect(esperado).toMatchObject({ statusCode: 404 });
    // colega sem consentimento: 404 (nao 403, que revelaria que o paciente existe)
    expect((await post(a, dele, corpo).expect(404)).body).toEqual(esperado);
    expect((await post(a, deB, corpo).expect(404)).body).toEqual(esperado);
    expect(await contaDocs(psi)).toBe(0);
    expect(await contaDocs(b)).toBe(0);
  });

  it('400: tipo invalido, data futura/impossivel/<1900/formato, conteudo vazio/so espacos/ausente/nao-string, 20001 caracteres, campo extra', async () => {
    const pid = await novoPaciente(a);
    const ok = { tipo: 'EVOLUCAO', conteudo: TEXTO };
    const amanha = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const ruins: object[] = [
      { ...ok, tipo: 'RECEITA' },
      { ...ok, tipo: 'evolucao' },
      { conteudo: TEXTO },
      { ...ok, dataSessao: amanha },
      { ...ok, dataSessao: '2026-02-30' },
      { ...ok, dataSessao: '1899-12-31' },
      { ...ok, dataSessao: '02/11/2026' },
      { ...ok, dataSessao: 20261102 },
      { ...ok, conteudo: '' },
      { ...ok, conteudo: '   \n\t ' },
      { tipo: 'EVOLUCAO' },
      { ...ok, conteudo: 123 },
      { ...ok, conteudo: 'a'.repeat(20001) },
      { ...ok, status: 'APROVADO' },
      { ...ok, clinicaId: randomUUID() },
      { ...ok, psicologoId: randomUUID() },
      { ...ok, pacienteId: randomUUID() },
      { ...ok, id: randomUUID() },
      { ...ok, conteudoCifrado: 'v1.k1.a.b.c' },
    ];
    const antes = await contaDocs(a);
    for (const corpo of ruins) {
      await post(a, pid, corpo).expect(400);
    }
    expect(await contaDocs(a)).toBe(antes);
    // 20000 exatos passa
    await criar(a, pid, { tipo: 'EVOLUCAO', conteudo: 'a'.repeat(20000) });
  });

  it('id do paciente que nao e uuid = 400; sem token = 401', async () => {
    await post(a, 'nao-e-uuid', { tipo: 'EVOLUCAO', conteudo: 'x' }).expect(
      400,
    );
    await post(undefined, randomUUID(), {
      tipo: 'EVOLUCAO',
      conteudo: 'x',
    }).expect(401);
    await post({ ...a, token: 'lixo' }, randomUUID(), {}).expect(401);
  });
});

describe('GET /pacientes/:id/documentos', () => {
  it('so metadados (sem conteudo), mais novo primeiro, so do paciente da URL', async () => {
    const pid = await novoPaciente(a);
    const outro = await novoPaciente(a);
    const d1 = await criar(a, pid, {
      tipo: 'NOTA_BRUTA',
      dataSessao: '2026-10-01',
      conteudo: 'um',
    });
    const d2 = await criar(a, pid, { tipo: 'ANAMNESE', conteudo: 'dois' });
    await criar(a, outro);
    const res = await lista(a, pid).expect(200);
    const itens = res.body as Record<string, unknown>[];
    expect(itens.map((i) => i.id)).toEqual([d2.id, d1.id]);
    for (const i of itens) {
      expect(Object.keys(i).sort()).toEqual([
        'aprovadoEm',
        'criadoEm',
        'dataSessao',
        'descarteEm',
        'geradoPorIa',
        'id',
        'status',
        'substituiId',
        'tipo',
      ]);
    }
    expect(itens[1]).toMatchObject({
      tipo: 'NOTA_BRUTA',
      dataSessao: '2026-10-01',
      status: 'RASCUNHO',
    });
    expect(itens[0].dataSessao).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('dois');
  });

  it('paciente sem documentos = []; 404 se nao e seu; 401; 400 id ruim', async () => {
    const pid = await novoPaciente(a);
    expect((await lista(a, pid).expect(200)).body).toEqual([]);
    const dele = await novoPaciente(psi);
    await lista(a, dele).expect(404);
    await lista(a, randomUUID()).expect(404);
    await lista(undefined, pid).expect(401);
    await lista(a, 'nao-e-uuid').expect(400);
  });
});

describe('GET /pacientes/:id/documentos/:id', () => {
  it('200 com conteudo decifrado; 404 IDENTICO para alheio, inexistente e doc de outro paciente seu', async () => {
    const p1 = await novoPaciente(a);
    const p2 = await novoPaciente(a);
    const d = await criar(a, p1);
    const colegaP = await novoPaciente(psi);
    const docColega = await criar(psi, colegaP);
    const docB = await criar(b, await novoPaciente(b));
    expect((await ler(a, p1, d.id).expect(200)).body).toEqual(d);
    const esperado = (await ler(a, p1, randomUUID()).expect(404))
      .body as object;
    expect(esperado).toMatchObject({ statusCode: 404 });
    // doc existente na URL do paciente errado (meu outro paciente)
    expect((await ler(a, p2, d.id).expect(404)).body).toEqual(esperado);
    // doc de colega (mesmo ADMIN nao le), na URL certa do paciente dele e na minha
    expect((await ler(a, colegaP, docColega.id).expect(404)).body).toEqual(
      esperado,
    );
    expect((await ler(a, p1, docColega.id).expect(404)).body).toEqual(esperado);
    // doc de outra clinica
    expect((await ler(a, p1, docB.id).expect(404)).body).toEqual(esperado);
    // e o dono continua lendo o dele
    await ler(psi, colegaP, docColega.id).expect(200);
  });

  it('400 id ruim, 401 sem token', async () => {
    const pid = await novoPaciente(a);
    await ler(a, pid, 'nao-e-uuid').expect(400);
    await ler(a, 'nao-e-uuid', randomUUID()).expect(400);
    await ler(undefined, pid, randomUUID()).expect(401);
  });
});

describe('Documento: sem DELETE', () => {
  it('rota nao existe (404 do roteador)', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid);
    const url = `/pacientes/${pid}/documentos/${d.id}`;
    await com(a.token, http().delete(url)).expect(404);
    expect((await ler(a, pid, d.id).expect(200)).body).toMatchObject({
      conteudo: TEXTO,
    });
  });
});

describe('Documento: acesso', () => {
  it('403 com senha provisoria em todas as rotas', async () => {
    await http()
      .post('/psicologos')
      .set('Authorization', `Bearer ${a.token}`)
      .send({
        nome: 'Prov',
        email: email('prov'),
        senha: SENHA,
        abordagemPadrao: 'TCC',
      })
      .expect(201);
    const prov = { ...a, token: await login(email('prov')) };
    const esperado = {
      statusCode: 403,
      message: 'Troca de senha obrigatoria',
      error: 'Forbidden',
    };
    const chamadas = [
      () => post(prov, randomUUID(), { tipo: 'EVOLUCAO', conteudo: 'x' }),
      () => lista(prov, randomUUID()),
      () => ler(prov, randomUUID(), randomUUID()),
    ];
    for (const chamar of chamadas) {
      expect((await chamar().expect(403)).body).toEqual(esperado);
    }
  });

  it('ADMIN nao le nem lista documento de colega (e o colega nao le o do ADMIN)', async () => {
    const pAdmin = await novoPaciente(a);
    const pColega = await novoPaciente(psi);
    const dAdmin = await criar(a, pAdmin);
    const dColega = await criar(psi, pColega);
    await ler(a, pColega, dColega.id).expect(404);
    await lista(a, pColega).expect(404);
    await ler(psi, pAdmin, dAdmin.id).expect(404);
    await lista(psi, pAdmin).expect(404);
    expect((await lista(psi, pColega).expect(200)).body).toHaveLength(1);
  });
});

describe('Documento: auditoria na mesma transacao', () => {
  it('POST, GET lista, GET :id: 1 linha cada (CRIOU/LISTOU/LEU) com recursoId certo; 404, 400, 401 e 403 nao gravam', async () => {
    const u = await novaClinica(email(`aud-${randomUUID().slice(0, 6)}`));
    const pid = await novoPaciente(u);
    const d = await criar(u, pid);
    expect(await trilha(u)).toEqual([
      { acao: 'CRIOU', recurso: 'Documento', recursoId: d.id },
    ]);
    await lista(u, pid).expect(200);
    await ler(u, pid, d.id).expect(200);
    expect((await trilha(u)).slice(1)).toEqual([
      { acao: 'LISTOU', recurso: 'Documento', recursoId: pid },
      { acao: 'LEU', recurso: 'Documento', recursoId: d.id },
    ]);
    // nada disto grava
    await ler(u, pid, randomUUID()).expect(404);
    await lista(u, randomUUID()).expect(404);
    await post(u, randomUUID(), { tipo: 'EVOLUCAO', conteudo: 'x' }).expect(
      404,
    );
    await post(u, pid, { tipo: 'RECEITA', conteudo: 'x' }).expect(400);
    await ler(u, pid, 'nao-e-uuid').expect(400);
    await lista(undefined, pid).expect(401);
    const semConsent = await novoPaciente(u, false);
    await post(u, semConsent, { tipo: 'EVOLUCAO', conteudo: 'x' }).expect(403);
    expect(await trilha(u)).toHaveLength(3);
  });

  it('a linha de Auditoria nao contem texto do documento (todas as colunas, no banco cru)', async () => {
    const u = await novaClinica(email(`aud2-${randomUUID().slice(0, 6)}`));
    const pid = await novoPaciente(u);
    const d = await criar(u, pid, {
      tipo: 'ANAMNESE',
      dataSessao: '2026-11-01',
      conteudo: 'Relato sigiloso de abuso na infancia',
    });
    await lista(u, pid).expect(200);
    await ler(u, pid, d.id).expect(200);
    const cruas = await app
      .get(TenantPrismaService)
      .runComoUsuario(
        u,
        (tx) =>
          tx.$queryRaw`SELECT * FROM "Auditoria" WHERE recurso = 'Documento'`,
      );
    expect(Array.isArray(cruas) && cruas.length).toBe(3);
    const tudo = JSON.stringify(cruas);
    for (const puro of [
      'sigiloso',
      'abuso',
      'infancia',
      'Relato',
      'ANAMNESE',
    ]) {
      expect(tudo).not.toContain(puro);
    }
  });

  it('atomicidade: falha da auditoria no POST responde 500 E nao deixa documento criado', async () => {
    const u = await novaClinica(email(`aud3-${randomUUID().slice(0, 6)}`));
    const pid = await novoPaciente(u);
    const antes = await contaDocs(u);
    const spy = jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('trilha caiu'));
    const res = await post(u, pid, {
      tipo: 'EVOLUCAO',
      conteudo: 'Nao Pode Ficar',
    }).expect(500);
    spy.mockRestore();
    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(await contaDocs(u)).toBe(antes);
    expect(await trilha(u)).toEqual([]);
  });

  it('falha da auditoria na leitura (LEU e LISTOU) responde 500 e nao devolve o texto', async () => {
    const u = await novaClinica(email(`aud4-${randomUUID().slice(0, 6)}`));
    const pid = await novoPaciente(u);
    const d = await criar(u, pid);
    for (const chamar of [() => ler(u, pid, d.id), () => lista(u, pid)]) {
      const spy = jest
        .spyOn(app.get(AuditoriaService), 'registrar')
        .mockRejectedValueOnce(new Error('trilha caiu'));
      const res = await chamar().expect(500);
      spy.mockRestore();
      expect(JSON.stringify(res.body)).not.toContain('insonia');
    }
  });
});
