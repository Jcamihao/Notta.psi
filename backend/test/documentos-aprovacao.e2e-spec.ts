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
import { CLIENTE_API } from './cliente-api';

// Itens 14 e 15 (back) ponta a ponta: editar rascunho, aprovar (irreversivel) e corrigir.
const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `apr-${n}-${sufixo}@teste.local`;
const SENHA = 'senha-forte-123';
const TEXTO = 'Paciente relatou insonia e conflito com o pai (sigiloso).';
const NOVO = 'Texto revisado: paciente relatou melhora do sono.';

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
const base = (pid: string) => `/pacientes/${pid}/documentos`;
const post = (u: Usuario | undefined, pid: string, corpo: object) =>
  com(u?.token, http().post(base(pid)).send(corpo));
const lista = (u: Usuario | undefined, pid: string, query = '') =>
  com(u?.token, http().get(`${base(pid)}${query}`));
const ler = (u: Usuario | undefined, pid: string, id: string) =>
  com(u?.token, http().get(`${base(pid)}/${id}`));
const editar = (
  u: Usuario | undefined,
  pid: string,
  id: string,
  corpo: object,
) =>
  com(
    u?.token,
    http()
      .patch(`${base(pid)}/${id}`)
      .send(corpo),
  );
const aprovar = (u: Usuario | undefined, pid: string, id: string) =>
  com(u?.token, http().post(`${base(pid)}/${id}/aprovar`));

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

async function novoPaciente(u: Usuario) {
  const res = await com(u.token, http().post('/pacientes'))
    .send({ nome: 'Paciente Teste' })
    .expect(201);
  const id = (res.body as { id: string }).id;
  await com(u.token, http().post(`/pacientes/${id}/consentimento`))
    .send({ evento: 'CONCEDIDO' })
    .expect(201);
  return id;
}

const evento = (u: Usuario, pid: string, ev: 'CONCEDIDO' | 'REVOGADO') =>
  com(u.token, http().post(`/pacientes/${pid}/consentimento`))
    .send({ evento: ev })
    .expect(201);

const criar = async (
  u: Usuario,
  pid: string,
  corpo: object = { tipo: 'EVOLUCAO', conteudo: TEXTO },
) => (await post(u, pid, corpo).expect(201)).body as Documento;

const criarAprovado = async (u: Usuario, pid: string, conteudo = TEXTO) => {
  const d = await criar(u, pid, { tipo: 'EVOLUCAO', conteudo });
  return (await aprovar(u, pid, d.id).expect(200)).body as Documento;
};

const linhaCrua = (u: Usuario, id: string) =>
  app
    .get(TenantPrismaService)
    .runComoUsuario(u, (tx) =>
      tx.documento.findFirstOrThrow({ where: { id } }),
    );
const trilha = (u: Usuario, acao?: string) =>
  app.get(TenantPrismaService).runComoUsuario(u, (tx) =>
    tx.auditoria.findMany({
      where: { recurso: 'Documento', ...(acao && { acao }) },
      select: { acao: true, recursoId: true },
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

describe('PATCH /pacientes/:id/documentos/:docId (editar rascunho)', () => {
  it('200: cifra nova no banco, mesmo AAD (a leitura devolve o texto novo), corpo completo', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid);
    const antes = (await linhaCrua(a, d.id)).conteudoCifrado;
    const res = await editar(a, pid, d.id, { conteudo: NOVO }).expect(200);
    const e = res.body as Documento;
    expect(e).toMatchObject({
      id: d.id,
      pacienteId: pid,
      tipo: 'EVOLUCAO',
      conteudo: NOVO,
      status: 'RASCUNHO',
      aprovadoEm: null,
      substituiId: null,
    });
    expect(Object.keys(e)).not.toContain('conteudoCifrado');
    expect(new Date(e.atualizadoEm).getTime()).toBeGreaterThanOrEqual(
      new Date(d.atualizadoEm).getTime(),
    );
    const depois = (await linhaCrua(a, d.id)).conteudoCifrado;
    expect(depois).toMatch(/^v1\.k1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(depois).not.toBe(antes);
    expect(depois).not.toContain('revisado');
    expect((await ler(a, pid, d.id).expect(200)).body).toMatchObject({
      conteudo: NOVO,
    });
  });

  it('so dataSessao muda a data e mantem o texto; null apaga a data; texto nao e aparado', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid, {
      tipo: 'NOTA_BRUTA',
      dataSessao: '2026-10-01',
      conteudo: TEXTO,
    });
    const r1 = await editar(a, pid, d.id, { dataSessao: '2026-10-02' }).expect(
      200,
    );
    expect(r1.body).toMatchObject({
      dataSessao: '2026-10-02',
      conteudo: TEXTO,
    });
    const r2 = await editar(a, pid, d.id, { dataSessao: null }).expect(200);
    expect(r2.body).toMatchObject({ dataSessao: null, conteudo: TEXTO });
    const r3 = await editar(a, pid, d.id, { conteudo: '  espaco  \n' }).expect(
      200,
    );
    expect((r3.body as Documento).conteudo).toBe('  espaco  \n');
  });

  it('consentimento REVOGADO: editar rascunho continua 200', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid);
    await evento(a, pid, 'REVOGADO');
    await editar(a, pid, d.id, { conteudo: NOVO }).expect(200);
  });

  it('400: corpo vazio, tipo e campos extras, conteudo invalido, data invalida, ids nao-uuid', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid);
    const amanha = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const ruins: object[] = [
      {},
      { tipo: 'ANAMNESE' },
      { conteudo: NOVO, tipo: 'ANAMNESE' },
      { conteudo: NOVO, status: 'APROVADO' },
      { conteudo: NOVO, aprovadoEm: '2026-11-01T00:00:00Z' },
      { conteudo: NOVO, substituiId: randomUUID() },
      { conteudo: NOVO, pacienteId: randomUUID() },
      { conteudo: NOVO, psicologoId: randomUUID() },
      { conteudo: NOVO, conteudoCifrado: 'v1.k1.a.b.c' },
      { conteudo: '' },
      { conteudo: '  \n ' },
      { conteudo: null },
      { conteudo: 123 },
      { conteudo: 'a'.repeat(20001) },
      { dataSessao: amanha },
      { dataSessao: '2026-02-30' },
      { dataSessao: '02/11/2026' },
      { dataSessao: 20261102 },
    ];
    for (const corpo of ruins) {
      await editar(a, pid, d.id, corpo).expect(400);
    }
    await editar(a, pid, d.id, { conteudo: 'a'.repeat(20000) }).expect(200);
    await editar(a, 'nao-uuid', d.id, { conteudo: NOVO }).expect(400);
    await editar(a, pid, 'nao-uuid', { conteudo: NOVO }).expect(400);
    // nada do que foi recusado chegou ao banco
    expect((await linhaCrua(a, d.id)).status).toBe('RASCUNHO');
    expect(
      (await trilha(a, 'EDITOU')).filter((t) => t.recursoId === d.id),
    ).toHaveLength(1);
  });

  it('401 sem token', async () => {
    await editar(undefined, randomUUID(), randomUUID(), {
      conteudo: NOVO,
    }).expect(401);
  });

  it('404 IGUAL: alheio (colega e outra clinica), inexistente e paciente errado na URL; nada muda', async () => {
    const pid = await novoPaciente(a);
    const outro = await novoPaciente(a);
    const d = await criar(a, pid);
    const esperado = (
      await editar(a, pid, randomUUID(), { conteudo: NOVO }).expect(404)
    ).body as object;
    expect(esperado).toMatchObject({
      statusCode: 404,
      message: 'Documento nao encontrado',
    });
    for (const [quem, paciente] of [
      [psi, pid],
      [b, pid],
      [a, outro],
    ] as [Usuario, string][]) {
      expect(
        (
          await editar(quem, paciente, d.id, { conteudo: 'invadido' }).expect(
            404,
          )
        ).body,
      ).toEqual(esperado);
    }
    expect((await ler(a, pid, d.id).expect(200)).body).toMatchObject({
      conteudo: TEXTO,
    });
  });

  it('aprovado = 409 e nada muda no banco', async () => {
    const pid = await novoPaciente(a);
    const ap = await criarAprovado(a, pid);
    const antes = await linhaCrua(a, ap.id);
    const res = await editar(a, pid, ap.id, { conteudo: NOVO }).expect(409);
    expect(res.body).toMatchObject({
      statusCode: 409,
      message: 'Documento aprovado nao pode ser editado',
    });
    await editar(a, pid, ap.id, { dataSessao: null }).expect(409);
    expect(await linhaCrua(a, ap.id)).toEqual(antes);
  });
});

describe('POST /pacientes/:id/documentos/:docId/aprovar', () => {
  it('200: status APROVADO, aprovadoEm, texto igual ao que estava; de novo = 409; editar depois = 409', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid);
    const res = await aprovar(a, pid, d.id).expect(200);
    const ap = res.body as Documento;
    expect(ap).toMatchObject({
      id: d.id,
      status: 'APROVADO',
      conteudo: TEXTO,
      substituiId: null,
    });
    expect(ap.aprovadoEm).not.toBeNull();
    expect(
      Math.abs(Date.now() - new Date(ap.aprovadoEm!).getTime()),
    ).toBeLessThan(60_000);
    const crua = await linhaCrua(a, d.id);
    expect(crua.status).toBe('APROVADO');
    expect(crua.aprovadoEm).not.toBeNull();
    const dnv = await aprovar(a, pid, d.id).expect(409);
    expect(dnv.body).toMatchObject({
      statusCode: 409,
      message: 'Documento ja aprovado',
    });
    await editar(a, pid, d.id, { conteudo: NOVO }).expect(409);
    expect((await ler(a, pid, d.id).expect(200)).body).toMatchObject({
      status: 'APROVADO',
      conteudo: TEXTO,
      aprovadoEm: ap.aprovadoEm,
    });
  });

  it('com consentimento REVOGADO aprovar continua 200 (criar novo e que exige CONCEDIDO)', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid);
    await evento(a, pid, 'REVOGADO');
    await aprovar(a, pid, d.id).expect(200);
    await post(a, pid, {
      tipo: 'EVOLUCAO',
      conteudo: 'correcao',
      substituiId: d.id,
    }).expect(403);
  });

  it('404 IGUAL: alheio (colega e outra clinica), inexistente, paciente errado; 400 ids; 401', async () => {
    const pid = await novoPaciente(a);
    const outro = await novoPaciente(a);
    const d = await criar(a, pid);
    const esperado = (await aprovar(a, pid, randomUUID()).expect(404))
      .body as object;
    for (const [quem, paciente] of [
      [psi, pid],
      [b, pid],
      [a, outro],
    ] as [Usuario, string][]) {
      expect((await aprovar(quem, paciente, d.id).expect(404)).body).toEqual(
        esperado,
      );
    }
    await aprovar(a, 'nao-uuid', d.id).expect(400);
    await aprovar(a, pid, 'nao-uuid').expect(400);
    await aprovar(undefined, pid, d.id).expect(401);
    expect((await linhaCrua(a, d.id)).status).toBe('RASCUNHO');
  });

  it('403 com senha provisoria nas duas rotas novas', async () => {
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
    expect(
      (
        await editar(prov, randomUUID(), randomUUID(), {
          conteudo: 'x',
        }).expect(403)
      ).body,
    ).toEqual(esperado);
    expect(
      (await aprovar(prov, randomUUID(), randomUUID()).expect(403)).body,
    ).toEqual(esperado);
  });

  it('corrida aprovar x editar: nunca aprovado com texto diferente do devolvido na aprovacao', async () => {
    const pid = await novoPaciente(a);
    for (let i = 0; i < 8; i++) {
      const d = await criar(a, pid);
      const [rEd, rAp] = await Promise.all([
        editar(a, pid, d.id, { conteudo: NOVO }),
        aprovar(a, pid, d.id),
      ]);
      expect(rAp.status).toBe(200);
      expect([200, 409]).toContain(rEd.status);
      const aprovadoCom = (rAp.body as Documento).conteudo;
      // editou antes de aprovar: o aprovado tem o texto novo; perdeu a corrida: texto original
      expect(aprovadoCom).toBe(rEd.status === 200 ? NOVO : TEXTO);
      const final = (await ler(a, pid, d.id).expect(200)).body as Documento;
      expect(final.status).toBe('APROVADO');
      expect(final.conteudo).toBe(aprovadoCom);
    }
  });

  it('aprovar duas vezes ao mesmo tempo: um 200 e um 409, uma linha APROVOU', async () => {
    const pid = await novoPaciente(a);
    const d = await criar(a, pid);
    const rs = await Promise.all([
      aprovar(a, pid, d.id),
      aprovar(a, pid, d.id),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await trilha(a, 'APROVOU')).filter((t) => t.recursoId === d.id),
    ).toHaveLength(1);
  });
});

describe('Correcao (substituiId) e filtro por status', () => {
  it('correcao cria RASCUNHO novo ligado ao aprovado; o aprovado nao muda', async () => {
    const pid = await novoPaciente(a);
    const ap = await criarAprovado(a, pid);
    const res = await post(a, pid, {
      tipo: 'EVOLUCAO',
      conteudo: 'versao corrigida',
      substituiId: ap.id,
    }).expect(201);
    const nova = res.body as Documento;
    expect(nova).toMatchObject({
      status: 'RASCUNHO',
      aprovadoEm: null,
      substituiId: ap.id,
      conteudo: 'versao corrigida',
    });
    expect(nova.id).not.toBe(ap.id);
    expect((await ler(a, pid, nova.id).expect(200)).body).toMatchObject({
      substituiId: ap.id,
    });
    expect((await ler(a, pid, ap.id).expect(200)).body).toMatchObject({
      status: 'APROVADO',
      conteudo: TEXTO,
    });
    // a correcao e rascunho: edita e aprova normalmente
    await editar(a, pid, nova.id, { conteudo: 'v2' }).expect(200);
    await aprovar(a, pid, nova.id).expect(200);
  });

  it('correcao de rascunho = 409; inexistente, de outro paciente, de colega e de outra clinica = 404; id nao-uuid = 400', async () => {
    const pid = await novoPaciente(a);
    const outro = await novoPaciente(a);
    const rascunho = await criar(a, pid);
    const apOutroPaciente = await criarAprovado(a, outro);
    const pColega = await novoPaciente(psi);
    const apColega = await criarAprovado(psi, pColega);
    const pB = await novoPaciente(b);
    const apB = await criarAprovado(b, pB);
    const corpo = (substituiId: string) => ({
      tipo: 'EVOLUCAO',
      conteudo: 'x',
      substituiId,
    });
    const r409 = await post(a, pid, corpo(rascunho.id)).expect(409);
    expect(r409.body).toMatchObject({
      message: 'So documento aprovado pode ser corrigido',
    });
    const esperado = (await post(a, pid, corpo(randomUUID())).expect(404))
      .body as object;
    expect(esperado).toMatchObject({ message: 'Documento nao encontrado' });
    for (const alvo of [apOutroPaciente.id, apColega.id, apB.id]) {
      expect((await post(a, pid, corpo(alvo)).expect(404)).body).toEqual(
        esperado,
      );
    }
    await post(a, pid, corpo('nao-uuid')).expect(400);
    // nada foi criado alem do rascunho
    expect((await lista(a, pid).expect(200)).body).toHaveLength(1);
  });

  it('filtro ?status=: RASCUNHO, APROVADO, sem filtro; valor invalido = 400; campos novos na lista', async () => {
    const pid = await novoPaciente(a);
    const ap = await criarAprovado(a, pid);
    const r1 = await criar(a, pid);
    const r2 = await criar(a, pid, {
      tipo: 'EVOLUCAO',
      conteudo: 'corr',
      substituiId: ap.id,
    });
    const ids = async (q: string) =>
      ((await lista(a, pid, q).expect(200)).body as { id: string }[]).map(
        (i) => i.id,
      );
    expect(await ids('?status=APROVADO')).toEqual([ap.id]);
    expect(await ids('?status=RASCUNHO')).toEqual([r2.id, r1.id]);
    expect((await ids('')).sort()).toEqual([ap.id, r1.id, r2.id].sort());
    for (const ruim of [
      '?status=aprovado',
      '?status=X',
      '?status=',
      '?status=RASCUNHO&status=APROVADO',
      '?foo=1',
    ]) {
      await lista(a, pid, ruim).expect(400);
    }
    const itens = (await lista(a, pid).expect(200)).body as Record<
      string,
      unknown
    >[];
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
      expect(Object.keys(i)).not.toContain('conteudo');
    }
    const apItem = itens.find((i) => i.id === ap.id)!;
    expect(apItem.aprovadoEm).toBe(ap.aprovadoEm);
    expect(itens.find((i) => i.id === r2.id)!.substituiId).toBe(ap.id);
  });
});

describe('Auditoria das rotas novas', () => {
  it('EDITOU e APROVOU: uma linha por sucesso, nada em 404/409/400', async () => {
    const u = await novaClinica(email(`aud-${randomUUID().slice(0, 6)}`));
    const pid = await novoPaciente(u);
    const d = await criar(u, pid);
    await editar(u, pid, d.id, { conteudo: NOVO }).expect(200);
    await editar(u, pid, d.id, { conteudo: '' }).expect(400);
    await editar(u, pid, randomUUID(), { conteudo: NOVO }).expect(404);
    await aprovar(u, pid, d.id).expect(200);
    await aprovar(u, pid, d.id).expect(409);
    await editar(u, pid, d.id, { conteudo: NOVO }).expect(409);
    expect(await trilha(u)).toEqual([
      { acao: 'CRIOU', recursoId: d.id },
      { acao: 'EDITOU', recursoId: d.id },
      { acao: 'APROVOU', recursoId: d.id },
    ]);
    const tudo = JSON.stringify(
      await app
        .get(TenantPrismaService)
        .runComoUsuario(u, (tx) => tx.auditoria.findMany()),
    );
    expect(tudo).not.toContain('insonia');
    expect(tudo).not.toContain('revisado');
  });

  it('atomicidade: falha da auditoria no PATCH e no aprovar desfaz a acao', async () => {
    const u = await novaClinica(email(`aud2-${randomUUID().slice(0, 6)}`));
    const pid = await novoPaciente(u);
    const d = await criar(u, pid);
    const falha = () =>
      jest
        .spyOn(app.get(AuditoriaService), 'registrar')
        .mockRejectedValueOnce(new Error('trilha caiu'));
    let spy = falha();
    const r1 = await editar(u, pid, d.id, { conteudo: NOVO }).expect(500);
    spy.mockRestore();
    expect(JSON.stringify(r1.body)).not.toContain('revisado');
    expect((await ler(u, pid, d.id).expect(200)).body).toMatchObject({
      conteudo: TEXTO,
    });
    spy = falha();
    await aprovar(u, pid, d.id).expect(500);
    spy.mockRestore();
    expect((await linhaCrua(u, d.id)).status).toBe('RASCUNHO');
    expect((await linhaCrua(u, d.id)).aprovadoEm).toBeNull();
    expect((await trilha(u)).map((t) => t.acao)).toEqual(['CRIOU', 'LEU']);
  });

  it('atomicidade: falha da auditoria no POST com substituiId nao cria a correcao', async () => {
    const u = await novaClinica(email(`aud3-${randomUUID().slice(0, 6)}`));
    const pid = await novoPaciente(u);
    const ap = await criarAprovado(u, pid);
    const spy = jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('trilha caiu'));
    await post(u, pid, {
      tipo: 'EVOLUCAO',
      conteudo: 'x',
      substituiId: ap.id,
    }).expect(500);
    spy.mockRestore();
    expect((await lista(u, pid).expect(200)).body).toHaveLength(1);
  });
});
