import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { comoOwner } from './acesso-owner';
import { CLIENTE_API } from './cliente-api';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// Exportacao do paciente (LGPD, item 26, portabilidade): GET /pacientes/:id/exportar. Roda no
// Postgres real (RLS). Nao faz TRUNCATE nem DDL: fica no grupo paralelo.
const SENHA = 'senha-forte-123';
const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `exp-${n}-${sufixo}@teste.local`;
const NOME = 'Maria Exporta Original';
const TEL = '(11) 91234-5678';
const EMAIL_PAC = 'maria.exporta@exemplo.com';
const NASC = '1990-05-17';
const RASCUNHO = 'TEXTO-EXPORTA-RASCUNHO-ORIGINAL';
const APROVADO = 'TEXTO-EXPORTA-APROVADO-ORIGINAL';
const CORRECAO = 'TEXTO-EXPORTA-CORRECAO-ORIGINAL';
const ALHEIO = 'TEXTO-EXPORTA-DE-OUTRO-PACIENTE';
const NAO_ENCONTRADO = {
  statusCode: 404,
  message: 'Paciente nao encontrado',
  error: 'Not Found',
};

type Usuario = { clinicaId: string; psicologoId: string; token: string };

let app: NestExpressApplication;
let admin: Usuario;
let colega: Usuario;
let outraClinica: Usuario;
const criadas: string[] = [];
const envAntes = { ...process.env };

const http = () => request(app.getHttpServer());
const com = (token: string | undefined, r: request.Test) =>
  token ? r.set('Authorization', `Bearer ${token}`) : r;
const corpo = <T>(r: { body: unknown }) => r.body as T;

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

const exportar = (u: Usuario | undefined, pid: string) =>
  com(u?.token, http().get(`/pacientes/${pid}/exportar`));

async function criarPaciente(u: Usuario) {
  const r = await com(u.token, http().post('/pacientes'))
    .send({ nome: NOME, nascimento: NASC, telefone: TEL, email: EMAIL_PAC })
    .expect(201);
  return corpo<{ id: string }>(r).id;
}

async function criarDoc(
  u: Usuario,
  pid: string,
  conteudo: string,
  substituiId?: string,
) {
  const r = await com(u.token, http().post(`/pacientes/${pid}/documentos`))
    .send({
      tipo: 'NOTA_BRUTA',
      conteudo,
      ...(substituiId && { substituiId }),
    })
    .expect(201);
  return corpo<{ id: string }>(r).id;
}

// Paciente com: convite de consentimento (PENDENTE; so cria sem consentimento concedido), consentimento
// concedido pelo psicologo, rascunho, aprovado e correcao (aponta para o aprovado).
async function pacienteComHistorico(u: Usuario) {
  const pid = await criarPaciente(u);
  const convite = await com(
    u.token,
    http().post(`/pacientes/${pid}/convites-consentimento`),
  ).expect(201);
  const link = corpo<{ link: string }>(convite).link;
  await com(u.token, http().post(`/pacientes/${pid}/consentimento`))
    .send({ evento: 'CONCEDIDO' })
    .expect(201);
  const rascunho = await criarDoc(u, pid, RASCUNHO);
  const aprovado = await criarDoc(u, pid, APROVADO);
  await com(
    u.token,
    http().post(`/pacientes/${pid}/documentos/${aprovado}/aprovar`),
  ).expect(200);
  const correcao = await criarDoc(u, pid, CORRECAO, aprovado);
  return {
    pid,
    rascunho,
    aprovado,
    correcao,
    token: link.slice(link.lastIndexOf('/') + 1),
  };
}

// Contagem de EXPORTOU para um paciente, lida como praxis_owner no contexto do psicologo.
const exportacoesAuditadas = (u: Usuario, pid: string) =>
  comoOwner(
    u.clinicaId,
    (tx) =>
      tx.auditoria.count({
        where: {
          psicologoId: u.psicologoId,
          acao: 'EXPORTOU',
          recursoId: pid,
        },
      }),
    { psicologoId: u.psicologoId },
  );

beforeAll(async () => {
  app = await criarAppSemLimite();
  const dono = await novaClinica(email('admin'));
  admin = { ...dono };
  colega = await novoColega(admin, email('colega'));
  outraClinica = await novaClinica(email('outra'));
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
  process.env = envAntes;
});

describe('GET /pacientes/:id/exportar (item 26, portabilidade)', () => {
  it('sem token: 401', async () => {
    const p = await pacienteComHistorico(admin);
    await exportar(undefined, p.pid).expect(401);
  });

  it('o proprio paciente: 200 com cabecalhos de anexo, sem cache e nome do arquivo so com o uuid', async () => {
    const dono = await novaClinica(email('cab'));
    const p = await pacienteComHistorico(dono);
    const r = await exportar(dono, p.pid).expect(200);
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers['content-disposition']).toBe(
      `attachment; filename="paciente-${p.pid}.json"`,
    );
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-disposition']).not.toContain(NOME);
  });

  it('formato versionado e conteudo decifrado bate com o original; todos os documentos do paciente', async () => {
    const dono = await novaClinica(email('formato'));
    const p = await pacienteComHistorico(dono);
    const d = corpo<{
      versao: number;
      geradoEm: string;
      paciente: Record<string, unknown>;
      consentimentos: { evento: string; termoVersao: string }[];
      documentos: {
        id: string;
        status: string;
        conteudo: string;
        substituiId: string | null;
        aprovadoEm: string | null;
      }[];
      convites: { estado: string }[];
      aviso: string;
    }>(await exportar(dono, p.pid).expect(200));

    expect(d.versao).toBe(1);
    expect(new Date(d.geradoEm).toISOString()).toBe(d.geradoEm);
    expect(d.paciente).toMatchObject({
      id: p.pid,
      nome: NOME,
      nascimento: NASC,
      telefone: TEL,
      email: EMAIL_PAC,
    });
    expect(d.consentimentos).toHaveLength(1);
    expect(d.consentimentos[0].evento).toBe('CONCEDIDO');
    expect(d.consentimentos[0].termoVersao).toBeTruthy();
    expect(d.convites).toHaveLength(1);
    expect(d.convites[0].estado).toBe('PENDENTE');
    expect(d.aviso.length).toBeGreaterThan(20);

    expect(d.documentos).toHaveLength(3);
    const porId = new Map(d.documentos.map((x) => [x.id, x]));
    expect(porId.get(p.rascunho)).toMatchObject({
      status: 'RASCUNHO',
      conteudo: RASCUNHO,
      aprovadoEm: null,
    });
    expect(porId.get(p.aprovado)).toMatchObject({
      status: 'APROVADO',
      conteudo: APROVADO,
    });
    expect(porId.get(p.aprovado)!.aprovadoEm).not.toBeNull();
    expect(porId.get(p.correcao)).toMatchObject({
      status: 'RASCUNHO',
      conteudo: CORRECAO,
      substituiId: p.aprovado,
    });
  });

  it('o JSON nao tem colunas cifradas, tokens, hashes nem senha; o token do convite nao aparece', async () => {
    const dono = await novaClinica(email('segredos'));
    const p = await pacienteComHistorico(dono);
    const texto = (await exportar(dono, p.pid).expect(200)).text;
    expect(texto).not.toMatch(/Cifrado/);
    expect(texto).not.toMatch(/token/i);
    expect(texto).not.toMatch(/hash/i);
    expect(texto).not.toMatch(/senha/i);
    expect(texto).not.toContain(p.token);
    expect(texto).not.toContain(dono.token);
  });

  it('documento de OUTRO paciente do mesmo psicologo nao aparece no arquivo', async () => {
    const dono = await novaClinica(email('vizinho'));
    const p = await pacienteComHistorico(dono);
    const outro = await criarPaciente(dono);
    await com(dono.token, http().post(`/pacientes/${outro}/consentimento`))
      .send({ evento: 'CONCEDIDO' })
      .expect(201);
    await criarDoc(dono, outro, ALHEIO);
    const texto = (await exportar(dono, p.pid).expect(200)).text;
    expect(texto).not.toContain(ALHEIO);
    const lido = JSON.parse(texto) as { documentos: unknown[] };
    expect(lido.documentos).toHaveLength(3);
  });

  it('404 IDENTICO para inexistente, colega, ADMIN lendo paciente de colega, outra clinica e ja excluido', async () => {
    const dono = await novaClinica(email('ident'));
    const p = await pacienteComHistorico(dono);
    const inexistente = await exportar(dono, randomUUID()).expect(404);
    expect(inexistente.body).toEqual(NAO_ENCONTRADO);

    const doColega = await exportar(colega, p.pid).expect(404);
    const doAdmin = await exportar(admin, p.pid).expect(404);
    const deOutra = await exportar(outraClinica, p.pid).expect(404);
    for (const r of [doColega, doAdmin, deOutra]) {
      expect(r.body).toEqual(inexistente.body);
      expect(r.headers['content-disposition']).toBeUndefined();
    }
  });

  it('paciente excluido nao exporta: 404 identico ao inexistente', async () => {
    const dono = await novaClinica(email('excluido'));
    const p = await pacienteComHistorico(dono);
    await com(dono.token, http().delete(`/pacientes/${p.pid}`)).expect(200);
    const r = await exportar(dono, p.pid).expect(404);
    const inexistente = await exportar(dono, randomUUID()).expect(404);
    expect(r.body).toEqual(inexistente.body);
    expect(r.body).toEqual(NAO_ENCONTRADO);
  });

  it('trilha: 1 linha EXPORTOU por exportacao; 404 nao grava nenhuma', async () => {
    const dono = await novaClinica(email('trilha'));
    const p = await pacienteComHistorico(dono);
    expect(await exportacoesAuditadas(dono, p.pid)).toBe(0);
    await exportar(dono, p.pid).expect(200);
    await exportar(dono, p.pid).expect(200);
    expect(await exportacoesAuditadas(dono, p.pid)).toBe(2);
    await exportar(colega, p.pid).expect(404);
    await exportar(dono, randomUUID()).expect(404);
    expect(await exportacoesAuditadas(dono, p.pid)).toBe(2);
  });
});

describe('GET /pacientes/:id/exportar: lacunas do contrato', () => {
  it('GeracaoIa (texto anonimizado e mapa) existe no banco e fica FORA do arquivo', async () => {
    const dono = await novaClinica(email('geracao'));
    const p = await pacienteComHistorico(dono);
    await comoOwner(
      dono.clinicaId,
      (tx) =>
        tx.geracaoIa.create({
          data: {
            id: randomUUID(),
            clinicaId: dono.clinicaId,
            psicologoId: dono.psicologoId,
            pacienteId: p.pid,
            origemId: p.rascunho,
            tipoDocumento: 'EVOLUCAO',
            abordagem: 'TCC',
            estado: 'PREVIA',
            textoCifrado: 'GERACAO-TEXTO-ANONIMIZADO',
            mapaCifrado: 'GERACAO-MAPA-PSEUDONIMOS',
            expiraEm: new Date(Date.now() + 60_000),
          },
        }),
      { psicologoId: dono.psicologoId },
    );
    const texto = (await exportar(dono, p.pid).expect(200)).text;
    expect(texto).not.toContain('GERACAO-TEXTO-ANONIMIZADO');
    expect(texto).not.toContain('GERACAO-MAPA-PSEUDONIMOS');
    expect(texto).not.toMatch(/geracao|mapa|textoCifrado/i);
    expect(JSON.parse(texto)).not.toHaveProperty('geracoes');
  });

  it('documento que nao decifra: 500 generico, sem arquivo parcial e sem auditoria EXPORTOU', async () => {
    const dono = await novaClinica(email('quebrado'));
    const p = await pacienteComHistorico(dono);
    // Troca o cifrado do rascunho pelo do aprovado: o AAD (id) nao confere mais.
    await comoOwner(
      dono.clinicaId,
      async (tx) => {
        const aprovado = await tx.documento.findFirstOrThrow({
          where: { id: p.aprovado },
        });
        await tx.documento.update({
          where: { id: p.rascunho },
          data: { conteudoCifrado: aprovado.conteudoCifrado },
        });
      },
      { psicologoId: dono.psicologoId },
    );
    const r = await exportar(dono, p.pid).expect(500);
    expect(r.body).toEqual({
      statusCode: 500,
      message: 'Internal Server Error',
    });
    expect(r.headers['content-disposition']).toBeUndefined();
    expect(r.text).not.toContain(APROVADO);
    expect(r.text).not.toContain(NOME);
    expect(await exportacoesAuditadas(dono, p.pid)).toBe(0);
  });

  it('convite aceito pelo paciente: consentimento origem PACIENTE com o conviteId, convite ACEITO, sem token', async () => {
    const dono = await novaClinica(email('aceito'));
    const pid = await criarPaciente(dono);
    const convite = await com(
      dono.token,
      http().post(`/pacientes/${pid}/convites-consentimento`),
    ).expect(201);
    const { link } = corpo<{ link: string }>(convite);
    const token = link.slice(link.lastIndexOf('/') + 1);
    await http()
      .post(`/publico/consentimento/${token}/aceitar`)
      .send({ aceito: true })
      .expect(200);
    const r = await exportar(dono, pid).expect(200);
    const d = corpo<{
      consentimentos: {
        evento: string;
        origem: string;
        conviteId: string | null;
      }[];
      convites: { id: string; estado: string; usadoEm: string | null }[];
    }>(r);
    expect(d.convites).toHaveLength(1);
    expect(d.convites[0].estado).toBe('ACEITO');
    expect(d.convites[0].usadoEm).not.toBeNull();
    expect(d.consentimentos).toHaveLength(1);
    expect(d.consentimentos[0]).toMatchObject({
      evento: 'CONCEDIDO',
      origem: 'PACIENTE',
      conviteId: d.convites[0].id,
    });
    expect(r.text).not.toContain(token);
    expect(r.text).not.toMatch(/token|hash/i);
  });
});

describe('GET /pacientes/:id/exportar: limite por psicologo', () => {
  it('10 por hora por psicologo: a 11a = 429 com Retry-After; a leitura normal do paciente segue 200', async () => {
    const dono = await novaClinica(email('limite'));
    const pid = await criarPaciente(dono);
    const limitado = await criarApp();
    try {
      const chamar = () =>
        com(
          dono.token,
          request(limitado.getHttpServer()).get(`/pacientes/${pid}/exportar`),
        );
      for (let i = 0; i < 10; i++) await chamar().expect(200);
      const barrada = await chamar().expect(429);
      const retry = Number(barrada.headers['retry-after']);
      expect(Number.isInteger(retry) && retry > 0).toBe(true);
      await com(
        dono.token,
        request(limitado.getHttpServer()).get(`/pacientes/${pid}`),
      ).expect(200);
    } finally {
      await limitado.close();
    }
  });
});
