import { randomUUID } from 'node:crypto';
import { LoggerService } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuditoriaService } from '../src/auditoria/auditoria.service';
import { relogio } from '../src/comum/relogio';
import { TERMO_VIGENTE } from '../src/consentimento/termo-consentimento';
import {
  gerarToken,
  hashToken,
} from '../src/convite-consentimento/convite.token';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { comoOwner } from './acesso-owner';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// Item 22 ponta a ponta: convite por link (psicologo) e aceite/recusa publicos (paciente, sem
// login). Postgres real, RLS real, sem mocks de banco.
const sufixo = randomUUID().slice(0, 8);
const SENHA = 'senha-forte-123';
const APP_URL = 'https://app.teste.local';
const NOME_PACIENTE = `Paciente Secreto ${sufixo}`;
type Usuario = { clinicaId: string; psicologoId: string; token: string };
type Resumo = {
  estado: string;
  historico: {
    seq: number;
    evento: string;
    termoVersao: string;
    origem: string;
  }[];
};

let app: NestExpressApplication;
const criadas: string[] = [];
let n = 0;

const http = () => request(app.getHttpServer());
const com = (u: { token: string } | undefined, r: request.Test) =>
  u ? r.set('Authorization', `Bearer ${u.token}`) : r;

async function login(email: string) {
  const res = await http()
    .post('/auth/login')
    .send({ email, senha: SENHA })
    .expect(200);
  return (res.body as { token: string }).token;
}

// Clinica nova por teste: trilha e linhas comecam vazias e os testes nao se misturam.
async function novoUsuario(): Promise<Usuario> {
  const email = `conv-${++n}-${sufixo}@teste.local`;
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

async function novoPaciente(u: Usuario, nome = NOME_PACIENTE) {
  const res = await com(u, http().post('/pacientes'))
    .send({ nome })
    .expect(201);
  return (res.body as { id: string }).id;
}

const criarConvite = (u: Usuario | undefined, pacienteId: string) =>
  com(u, http().post(`/pacientes/${pacienteId}/convites-consentimento`));
const listar = (u: Usuario | undefined, pacienteId: string) =>
  com(u, http().get(`/pacientes/${pacienteId}/convites-consentimento`));
const cancelar = (u: Usuario | undefined, pacienteId: string, id: string) =>
  com(
    u,
    http().post(
      `/pacientes/${pacienteId}/convites-consentimento/${id}/cancelar`,
    ),
  );
const consentimento = (u: Usuario, pacienteId: string) =>
  com(u, http().get(`/pacientes/${pacienteId}/consentimento`));
const registrarManual = (u: Usuario, pacienteId: string, evento: string) =>
  com(u, http().post(`/pacientes/${pacienteId}/consentimento`)).send({
    evento,
  });

const abrir = (token: string) => http().get(`/publico/consentimento/${token}`);
const aceitar = (token: string, corpo: object = { aceito: true }) =>
  http().post(`/publico/consentimento/${token}/aceitar`).send(corpo);
const recusar = (token: string) =>
  http().post(`/publico/consentimento/${token}/recusar`);

type Criado = { id: string; link: string; expiraEm: string };
const tokenDe = (link: string) => link.slice(`${APP_URL}/termo/`.length);

// Convite novo pela API; devolve id e token (o link so existe nesta resposta).
async function novoConvite(u: Usuario, pacienteId: string) {
  const res = await criarConvite(u, pacienteId).expect(201);
  const c = res.body as Criado;
  return {
    id: c.id,
    token: tokenDe(c.link),
    link: c.link,
    expiraEm: c.expiraEm,
  };
}

const linhasConsentimento = (u: Usuario) =>
  app.get(TenantPrismaService).runComoUsuario(u, (tx) =>
    tx.consentimento.findMany({
      orderBy: [{ pacienteId: 'asc' }, { seq: 'asc' }],
    }),
  );
const convitesNoBanco = (u: Usuario) =>
  app
    .get(TenantPrismaService)
    .runComoUsuario(u, (tx) => tx.conviteConsentimento.findMany());
const trilha = (u: Usuario) =>
  app.get(TenantPrismaService).runComoUsuario(u, (tx) =>
    tx.auditoria.findMany({
      select: { psicologoId: true, acao: true, recurso: true, recursoId: true },
      orderBy: { criadoEm: 'asc' },
    }),
  );

beforeAll(async () => {
  process.env.NOTTA_APP_URL = APP_URL;
  app = await criarAppSemLimite();
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /pacientes/:id/convites-consentimento', () => {
  it('201 {id, link, expiraEm}: link com token de 43 caracteres, validade de 7 dias; no banco so o hash', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const antes = Date.now();
    const res = await criarConvite(u, p).expect(201);
    const c = res.body as Criado;
    expect(Object.keys(c).sort()).toEqual(['expiraEm', 'id', 'link']);
    expect(c.link).toMatch(
      new RegExp(`^${APP_URL.replace(/\./g, '\\.')}/termo/[A-Za-z0-9_-]{43}$`),
    );
    const sete = 7 * 24 * 3600 * 1000;
    const exp = Date.parse(c.expiraEm);
    expect(exp).toBeGreaterThanOrEqual(antes + sete - 1000);
    expect(exp).toBeLessThanOrEqual(Date.now() + sete + 1000);

    const token = tokenDe(c.link);
    const [linha] = await convitesNoBanco(u);
    expect(linha).toMatchObject({
      id: c.id,
      pacienteId: p,
      clinicaId: u.clinicaId,
      psicologoId: u.psicologoId,
      estado: 'PENDENTE',
      usadoEm: null,
      termoVersao: TERMO_VIGENTE.versao,
      tokenHash: hashToken(token),
    });
    // o token cru nao aparece em NENHUMA coluna do convite nem da trilha
    expect(JSON.stringify(linha)).not.toContain(token);
    expect(JSON.stringify(await trilha(u))).not.toContain(token);
  });

  it('cada convite tem um token diferente', async () => {
    const u = await novoUsuario();
    const a = await novoConvite(u, await novoPaciente(u));
    const b = await novoConvite(u, await novoPaciente(u));
    expect(a.token).not.toBe(b.token);
  });

  it('convite novo substitui o PENDENTE: o antigo vira CANCELADO e o link antigo morre (404)', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const velho = await novoConvite(u, p);
    await abrir(velho.token).expect(200);
    const novo = await novoConvite(u, p);
    const estados = Object.fromEntries(
      (await convitesNoBanco(u)).map((c) => [c.id, c.estado]),
    );
    expect(estados).toEqual({ [velho.id]: 'CANCELADO', [novo.id]: 'PENDENTE' });
    await abrir(velho.token).expect(404);
    await abrir(novo.token).expect(200);
  });

  it('PENDENTE vencido tambem e substituido (o indice unico conta todo PENDENTE)', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const velho = await novoConvite(u, p);
    jest
      .spyOn(relogio, 'agora')
      .mockReturnValue(new Date(Date.now() + 8 * 24 * 3600 * 1000));
    const novo = await novoConvite(u, p);
    jest.restoreAllMocks();
    expect(velho.id).not.toBe(novo.id);
    await abrir(novo.token).expect(200);
  });

  it('consentimento ja CONCEDIDO = 409 "Consentimento ja concedido" e nenhum convite criado', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    await registrarManual(u, p, 'CONCEDIDO').expect(201);
    const res = await criarConvite(u, p).expect(409);
    expect(res.body).toMatchObject({ message: 'Consentimento ja concedido' });
    expect(await convitesNoBanco(u)).toEqual([]);
  });

  it('REVOGADO permite um convite novo', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    await registrarManual(u, p, 'CONCEDIDO').expect(201);
    await registrarManual(u, p, 'REVOGADO').expect(201);
    await criarConvite(u, p).expect(201);
  });

  it('paciente de outra clinica e inexistente: 404 IDENTICO; nada criado nem auditado; 400 e 401', async () => {
    const dono = await novoUsuario();
    const intruso = await novoUsuario();
    const p = await novoPaciente(dono);
    const a = await criarConvite(intruso, p).expect(404);
    const b = await criarConvite(intruso, randomUUID()).expect(404);
    expect(a.body).toEqual(b.body);
    expect(await convitesNoBanco(dono)).toEqual([]);
    expect(await trilha(intruso)).toEqual([]);
    await criarConvite(dono, 'nao-e-uuid').expect(400);
    await criarConvite(undefined, p).expect(401);
  });

  it('colega da MESMA clinica: 403 com senha provisoria; depois de trocar a senha, 404 (nao ve paciente do ADMIN)', async () => {
    const admin = await novoUsuario();
    const p = await novoPaciente(admin);
    const email = `colega-conv-${sufixo}-${++n}@teste.local`;
    await com(admin, http().post('/psicologos'))
      .send({ nome: 'Colega', email, senha: SENHA, abordagemPadrao: 'TCC' })
      .expect(201);
    const colega = { token: await login(email) } as Usuario;
    await criarConvite(colega, p).expect(403);
    await listar(colega, p).expect(403);
    const nova = await com(colega, http().post('/auth/trocar-senha'))
      .send({ senhaAtual: SENHA, novaSenha: 'outra-senha-456' })
      .expect(200);
    const livre = { token: (nova.body as { token: string }).token } as Usuario;
    await criarConvite(livre, p).expect(404);
    await listar(livre, p).expect(404);
    expect(await convitesNoBanco(admin)).toEqual([]);
  });
});

describe('GET e cancelar', () => {
  it('lista SEM token nem link, mais novo primeiro; "expirado" derivado do prazo', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const primeiro = await novoConvite(u, p);
    const segundo = await novoConvite(u, p);
    const lista = (await listar(u, p).expect(200)).body as Record<
      string,
      unknown
    >[];
    expect(lista.map((c) => [c.id, c.estado, c.expirado])).toEqual([
      [segundo.id, 'PENDENTE', false],
      [primeiro.id, 'CANCELADO', false],
    ]);
    for (const c of lista) {
      expect(Object.keys(c).sort()).toEqual(
        [
          'criadoEm',
          'estado',
          'expirado',
          'expiraEm',
          'id',
          'termoVersao',
          'usadoEm',
        ].sort(),
      );
    }
    expect(lista[0].usadoEm).toBeNull();
    expect(lista[1].usadoEm).not.toBeNull();
    const texto = JSON.stringify(lista);
    expect(texto).not.toContain(primeiro.token);
    expect(texto).not.toContain(segundo.token);
    expect(texto).not.toMatch(/tokenHash|link/);

    jest
      .spyOn(relogio, 'agora')
      .mockReturnValue(new Date(Date.now() + 8 * 24 * 3600 * 1000));
    const depois = (await listar(u, p).expect(200)).body as {
      id: string;
      estado: string;
      expirado: boolean;
    }[];
    expect(depois.find((c) => c.id === segundo.id)).toMatchObject({
      estado: 'PENDENTE',
      expirado: true,
    });
  });

  it('lista traz no maximo 20', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    for (let i = 0; i < 22; i++) await criarConvite(u, p).expect(201);
    expect(((await listar(u, p).expect(200)).body as unknown[]).length).toBe(
      20,
    );
  });

  it('cancelar: 200, convite CANCELADO, link morre (404); cancelar de novo = 409; id inexistente = 404', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const c = await novoConvite(u, p);
    const r = await cancelar(u, p, c.id).expect(200);
    expect(r.body).toEqual({ id: c.id, estado: 'CANCELADO' });
    await abrir(c.token).expect(404);
    await aceitar(c.token).expect(404);
    expect((await cancelar(u, p, c.id).expect(409)).body).toMatchObject({
      message: 'Convite nao esta pendente',
    });
    await cancelar(u, p, randomUUID()).expect(404);
    await cancelar(u, p, 'nao-e-uuid').expect(400);
  });

  it('cancelar convite de outro psicologo (paciente certo ou errado na URL) = 404 e o convite segue PENDENTE', async () => {
    const dono = await novoUsuario();
    const intruso = await novoUsuario();
    const p = await novoPaciente(dono);
    const outroPaciente = await novoPaciente(dono);
    const c = await novoConvite(dono, p);
    await cancelar(intruso, p, c.id).expect(404);
    await cancelar(dono, outroPaciente, c.id).expect(404);
    expect((await convitesNoBanco(dono))[0].estado).toBe('PENDENTE');
    await listar(intruso, p).expect(404);
  });

  it('cancelar convite ja aceito = 409', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const c = await novoConvite(u, p);
    await aceitar(c.token).expect(200);
    await cancelar(u, p, c.id).expect(409);
  });
});

describe('rotas publicas: GET /publico/consentimento/:token', () => {
  it('200 com clinica, psicologo, termo vigente e prazo; NUNCA dado do paciente; sem login; nao consome o link', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const c = await novoConvite(u, p);
    const res = await abrir(c.token).expect(200);
    expect(res.body).toEqual({
      clinica: 'Clinica Teste',
      psicologo: 'Ana Teste',
      termo: { versao: TERMO_VIGENTE.versao, texto: TERMO_VIGENTE.texto },
      expiraEm: c.expiraEm,
    });
    const texto = JSON.stringify(res.body);
    expect(texto).not.toContain(NOME_PACIENTE);
    expect(texto).not.toContain(p);
    expect(texto).not.toContain(u.psicologoId);
    expect(texto).not.toContain(u.clinicaId);
    await abrir(c.token).expect(200);
    expect((await convitesNoBanco(u))[0].estado).toBe('PENDENTE');
  });

  it('cabecalhos: Cache-Control no-store e Referrer-Policy no-referrer em 200, 404 e 400', async () => {
    const u = await novoUsuario();
    const c = await novoConvite(u, await novoPaciente(u));
    const respostas = [
      await abrir(c.token).expect(200),
      await abrir(gerarToken()).expect(404),
      await abrir('curto').expect(404),
      await aceitar(c.token, {}).expect(400),
      await aceitar(gerarToken()).expect(404),
      await recusar(gerarToken()).expect(404),
    ];
    for (const r of respostas) {
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('token desconhecido, de formato errado, expirado, cancelado, usado, recusado e de outra versao do termo = MESMO 404', async () => {
    const u = await novoUsuario();
    const corpos: { status: number; body: unknown }[] = [];
    const guardar = (r: request.Response) =>
      corpos.push({ status: r.status, body: r.body });

    guardar(await abrir(gerarToken()));
    guardar(await abrir('x'));
    guardar(await abrir('a'.repeat(43) + '='));

    // expirado (relogio injetado)
    const expirado = await novoConvite(u, await novoPaciente(u));
    const spy = jest
      .spyOn(relogio, 'agora')
      .mockReturnValue(new Date(Date.now() + 8 * 24 * 3600 * 1000));
    guardar(await abrir(expirado.token));
    guardar(await aceitar(expirado.token));
    guardar(await recusar(expirado.token));
    spy.mockRestore();

    // cancelado
    const p2 = await novoPaciente(u);
    const cancelado = await novoConvite(u, p2);
    await cancelar(u, p2, cancelado.id).expect(200);
    guardar(await abrir(cancelado.token));
    guardar(await aceitar(cancelado.token));

    // usado (aceito) e recusado
    const aceito = await novoConvite(u, await novoPaciente(u));
    await aceitar(aceito.token).expect(200);
    guardar(await abrir(aceito.token));
    guardar(await aceitar(aceito.token));
    guardar(await recusar(aceito.token));
    const recusado = await novoConvite(u, await novoPaciente(u));
    await recusar(recusado.token).expect(200);
    guardar(await abrir(recusado.token));
    guardar(await aceitar(recusado.token));

    // feito com outra versao do termo (o paciente nunca aceita um texto que nao viu)
    const p3 = await novoPaciente(u);
    const tokenAntigo = gerarToken();
    await comoOwner(
      u.clinicaId,
      (tx) =>
        tx.conviteConsentimento.create({
          data: {
            clinicaId: u.clinicaId,
            psicologoId: u.psicologoId,
            pacienteId: p3,
            tokenHash: hashToken(tokenAntigo),
            termoVersao: 'v0-outra-versao',
            expiraEm: new Date(Date.now() + 3600 * 1000),
          },
        }),
      { psicologoId: u.psicologoId },
    );
    guardar(await abrir(tokenAntigo));
    guardar(await aceitar(tokenAntigo));

    expect(corpos.length).toBeGreaterThan(14);
    expect(new Set(corpos.map((c) => c.status))).toEqual(new Set([404]));
    expect(new Set(corpos.map((c) => JSON.stringify(c.body))).size).toBe(1);
  });

  it('psicologo desativado: o link vira o MESMO 404', async () => {
    const admin = await novoUsuario();
    const email = `colega-desat-${sufixo}-${++n}@teste.local`;
    const criado = await com(admin, http().post('/psicologos'))
      .send({ nome: 'Colega', email, senha: SENHA, abordagemPadrao: 'TCC' })
      .expect(201);
    const colegaId = (criado.body as { psicologoId: string }).psicologoId;
    const t1 = await login(email);
    const nova = await com({ token: t1 }, http().post('/auth/trocar-senha'))
      .send({ senhaAtual: SENHA, novaSenha: 'outra-senha-456' })
      .expect(200);
    const colega = {
      clinicaId: admin.clinicaId,
      psicologoId: colegaId,
      token: (nova.body as { token: string }).token,
    };
    const p = await novoPaciente(colega);
    const c = await novoConvite(colega, p);
    await abrir(c.token).expect(200);
    await com(admin, http().post(`/psicologos/${colegaId}/desativar`)).expect(
      200,
    );
    const a = await abrir(c.token).expect(404);
    const b = await abrir(gerarToken()).expect(404);
    expect(a.body).toEqual(b.body);
    await aceitar(c.token).expect(404);
  });
});

describe('rotas publicas: aceitar', () => {
  it('200 {ok:true}: convite ACEITO, 1 evento CONCEDIDO (origem PACIENTE, conviteId, termo vigente) e o GET autenticado reflete', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const c = await novoConvite(u, p);
    const res = await aceitar(c.token).expect(200);
    expect(res.body).toEqual({ ok: true });

    const linhas = await linhasConsentimento(u);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      pacienteId: p,
      psicologoId: u.psicologoId,
      clinicaId: u.clinicaId,
      seq: 1,
      evento: 'CONCEDIDO',
      origem: 'PACIENTE',
      conviteId: c.id,
      termoVersao: TERMO_VIGENTE.versao,
      termoTexto: TERMO_VIGENTE.texto,
    });
    const [convite] = await convitesNoBanco(u);
    expect(convite.estado).toBe('ACEITO');
    expect(convite.usadoEm).not.toBeNull();

    const r = (await consentimento(u, p).expect(200)).body as Resumo;
    expect(r.estado).toBe('CONCEDIDO');
    expect(r.historico).toEqual([
      expect.objectContaining({
        seq: 1,
        evento: 'CONCEDIDO',
        origem: 'PACIENTE',
        termoVersao: TERMO_VIGENTE.versao,
      }),
    ]);
    const lista = (await listar(u, p).expect(200)).body as { estado: string }[];
    expect(lista[0].estado).toBe('ACEITO');
    // o paciente agora aparece como CONCEDIDO na lista
    const pacientes = (await com(u, http().get('/pacientes')).expect(200))
      .body as { consentimento: string }[];
    expect(pacientes[0].consentimento).toBe('CONCEDIDO');
  });

  it('aceitar 2x seguidas: a 2a e 404 e continua 1 evento', async () => {
    const u = await novoUsuario();
    const c = await novoConvite(u, await novoPaciente(u));
    await aceitar(c.token).expect(200);
    await aceitar(c.token).expect(404);
    expect(await linhasConsentimento(u)).toHaveLength(1);
  });

  it('5 aceites SIMULTANEOS (clique duplo, abas): exatamente 1 x 200, o resto 404, 1 evento so', async () => {
    const u = await novoUsuario();
    const c = await novoConvite(u, await novoPaciente(u));
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => aceitar(c.token)),
    );
    expect(rs.map((r) => r.status).sort()).toEqual([200, 404, 404, 404, 404]);
    expect(await linhasConsentimento(u)).toHaveLength(1);
    const acoes = (await trilha(u)).filter(
      (t) => t.acao === 'PACIENTE_ACEITOU_TERMO',
    );
    expect(acoes).toHaveLength(1);
  });

  it('aceitar e recusar ao mesmo tempo: so um vence', async () => {
    const u = await novoUsuario();
    const c = await novoConvite(u, await novoPaciente(u));
    const [a, r] = await Promise.all([aceitar(c.token), recusar(c.token)]);
    expect([a.status, r.status].sort()).toEqual([200, 404]);
    const [convite] = await convitesNoBanco(u);
    const eventos = await linhasConsentimento(u);
    if (a.status === 200) {
      expect(convite.estado).toBe('ACEITO');
      expect(eventos).toHaveLength(1);
    } else {
      expect(convite.estado).toBe('RECUSADO');
      expect(eventos).toHaveLength(0);
    }
  });

  it('corpo invalido (vazio, aceito:false, campo extra, tipo errado) = 400 e o convite segue valido', async () => {
    const u = await novoUsuario();
    const c = await novoConvite(u, await novoPaciente(u));
    await aceitar(c.token, {}).expect(400);
    await aceitar(c.token, { aceito: false }).expect(400);
    await aceitar(c.token, { aceito: 'true' }).expect(400);
    await aceitar(c.token, { aceito: true, nome: 'Maria' }).expect(400);
    await http().post(`/publico/consentimento/${c.token}/aceitar`).expect(400);
    await abrir(c.token).expect(200);
    expect(await linhasConsentimento(u)).toEqual([]);
  });

  it('nao grava IP, user-agent nem nome digitado: nenhuma coluna do convite, do consentimento ou da trilha os traz', async () => {
    const u = await novoUsuario();
    const c = await novoConvite(u, await novoPaciente(u));
    await aceitar(c.token, { aceito: true })
      .set('User-Agent', `Agente-Unico-${sufixo}`)
      .set('X-Forwarded-For', '203.0.113.77')
      .expect(200);
    const tudo = JSON.stringify([
      await convitesNoBanco(u),
      await linhasConsentimento(u),
      await trilha(u),
    ]);
    expect(tudo).not.toContain(`Agente-Unico-${sufixo}`);
    expect(tudo).not.toContain('203.0.113.77');
    expect(tudo).not.toContain('::ffff:');
    expect(tudo).not.toContain('127.0.0.1');
  });

  it('consentimento ja CONCEDIDO a mao no meio do caminho: convite vira ACEITO sem evento novo', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const c = await novoConvite(u, p);
    await registrarManual(u, p, 'CONCEDIDO').expect(201);
    await aceitar(c.token).expect(200);
    const linhas = await linhasConsentimento(u);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].origem).toBe('PSICOLOGO');
    expect((await convitesNoBanco(u))[0].estado).toBe('ACEITO');
  });

  it('REVOGADO e novo convite aceito: historico 1 PACIENTE, 2 PSICOLOGO (revogou), 3 PACIENTE', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    await aceitar((await novoConvite(u, p)).token).expect(200);
    await registrarManual(u, p, 'REVOGADO').expect(201);
    await aceitar((await novoConvite(u, p)).token).expect(200);
    const r = (await consentimento(u, p).expect(200)).body as Resumo;
    expect(r.estado).toBe('CONCEDIDO');
    expect(r.historico.map((h) => [h.seq, h.evento, h.origem])).toEqual([
      [1, 'CONCEDIDO', 'PACIENTE'],
      [2, 'REVOGADO', 'PSICOLOGO'],
      [3, 'CONCEDIDO', 'PACIENTE'],
    ]);
  });
});

describe('rotas publicas: recusar', () => {
  it('200 {ok:true}: convite RECUSADO, NENHUM Consentimento, link morre; consentimento do paciente segue NENHUM', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const c = await novoConvite(u, p);
    expect((await recusar(c.token).expect(200)).body).toEqual({ ok: true });
    expect(await linhasConsentimento(u)).toEqual([]);
    const [convite] = await convitesNoBanco(u);
    expect(convite.estado).toBe('RECUSADO');
    expect(convite.usadoEm).not.toBeNull();
    await abrir(c.token).expect(404);
    await aceitar(c.token).expect(404);
    expect(
      ((await consentimento(u, p).expect(200)).body as Resumo).estado,
    ).toBe('NENHUM');
    // e o psicologo pode mandar outro
    await criarConvite(u, p).expect(201);
  });
});

describe('auditoria', () => {
  it('cada rota grava a sua acao com recurso e recursoId certos; o paciente aceita em nome do DONO', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const c1 = await novoConvite(u, p);
    await listar(u, p).expect(200);
    await cancelar(u, p, c1.id).expect(200);
    const c2 = await novoConvite(u, p);
    await aceitar(c2.token).expect(200);
    const p2 = await novoPaciente(u);
    const c3 = await novoConvite(u, p2);
    await recusar(c3.token).expect(200);
    const t = (await trilha(u)).filter((x) => x.recurso !== 'Paciente');
    expect(t).toEqual([
      {
        psicologoId: u.psicologoId,
        acao: 'CRIOU_CONVITE',
        recurso: 'ConviteConsentimento',
        recursoId: c1.id,
      },
      {
        psicologoId: u.psicologoId,
        acao: 'LISTOU',
        recurso: 'ConviteConsentimento',
        recursoId: p,
      },
      {
        psicologoId: u.psicologoId,
        acao: 'CANCELOU_CONVITE',
        recurso: 'ConviteConsentimento',
        recursoId: c1.id,
      },
      {
        psicologoId: u.psicologoId,
        acao: 'CRIOU_CONVITE',
        recurso: 'ConviteConsentimento',
        recursoId: c2.id,
      },
      {
        psicologoId: u.psicologoId,
        acao: 'PACIENTE_ACEITOU_TERMO',
        recurso: 'Consentimento',
        recursoId: p,
      },
      {
        psicologoId: u.psicologoId,
        acao: 'CRIOU_CONVITE',
        recurso: 'ConviteConsentimento',
        recursoId: c3.id,
      },
      {
        psicologoId: u.psicologoId,
        acao: 'PACIENTE_RECUSOU_TERMO',
        recurso: 'Consentimento',
        recursoId: p2,
      },
    ]);
  });

  it('substituir o PENDENTE grava CANCELOU_CONVITE do antigo e CRIOU_CONVITE do novo', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const velho = await novoConvite(u, p);
    const novo = await novoConvite(u, p);
    const t = (await trilha(u)).filter(
      (x) => x.recurso === 'ConviteConsentimento',
    );
    expect(t.map((x) => [x.acao, x.recursoId])).toEqual([
      ['CRIOU_CONVITE', velho.id],
      ['CANCELOU_CONVITE', velho.id],
      ['CRIOU_CONVITE', novo.id],
    ]);
  });

  it('a trilha nao tem token, hash, texto do termo, nome do paciente, IP nem user-agent; 404 nao audita', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const c = await novoConvite(u, p);
    await abrir(gerarToken()).expect(404);
    await aceitar(gerarToken()).expect(404);
    await aceitar(c.token).set('User-Agent', 'x-ua-teste').expect(200);
    const texto = JSON.stringify(await trilha(u));
    for (const proibido of [
      c.token,
      hashToken(c.token),
      TERMO_VIGENTE.texto.slice(0, 30),
      NOME_PACIENTE,
      'x-ua-teste',
      '127.0.0.1',
    ]) {
      expect(texto).not.toContain(proibido);
    }
    expect(
      (await trilha(u)).filter((x) => x.acao === 'PACIENTE_ACEITOU_TERMO'),
    ).toHaveLength(1);
  });

  it('atomicidade: falha da auditoria desfaz CRIAR (nenhum convite), CANCELAR (segue PENDENTE) e ACEITAR/RECUSAR (convite PENDENTE, sem evento)', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const registrar = jest.spyOn(app.get(AuditoriaService), 'registrar');

    registrar.mockRejectedValueOnce(new Error('trilha caiu'));
    await criarConvite(u, p).expect(500);
    expect(await convitesNoBanco(u)).toEqual([]);

    const c = await novoConvite(u, p);
    registrar.mockRejectedValueOnce(new Error('trilha caiu'));
    await cancelar(u, p, c.id).expect(500);
    expect((await convitesNoBanco(u))[0].estado).toBe('PENDENTE');

    registrar.mockRejectedValueOnce(new Error('trilha caiu'));
    await aceitar(c.token).expect(500);
    expect((await convitesNoBanco(u))[0]).toMatchObject({
      estado: 'PENDENTE',
      usadoEm: null,
    });
    expect(await linhasConsentimento(u)).toEqual([]);

    registrar.mockRejectedValueOnce(new Error('trilha caiu'));
    await recusar(c.token).expect(500);
    expect((await convitesNoBanco(u))[0].estado).toBe('PENDENTE');

    // e o link continua valendo
    await abrir(c.token).expect(200);
    await aceitar(c.token).expect(200);
  });

  it('substituicao atomica: falha ao criar o novo nao deixa o antigo cancelado', async () => {
    const u = await novoUsuario();
    const p = await novoPaciente(u);
    const velho = await novoConvite(u, p);
    const registrar = jest.spyOn(app.get(AuditoriaService), 'registrar');
    registrar
      .mockImplementationOnce(() => Promise.resolve()) // CANCELOU_CONVITE do antigo
      .mockRejectedValueOnce(new Error('trilha caiu')); // CRIOU_CONVITE do novo
    await criarConvite(u, p).expect(500);
    const estados = (await convitesNoBanco(u)).map((c) => [c.id, c.estado]);
    expect(estados).toEqual([[velho.id, 'PENDENTE']]);
    await abrir(velho.token).expect(200);
  });
});

describe('log', () => {
  it('nenhum log nem saida do processo contem token nem hash (fluxo completo e erros 404, 400 e 500)', async () => {
    const linhas: string[] = [];
    const guardar = (...args: unknown[]) => {
      linhas.push(
        args
          .map((x) =>
            x instanceof Error ? `${x.message} ${x.stack}` : JSON.stringify(x),
          )
          .join(' '),
      );
    };
    const logger: LoggerService = {
      log: guardar,
      error: guardar,
      warn: guardar,
      debug: guardar,
      verbose: guardar,
      fatal: guardar,
    };
    const saida = [
      jest.spyOn(process.stdout, 'write'),
      jest.spyOn(process.stderr, 'write'),
    ];
    const appLog = await criarAppSemLimite({ logger });
    const mesmo = app;
    app = appLog; // os helpers usam `app`
    const tokens: string[] = [];
    try {
      const u = await novoUsuario();
      const p = await novoPaciente(u);
      const c = await novoConvite(u, p);
      tokens.push(c.token);
      await abrir(c.token).expect(200);
      await abrir(gerarToken()).expect(404);
      await aceitar(c.token, {}).expect(400);
      jest
        .spyOn(appLog.get(AuditoriaService), 'registrar')
        .mockRejectedValueOnce(new Error('trilha caiu'));
      await aceitar(c.token).expect(500);
      await aceitar(c.token).expect(200);
      const c2 = await novoConvite(u, await novoPaciente(u));
      tokens.push(c2.token);
      await recusar(c2.token).expect(200);
    } finally {
      app = mesmo;
      saida.forEach((s) => s.mockRestore());
      await appLog.close();
    }
    const tudo =
      linhas.join('\n') +
      saida.map((s) => JSON.stringify(s.mock.calls)).join('\n');
    expect(linhas.length).toBeGreaterThan(0);
    for (const t of tokens) {
      expect(tudo).not.toContain(t);
      expect(tudo).not.toContain(hashToken(t));
    }
    expect(tudo).not.toContain(TERMO_VIGENTE.texto.slice(0, 30));
  });
});

describe('throttler publico (app COM limites)', () => {
  it('20 por minuto por IP; o 21o e 429 com Retry-After, corpo generico e os cabecalhos privados', async () => {
    const comLimite = await criarApp();
    try {
      for (let i = 0; i < 20; i++) {
        await request(comLimite.getHttpServer())
          .get(`/publico/consentimento/${gerarToken()}`)
          .expect(404);
      }
      const res = await request(comLimite.getHttpServer())
        .get(`/publico/consentimento/${gerarToken()}`)
        .expect(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).toContain('Muitas tentativas');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      // cada rota tem o proprio contador por IP (chave do throttler = rota + IP): recusar tambem
      for (let i = 0; i < 20; i++) {
        await request(comLimite.getHttpServer())
          .post(`/publico/consentimento/${gerarToken()}/recusar`)
          .expect(404);
      }
      const r2 = await request(comLimite.getHttpServer())
        .post(`/publico/consentimento/${gerarToken()}/recusar`)
        .expect(429);
      expect(r2.headers['cache-control']).toBe('no-store');
      // o resto da API nao e afetado
      await request(comLimite.getHttpServer()).get('/saude').expect(200);
    } finally {
      await comLimite.close();
    }
  });
});

describe('boot', () => {
  const guardar = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, guardar);
  });

  it('NODE_ENV=production sem NOTTA_TERMO_REVISADO=1: o boot FALHA fechado', async () => {
    process.env.NODE_ENV = 'production';
    process.env.NOTTA_TRUST_PROXY = '0';
    delete process.env.NOTTA_TERMO_REVISADO;
    let msg = '';
    try {
      const a = await criarApp();
      await a.close();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/NOTTA_TERMO_REVISADO/);
  });

  it('NODE_ENV=production com NOTTA_TERMO_REVISADO=1 e NOTTA_APP_URL https: sobe', async () => {
    process.env.NODE_ENV = 'production';
    process.env.NOTTA_TRUST_PROXY = '0';
    process.env.NOTTA_TERMO_REVISADO = '1';
    process.env.NOTTA_APP_URL = 'https://app.exemplo.com';
    const a = await criarApp();
    await a.close();
  });

  it('NOTTA_APP_URL invalida derruba o boot sem ecoar o valor', async () => {
    process.env.NOTTA_APP_URL = 'https://joao:segredo-url@app.exemplo.com';
    let msg = '';
    try {
      const a = await criarApp();
      await a.close();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/NOTTA_APP_URL/);
    expect(msg).not.toContain('segredo-url');
  });
});
