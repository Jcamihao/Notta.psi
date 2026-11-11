import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuditoriaService } from '../src/auditoria/auditoria.service';
import {
  aadDe,
  CriptografiaService,
} from '../src/criptografia/criptografia.service';
import { aadGeracao } from '../src/geracao-ia/geracao-ia.tipos';
import { comoOwner } from './acesso-owner';
import { CLIENTE_API } from './cliente-api';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';
import {
  ok,
  RASCUNHO_PADRAO,
  status,
  subirSelahiaFalso,
} from './selahia-falso';

// Exclusao por anonimizacao (item 26) pela API: DELETE /pacientes/:id, o 404 identico, o uso normal
// barrado, o texto original fora de TODAS as colunas (decifrado como dono), a trilha, a corrida e a
// falha no meio. Roda no Postgres real (RLS + funcao SECURITY DEFINER). Nao faz TRUNCATE nem DDL.
const SENHA = 'senha-forte-123';
const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `exc-${n}-${sufixo}@teste.local`;
const NOME = 'Maria Exclusao Original';
const TEL = '(11) 91234-5678';
const EMAIL_PAC = 'maria.exclusao@exemplo.com';
const NASC = '1990-05-17';
const CLINICO_RASCUNHO = 'TEXTO-CLINICO-RASCUNHO-ORIGINAL';
const CLINICO_APROVADO = 'TEXTO-CLINICO-APROVADO-ORIGINAL';
const TOMB_NOME = 'Paciente excluido';
const TOMB_CONTEUDO = 'Conteudo excluido a pedido (LGPD)';
// Nada disto pode sobrar em nenhuma coluna decifrada depois da exclusao.
const PROIBIDOS = [
  NOME,
  'Maria Exclusao',
  TEL,
  EMAIL_PAC,
  CLINICO_RASCUNHO,
  CLINICO_APROVADO,
];

type Usuario = { clinicaId: string; psicologoId: string; token: string };
type Ids = { p?: string; d?: string; g?: string };
type Linhas = Awaited<ReturnType<typeof lerTudo>>;

let app: NestExpressApplication;
let falso: Awaited<ReturnType<typeof subirSelahiaFalso>>;
let cripto: CriptografiaService;
let admin: Usuario;
let colega: Usuario;
let outraClinica: Usuario;
const criadas: string[] = [];
const envAntes = { ...process.env };

const http = () => request(app.getHttpServer());
const com = (token: string | undefined, r: request.Test) =>
  token ? r.set('Authorization', `Bearer ${token}`) : r;
const corpo = <T>(r: { body: unknown }) => r.body as T;
const dormir = (ms: number) => new Promise((f) => setTimeout(f, ms));

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

// Colega criado pelo ADMIN, ja com a senha trocada (senao toda rota daria 403).
async function novoColega(dono: Usuario, e: string): Promise<Usuario> {
  const res = await http()
    .post('/psicologos')
    .set('Authorization', `Bearer ${dono.token}`)
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
    clinicaId: dono.clinicaId,
    psicologoId: (res.body as { psicologoId: string }).psicologoId,
    token: (troca.body as { token: string }).token,
  };
}

// Leitura como notta_owner, no contexto do psicologo (RLS). So SELECT.
const lerTudo = (u: Usuario, pid?: string) =>
  comoOwner(
    u.clinicaId,
    async (tx) => ({
      pacientes: await tx.paciente.findMany({
        where: { psicologoId: u.psicologoId, ...(pid && { id: pid }) },
      }),
      documentos: await tx.documento.findMany({
        where: { psicologoId: u.psicologoId, ...(pid && { pacienteId: pid }) },
      }),
      geracoes: await tx.geracaoIa.findMany({
        where: { psicologoId: u.psicologoId, ...(pid && { pacienteId: pid }) },
      }),
      convites: await tx.conviteConsentimento.findMany({
        where: { psicologoId: u.psicologoId, ...(pid && { pacienteId: pid }) },
      }),
      exclusoes: await tx.auditoria.findMany({
        where: { psicologoId: u.psicologoId, acao: 'EXCLUIU' },
      }),
    }),
    { psicologoId: u.psicologoId },
  );

// Decifra TODA coluna cifrada que o paciente tem no banco, com o AAD da propria linha.
function decifrarTudo(u: Usuario, t: Linhas): string[] {
  const claros: string[] = [];
  const d = (valor: string, aad: string) =>
    claros.push(cripto.decifrar(u.clinicaId, valor, aad));
  for (const p of t.pacientes) {
    d(p.nomeCifrado, aadDe('Paciente', 'nomeCifrado', p.id, u.psicologoId));
    for (const c of [
      'nascimentoCifrado',
      'telefoneCifrado',
      'emailCifrado',
    ] as const) {
      const v = p[c];
      if (v) d(v, aadDe('Paciente', c, p.id, u.psicologoId));
    }
  }
  for (const doc of t.documentos) {
    d(
      doc.conteudoCifrado,
      aadDe('Documento', 'conteudoCifrado', doc.id, u.psicologoId),
    );
  }
  for (const g of t.geracoes) {
    if (g.textoCifrado)
      d(g.textoCifrado, aadGeracao('textoCifrado', g.id, u.psicologoId));
    if (g.mapaCifrado)
      d(g.mapaCifrado, aadGeracao('mapaCifrado', g.id, u.psicologoId));
  }
  return claros;
}

async function criarDoc(u: Usuario, pid: string, conteudo: string) {
  const r = await com(u.token, http().post(`/pacientes/${pid}/documentos`))
    .send({ tipo: 'NOTA_BRUTA', conteudo })
    .expect(201);
  return corpo<{ id: string }>(r).id;
}

async function previa(u: Usuario, pid: string, origem: string) {
  const r = await com(
    u.token,
    http().post(`/pacientes/${pid}/documentos/${origem}/previa-ia`),
  )
    .send({ tipoDocumento: 'EVOLUCAO' })
    .expect(201);
  return corpo<{ id: string }>(r).id;
}

const consultar = (u: Usuario, id: string) =>
  com(u.token, http().get(`/geracoes-ia/${id}`));

async function esperar(u: Usuario, id: string, estados: string[]) {
  for (let i = 0; i < 200; i++) {
    const r = await consultar(u, id).expect(200);
    const estado = corpo<{ estado: string }>(r).estado;
    if (estados.includes(estado)) return estado;
    await dormir(50);
  }
  throw new Error(`geracao ${id} nao chegou a ${estados.join('/')}`);
}

// Paciente com: rascunho, aprovado, 1 geracao PRONTA (documento de IA), 1 PREVIA e 1 FALHOU.
async function pacienteComHistorico(u: Usuario) {
  const pid = corpo<{ id: string }>(
    await com(u.token, http().post('/pacientes'))
      .send({ nome: NOME, nascimento: NASC, telefone: TEL, email: EMAIL_PAC })
      .expect(201),
  ).id;
  await com(u.token, http().post(`/pacientes/${pid}/consentimento`))
    .send({ evento: 'CONCEDIDO' })
    .expect(201);
  const rascunho = await criarDoc(u, pid, CLINICO_RASCUNHO);
  const aprovado = await criarDoc(u, pid, CLINICO_APROVADO);
  await com(
    u.token,
    http().post(`/pacientes/${pid}/documentos/${aprovado}/aprovar`),
  ).expect(200);

  const pronta = await previa(u, pid, rascunho);
  await com(u.token, http().post(`/geracoes-ia/${pronta}/confirmar`)).expect(
    202,
  );
  expect(await esperar(u, pronta, ['PRONTO', 'FALHOU'])).toBe('PRONTO');

  const previaIa = await previa(u, pid, aprovado);

  falso.responder(status(503));
  const falhou = await previa(u, pid, rascunho);
  await com(u.token, http().post(`/geracoes-ia/${falhou}/confirmar`)).expect(
    202,
  );
  expect(await esperar(u, falhou, ['FALHOU'])).toBe('FALHOU');
  falso.responder(ok(RASCUNHO_PADRAO));

  return { pid, rascunho, aprovado, pronta, previa: previaIa, falhou };
}

// Excluir pela API: o paciente do token. Devolve a resposta crua.
const excluir = (u: Usuario | undefined, pid: string) =>
  com(u?.token, http().delete(`/pacientes/${pid}`));

beforeAll(async () => {
  falso = await subirSelahiaFalso();
  // IA ligada, apontando para o falso (a previa e o executor precisam dela).
  process.env.NOTTA_IA_HABILITADA = '1';
  process.env.SELAHIA_URL = falso.url;
  process.env.SELAHIA_API_KEY = `chave-so-de-teste-${randomUUID().replace(/-/g, '')}`;
  process.env.NOTTA_IA_LIMITE_DIARIO = '500';
  app = await criarAppSemLimite();
  cripto = app.get(CriptografiaService);
  const dono = await novaClinica(email('admin'));
  admin = { ...dono, token: dono.token };
  colega = await novoColega(admin, email('colega'));
  outraClinica = await novaClinica(email('outra'));
});

beforeEach(() => falso.responder(ok(RASCUNHO_PADRAO)));

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
  await falso.fechar();
  process.env = envAntes;
});

describe('DELETE /pacientes/:id (item 26, LGPD)', () => {
  it('sem token: 401 (e nada muda)', async () => {
    const p = await pacienteComHistorico(admin);
    await excluir(undefined, p.pid).expect(401);
    await com(admin.token, http().get(`/pacientes/${p.pid}`)).expect(200);
  });

  it('o proprio paciente: 200 com excluidoEm (ISO); GET 404; some da lista e fica fora do que o app ve', async () => {
    const dono = await novaClinica(email('dono1'));
    const p = await pacienteComHistorico(dono);
    const outro = corpo<{ id: string }>(
      await com(dono.token, http().post('/pacientes'))
        .send({ nome: 'Outro Paciente' })
        .expect(201),
    ).id;

    const r = await excluir(dono, p.pid).expect(200);
    expect(corpo<{ excluidoEm: string }>(r).excluidoEm).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
    );
    await com(dono.token, http().get(`/pacientes/${p.pid}`)).expect(404);

    const lista = corpo<{ id: string }[]>(
      await com(dono.token, http().get('/pacientes')).expect(200),
    );
    expect(lista.map((x) => x.id)).toEqual([outro]);
  });

  it('alheio (colega, outra clinica) e inexistente: 404 com o MESMO corpo; nada muda', async () => {
    const dono = await novaClinica(email('dono2'));
    const p = await pacienteComHistorico(dono);
    const inexistente = await excluir(dono, randomUUID()).expect(404);
    const doColega = await excluir(colega, p.pid).expect(404);
    const deOutraClinica = await excluir(outraClinica, p.pid).expect(404);
    expect(doColega.body).toEqual(inexistente.body);
    expect(deOutraClinica.body).toEqual(inexistente.body);

    const t = await lerTudo(dono, p.pid);
    expect(t.pacientes[0].excluidoEm).toBeNull();
    expect(t.pacientes[0].nomeCifrado).not.toBe(TOMB_NOME);
  });

  it('paciente ja excluido: 404 identico ao inexistente, e a segunda exclusao nao audita de novo', async () => {
    const dono = await novaClinica(email('dono3'));
    const p = await pacienteComHistorico(dono);
    await excluir(dono, p.pid).expect(200);
    const de2 = await excluir(dono, p.pid).expect(404);
    const inexistente = await excluir(dono, randomUUID()).expect(404);
    expect(de2.body).toEqual(inexistente.body);
    const t = await lerTudo(dono, p.pid);
    expect(t.exclusoes).toHaveLength(1);
  });

  it('ADMIN da clinica nao exclui paciente de colega: 404 identico ao inexistente', async () => {
    const dono = await novoColega(admin, email('colega-b'));
    const p = await pacienteComHistorico(dono);
    const doAdmin = await excluir(admin, p.pid).expect(404);
    const inexistente = await excluir(admin, randomUUID()).expect(404);
    expect(doAdmin.body).toEqual(inexistente.body);
    expect((await lerTudo(dono, p.pid)).pacientes[0].excluidoEm).toBeNull();
  });

  it('uso normal do excluido: todo endpoint responde 404 IDENTICO ao de id inexistente', async () => {
    const dono = await novaClinica(email('dono4'));
    const p = await pacienteComHistorico(dono);
    await excluir(dono, p.pid).expect(200);

    const alvos: {
      nome: string;
      m: 'get' | 'post' | 'patch';
      caminho: (i: Ids) => string;
      corpo?: object;
    }[] = [
      { nome: 'GET paciente', m: 'get', caminho: (i) => `/pacientes/${i.p}` },
      {
        nome: 'PATCH paciente',
        m: 'patch',
        caminho: (i) => `/pacientes/${i.p}`,
        corpo: { telefone: '11 90000-0000' },
      },
      {
        nome: 'POST documento',
        m: 'post',
        caminho: (i) => `/pacientes/${i.p}/documentos`,
        corpo: { tipo: 'NOTA_BRUTA', conteudo: 'NOVO TEXTO' },
      },
      {
        nome: 'GET documentos',
        m: 'get',
        caminho: (i) => `/pacientes/${i.p}/documentos`,
      },
      {
        nome: 'GET documento',
        m: 'get',
        caminho: (i) => `/pacientes/${i.p}/documentos/${i.d}`,
      },
      {
        nome: 'PATCH documento',
        m: 'patch',
        caminho: (i) => `/pacientes/${i.p}/documentos/${i.d}`,
        corpo: { conteudo: 'NOVO TEXTO' },
      },
      {
        nome: 'aprovar rascunho',
        m: 'post',
        caminho: (i) => `/pacientes/${i.p}/documentos/${i.d}/aprovar`,
      },
      {
        nome: 'previa de IA',
        m: 'post',
        caminho: (i) => `/pacientes/${i.p}/documentos/${i.d}/previa-ia`,
        corpo: { tipoDocumento: 'EVOLUCAO' },
      },
      {
        nome: 'lista de geracoes',
        m: 'get',
        caminho: (i) => `/pacientes/${i.p}/geracoes-ia`,
      },
      { nome: 'GET geracao', m: 'get', caminho: (i) => `/geracoes-ia/${i.g}` },
      {
        nome: 'GET previa',
        m: 'get',
        caminho: (i) => `/geracoes-ia/${i.g}/previa`,
      },
      {
        nome: 'confirmar geracao',
        m: 'post',
        caminho: (i) => `/geracoes-ia/${i.g}/confirmar`,
      },
      {
        nome: 'GET consentimento',
        m: 'get',
        caminho: (i) => `/pacientes/${i.p}/consentimento`,
      },
      {
        nome: 'POST consentimento',
        m: 'post',
        caminho: (i) => `/pacientes/${i.p}/consentimento`,
        corpo: { evento: 'REVOGADO' },
      },
      {
        nome: 'criar convite',
        m: 'post',
        caminho: (i) => `/pacientes/${i.p}/convites-consentimento`,
      },
      {
        nome: 'listar convites',
        m: 'get',
        caminho: (i) => `/pacientes/${i.p}/convites-consentimento`,
      },
    ];

    for (const a of alvos) {
      const ids: Ids = { p: p.pid, d: p.aprovado, g: p.previa };
      const vazios: Ids = { p: randomUUID(), d: randomUUID(), g: randomUUID() };
      const doExcluido = await com(
        dono.token,
        http()
          [a.m](a.caminho(ids))
          .send(a.corpo ?? {}),
      );
      const deInexistente = await com(
        dono.token,
        http()
          [a.m](a.caminho(vazios))
          .send(a.corpo ?? {}),
      );
      expect({ nome: a.nome, status: doExcluido.status }).toEqual({
        nome: a.nome,
        status: 404,
      });
      expect({ nome: a.nome, corpo: doExcluido.body as unknown }).toEqual({
        nome: a.nome,
        corpo: deInexistente.body as unknown,
      });
    }

    // Nada gravado pelas tentativas: o texto segue o do tombstone (nenhum "NOVO TEXTO").
    const t = await lerTudo(dono, p.pid);
    expect(JSON.stringify(decifrarTudo(dono, t))).not.toContain('NOVO TEXTO');
    expect(t.convites).toHaveLength(0);
  });

  it('documento aprovado e rascunho viram tombstone; o texto original NAO sobra em nenhuma coluna; PRONTA e PREVIA/FALHOU coerentes', async () => {
    const dono = await novaClinica(email('dono5'));
    const p = await pacienteComHistorico(dono);
    const antes = await lerTudo(dono, p.pid);
    const aprovadoAntes = antes.documentos.find((d) => d.id === p.aprovado)!;
    const pronta = antes.geracoes.find((g) => g.id === p.pronta)!;
    expect(pronta.documentoId).not.toBeNull();

    await excluir(dono, p.pid).expect(200);
    const t = await lerTudo(dono, p.pid);

    // Paciente: identificadores somem, excluidoEm marcado.
    const pac = t.pacientes[0];
    expect(pac.excluidoEm).toBeInstanceOf(Date);
    expect(pac.nascimentoCifrado).toBeNull();
    expect(pac.telefoneCifrado).toBeNull();
    expect(pac.emailCifrado).toBeNull();
    expect(
      cripto.decifrar(
        dono.clinicaId,
        pac.nomeCifrado,
        aadDe('Paciente', 'nomeCifrado', p.pid, dono.psicologoId),
      ),
    ).toBe(TOMB_NOME);

    // Documentos: TODOS (rascunho, aprovado e o gerado pela IA) com tombstone e sem data de sessao.
    expect(t.documentos).toHaveLength(3);
    for (const d of t.documentos) {
      expect(
        cripto.decifrar(
          dono.clinicaId,
          d.conteudoCifrado,
          aadDe('Documento', 'conteudoCifrado', d.id, dono.psicologoId),
        ),
      ).toBe(TOMB_CONTEUDO);
      expect(d.dataSessao).toBeNull();
    }
    // Aprovado continua aprovado, com a mesma data de aprovacao.
    const aprovado = t.documentos.find((d) => d.id === p.aprovado)!;
    expect(aprovado.status).toBe('APROVADO');
    expect(aprovado.aprovadoEm).toEqual(aprovadoAntes.aprovadoEm);

    // Geracoes: PRONTA segue PRONTA com cifrados zerados (sem texto); as demais viram tombstone.
    const gPronta = t.geracoes.find((g) => g.id === p.pronta)!;
    expect(gPronta).toMatchObject({
      estado: 'PRONTO',
      textoCifrado: null,
      mapaCifrado: null,
    });
    for (const id of [p.previa, p.falhou]) {
      const g = t.geracoes.find((x) => x.id === id)!;
      expect(
        cripto.decifrar(
          dono.clinicaId,
          g.textoCifrado!,
          aadGeracao('textoCifrado', g.id, dono.psicologoId),
        ),
      ).toBe(TOMB_CONTEUDO);
      expect(
        cripto.decifrar(
          dono.clinicaId,
          g.mapaCifrado!,
          aadGeracao('mapaCifrado', g.id, dono.psicologoId),
        ),
      ).toBe('{}');
    }

    // Nenhum texto original em nenhuma coluna decifrada (o nome aparece dentro do documento
    // gerado pela IA antes da exclusao; depois tem que sumir).
    const claros = decifrarTudo(dono, t).join('\n');
    for (const proibido of PROIBIDOS) {
      expect(claros).not.toContain(proibido);
    }
  });

  it('trilha: exatamente 1 linha EXCLUIU com recursoId do paciente', async () => {
    const dono = await novaClinica(email('dono6'));
    const p = await pacienteComHistorico(dono);
    await excluir(dono, p.pid).expect(200);
    const t = await lerTudo(dono, p.pid);
    expect(t.exclusoes).toHaveLength(1);
    expect(t.exclusoes[0]).toMatchObject({
      acao: 'EXCLUIU',
      recursoId: p.pid,
      recurso: 'Paciente',
    });
  });

  it('duas exclusoes simultaneas: exatamente uma 200 e uma 404 (a funcao garante)', async () => {
    const dono = await novaClinica(email('dono7'));
    const p = await pacienteComHistorico(dono);
    const [a, b] = await Promise.all([
      excluir(dono, p.pid),
      excluir(dono, p.pid),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const perdedora = a.status === 404 ? a : b;
    const inexistente = await excluir(dono, randomUUID()).expect(404);
    expect(perdedora.body).toEqual(inexistente.body);
    expect((await lerTudo(dono, p.pid)).exclusoes).toHaveLength(1);
  });

  it('falha no meio (auditoria cai depois da funcao): 500 e TUDO intacto', async () => {
    const dono = await novaClinica(email('dono8'));
    const p = await pacienteComHistorico(dono);
    const antes = await lerTudo(dono, p.pid);
    jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('falha simulada'));

    const r = await excluir(dono, p.pid).expect(500);
    expect(JSON.stringify(r.body)).not.toContain('falha simulada');

    const depois = await lerTudo(dono, p.pid);
    expect(depois.pacientes[0]).toEqual(antes.pacientes[0]);
    expect(depois.documentos).toEqual(antes.documentos);
    expect(depois.geracoes).toEqual(antes.geracoes);
    expect(depois.exclusoes).toHaveLength(0);
    await com(dono.token, http().get(`/pacientes/${p.pid}`)).expect(200);
    // E a exclusao, feita de novo, funciona.
    await excluir(dono, p.pid).expect(200);
  });
});
