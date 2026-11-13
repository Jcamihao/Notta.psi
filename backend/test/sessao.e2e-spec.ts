import { createHash, randomUUID } from 'node:crypto';
import { LoggerService } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuditoriaService } from '../src/auditoria/auditoria.service';
import { relogio } from '../src/comum/relogio';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { comoOwner } from './acesso-owner';
import { CLIENTE_API, ORIGEM_APP } from './cliente-api';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// Sessao segura (itens 46 e 49, back): cookies httpOnly, refresh rotativo, sessao revogavel e CSRF.
// Banco real. O navegador e simulado por um "jar" de cookies manual (so o que o navegador mandaria:
// acesso e CSRF vao para as rotas da API; o refresh so para /auth/*).
const sufixo = randomUUID().slice(0, 8);
const SENHA = 'senha-forte-123';
const MIN = 60_000;
const DIA = 24 * 60 * MIN;

let app: NestExpressApplication;
const criadas: string[] = [];
let n = 0;
const logs: string[] = [];
const logger: LoggerService = {
  log: (m: unknown) => logs.push(String(m)),
  error: (m: unknown, ...r: unknown[]) =>
    logs.push([m, ...r].map(String).join(' ')),
  warn: (m: unknown) => logs.push(String(m)),
};

const http = () => request(app.getHttpServer());
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

type Jar = Record<string, string>;
type Conta = { email: string; clinicaId: string; psicologoId: string };

// Atualiza o jar com os Set-Cookie da resposta (valor vazio ou data no passado = apagou).
function guardar(jar: Jar, res: request.Response) {
  const lista = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  for (const linha of lista) {
    const [par, ...attrs] = linha.split(';').map((p) => p.trim());
    const i = par.indexOf('=');
    const nome = par.slice(0, i);
    const valor = par.slice(i + 1);
    const expirou = attrs.some(
      (a) =>
        /^expires=/i.test(a) && new Date(a.slice(8)).getTime() < Date.now(),
    );
    if (valor === '' || expirou) delete jar[nome];
    else jar[nome] = valor;
  }
}
const cab = (jar: Jar, ...nomes: string[]) =>
  nomes
    .filter((k) => jar[k] !== undefined)
    .map((k) => `${k}=${jar[k]}`)
    .join('; ');
// Cookies que o navegador manda a uma rota comum da API (acesso + CSRF) e a /auth/renovar (refresh + CSRF).
const paraApi = (jar: Jar) => cab(jar, 'praxis_acesso', 'praxis_csrf');
const paraRenovar = (jar: Jar) => cab(jar, 'praxis_refresh', 'praxis_csrf');
const setCookies = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[]) ?? [];
const atributos = (res: request.Response, nome: string) =>
  setCookies(res).find((c) => c.startsWith(`${nome}=`))!;

const origem = { Origin: ORIGEM_APP };

async function novaConta(): Promise<Conta> {
  const email = `sess-${++n}-${sufixo}@teste.local`;
  const res = await http()
    .post('/clinicas')
    .set(CLIENTE_API)
    .send(corpoClinica(email, { senha: SENHA }))
    .expect(201);
  const { clinicaId, psicologoId } = res.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);
  return { email, clinicaId, psicologoId };
}

// Login como o navegador (sem o cabecalho de cliente api).
async function entrar(c: Conta, senha = SENHA) {
  const jar: Jar = {};
  const res = await http()
    .post('/auth/login')
    .set(origem)
    .send({ email: c.email, senha });
  guardar(jar, res);
  return { jar, res };
}

const acesso = (jar: Jar) => http().get('/eu').set('Cookie', paraApi(jar));

// Requisicao nao segura autenticada por cookie, como o front faria (Origin + CSRF).
const postarComoNavegador = (
  jar: Jar,
  url: string,
  corpo: object = {},
  extra: Record<string, string> = {},
) =>
  http()
    .post(url)
    .set({
      Cookie: paraApi(jar),
      ...origem,
      'X-CSRF-Token': jar.praxis_csrf,
      ...extra,
    })
    .send(corpo);

const renovar = async (jar: Jar, extra: Record<string, string> = {}) => {
  const res = await http()
    .post('/auth/renovar')
    .set({ Cookie: paraRenovar(jar), ...origem, ...extra });
  guardar(jar, res);
  return res;
};

const sessoes = (c: Conta) =>
  comoOwner(
    c.clinicaId,
    (tx) =>
      tx.sessao.findMany({
        where: { psicologoId: c.psicologoId },
        orderBy: { criadoEm: 'asc' },
      }),
    { psicologoId: c.psicologoId },
  );
const trilha = (c: Conta) =>
  comoOwner(
    c.clinicaId,
    (tx) =>
      tx.auditoria.findMany({
        where: { psicologoId: c.psicologoId },
        select: { acao: true, recurso: true, recursoId: true },
        orderBy: { criadoEm: 'asc' },
      }),
    { psicologoId: c.psicologoId },
  );

const relogioEm = (ms: number) =>
  jest.spyOn(relogio, 'agora').mockReturnValue(new Date(Date.now() + ms));

beforeAll(async () => {
  app = await criarAppSemLimite({ logger });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await app.close();
  await apagarClinicas(app, criadas);
});

describe('POST /auth/login: cookies e corpo', () => {
  it('define 3 cookies com as flags certas; corpo {usuario} SEM token; no-store', async () => {
    const c = await novaConta();
    const { res } = await entrar(c);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object)).toEqual(['usuario']);
    expect(res.body).toMatchObject({
      usuario: { psicologoId: c.psicologoId, email: c.email, papel: 'ADMIN' },
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(setCookies(res)).toHaveLength(3);

    const ac = atributos(res, 'praxis_acesso');
    expect(ac).toMatch(/; HttpOnly/);
    expect(ac).toMatch(/; SameSite=Lax/);
    expect(ac).toMatch(/; Path=\/api(;|$)/);
    expect(ac).toMatch(/; Max-Age=900(;|$)/);

    const rf = atributos(res, 'praxis_refresh');
    expect(rf).toMatch(/; HttpOnly/);
    expect(rf).toMatch(/; SameSite=Strict/);
    expect(rf).toMatch(/; Path=\/api\/auth(;|$)/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(rf)![1]);
    expect(maxAge).toBeGreaterThan(7 * 86400 - 5);
    expect(maxAge).toBeLessThanOrEqual(7 * 86400);

    const cs = atributos(res, 'praxis_csrf');
    expect(cs).not.toMatch(/HttpOnly/);
    expect(cs).toMatch(/; SameSite=Lax/);
    expect(cs).toMatch(/; Path=\/(;|$)/);

    // sem Domain (cookie preso ao host) e, em http de desenvolvimento, sem Secure
    for (const linha of setCookies(res)) {
      expect(linha).not.toMatch(/Domain=/i);
      expect(linha).not.toMatch(/Secure/i);
    }
    // refresh: 32 bytes base64url
    expect(atributos(res, 'praxis_refresh')).toMatch(
      /^praxis_refresh=[A-Za-z0-9_-]{43};/,
    );
  });

  it('SEM o cabecalho de cliente api nao devolve token; COM ele devolve (so o login)', async () => {
    const c = await novaConta();
    const sem = await http()
      .post('/auth/login')
      .set(origem)
      .send({ email: c.email, senha: SENHA });
    expect((sem.body as { token?: string }).token).toBeUndefined();
    expect(JSON.stringify(sem.body)).not.toMatch(/eyJ/);
    const com = await http()
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: c.email, senha: SENHA });
    expect((com.body as { token: string }).token).toMatch(/^eyJ/);
    // o valor so conta se for exatamente `api`
    const outro = await http()
      .post('/auth/login')
      .set({ ...origem, 'x-praxis-cliente': 'web' })
      .send({ email: c.email, senha: SENHA });
    expect((outro.body as { token?: string }).token).toBeUndefined();
  });

  it('o cookie de acesso autentica (GET /eu); o token do corpo (api) tambem, com o mesmo sid', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const viaCookie = await acesso(jar).expect(200);
    expect(viaCookie.body).toMatchObject({ psicologoId: c.psicologoId });
    const api = await http()
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: c.email, senha: SENHA });
    const token = (api.body as { token: string }).token;
    await http().get('/eu').set('Authorization', `Bearer ${token}`).expect(200);
    const { sid } = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    ) as { sid: string };
    expect((await sessoes(c)).map((s) => s.id)).toContain(sid);
  });

  it('cada login cria uma familia e um CSRF novos', async () => {
    const c = await novaConta();
    const a = await entrar(c);
    const b = await entrar(c);
    expect(a.jar.praxis_csrf).not.toBe(b.jar.praxis_csrf);
    const linhas = await sessoes(c);
    expect(linhas).toHaveLength(2);
    expect(linhas[0].familia).not.toBe(linhas[1].familia);
  });

  it('com proxy https (PRAXIS_TRUST_PROXY=1 + X-Forwarded-Proto) todos os cookies saem Secure', async () => {
    const antes = process.env.PRAXIS_TRUST_PROXY;
    process.env.PRAXIS_TRUST_PROXY = '1';
    const proxied = await criarAppSemLimite();
    try {
      const c = await novaConta();
      const res = await request(proxied.getHttpServer())
        .post('/auth/login')
        .set({ ...origem, 'X-Forwarded-Proto': 'https' })
        .send({ email: c.email, senha: SENHA })
        .expect(200);
      expect(setCookies(res)).toHaveLength(3);
      for (const linha of setCookies(res)) expect(linha).toMatch(/; Secure/);
    } finally {
      await proxied.close();
      if (antes === undefined) delete process.env.PRAXIS_TRUST_PROXY;
      else process.env.PRAXIS_TRUST_PROXY = antes;
    }
  });

  it('o refresh cru nunca vai ao banco (so o SHA-256) nem ao log', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const cru = jar.praxis_refresh;
    await renovar(jar);
    const linhas = await sessoes(c);
    expect(linhas.map((l) => l.refreshHash)).toContain(sha(cru));
    expect(linhas.map((l) => l.refreshHash)).not.toContain(cru);
    expect(linhas.every((l) => /^[0-9a-f]{64}$/.test(l.refreshHash))).toBe(
      true,
    );
    // reuso (gera mais caminhos de log) e depois varredura do log
    await http()
      .post('/auth/renovar')
      .set({ Cookie: `praxis_refresh=${cru}`, ...origem })
      .expect(401);
    expect(logs.join('\n')).not.toContain(cru);
    expect(logs.join('\n')).not.toContain(sha(cru));
    expect(logs.join('\n')).not.toContain(jar.praxis_refresh);
  });
});

describe('POST /auth/renovar: rotacao', () => {
  it('rotaciona: refresh novo, acesso novo, mesma familia; o refresh antigo deixa de valer', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const antigo = jar.praxis_refresh;
    const csrf = jar.praxis_csrf;
    const antes = jar.praxis_acesso;
    const res = await renovar(jar);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(jar.praxis_refresh).not.toBe(antigo);
    expect(jar.praxis_acesso).not.toBe(antes);
    // CSRF acompanha a sessao: nao muda a cada renovacao (abas concorrentes)
    expect(jar.praxis_csrf).toBe(csrf);
    await acesso(jar).expect(200);

    const linhas = await sessoes(c);
    expect(linhas).toHaveLength(2);
    expect(linhas[0].familia).toBe(linhas[1].familia);
    expect(linhas[0].usadoEm).not.toBeNull();
    expect(linhas[1].usadoEm).toBeNull();
    // o limite absoluto vem do LOGIN: a linha nova herda, nao ganha 7 dias novos
    expect(linhas[1].absolutaAte).toEqual(linhas[0].absolutaAte);
    expect(linhas[1].id).not.toBe(linhas[0].id);

    // o novo refresh funciona de novo
    await renovar(jar).then((r) => expect(r.status).toBe(200));
  });

  it('REUSO do refresh antigo: 401, familia inteira revogada, acesso corrente cai NA HORA, auditoria REFRESH_REUSADO', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const antigo = jar.praxis_refresh;
    await renovar(jar).then((r) => expect(r.status).toBe(200));
    await acesso(jar).expect(200); // acesso corrente (JWT valido)

    const ladrao = await http()
      .post('/auth/renovar')
      .set({ Cookie: `praxis_refresh=${antigo}`, ...origem });
    expect(ladrao.status).toBe(401);
    expect(ladrao.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    // o JWT corrente ainda esta dentro dos 15 min e assinado: so o banco o derruba
    await acesso(jar).expect(401);
    // e o refresh corrente tambem morreu
    expect((await renovar(jar)).status).toBe(401);

    const linhas = await sessoes(c);
    expect(linhas.every((l) => l.revogadaEm !== null)).toBe(true);
    expect(new Set(linhas.map((l) => l.motivoRevogacao))).toEqual(
      new Set(['REUSO']),
    );
    const t = await trilha(c);
    expect(t).toContainEqual({
      acao: 'REFRESH_REUSADO',
      recurso: 'Sessao',
      recursoId: linhas[0].id,
    });
  });

  it('reuso nao afeta OUTRA familia do mesmo psicologo (outro aparelho)', async () => {
    const c = await novaConta();
    const a = await entrar(c);
    const b = await entrar(c);
    const antigo = a.jar.praxis_refresh;
    await renovar(a.jar);
    await http()
      .post('/auth/renovar')
      .set({ Cookie: `praxis_refresh=${antigo}`, ...origem })
      .expect(401);
    await acesso(a.jar).expect(401);
    await acesso(b.jar).expect(200);
    await renovar(b.jar).then((r) => expect(r.status).toBe(200));
  });

  it('duas renovacoes SIMULTANEAS com o mesmo refresh: so uma vence; a outra cai no reuso e a familia e revogada', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const pedir = () =>
      http()
        .post('/auth/renovar')
        .set({ Cookie: paraRenovar(jar), ...origem });
    const [x, y] = await Promise.all([pedir(), pedir()]);
    expect([x.status, y.status].sort()).toEqual([200, 401]);
    const linhas = await sessoes(c);
    // o banco decidiu: nenhuma linha ativa sobrou (a familia caiu), so uma foi usada
    expect(linhas.filter((l) => l.usadoEm).length).toBe(1);
    expect(linhas.every((l) => l.revogadaEm !== null)).toBe(true);
  });

  it('toda falha e o MESMO 401 e limpa os cookies (sem cookie, lixo, formato errado, desconhecido)', async () => {
    const corpoRef = { statusCode: 401, message: 'Unauthorized' };
    const casos: Record<string, string>[] = [
      {},
      { Cookie: 'praxis_refresh=lixo' },
      { Cookie: `praxis_refresh=${'a'.repeat(300)}` },
      { Cookie: `praxis_refresh=${'A'.repeat(43)}` },
      { Cookie: 'praxis_refresh=' },
      { Cookie: 'praxis_acesso=x' },
    ];
    for (const extra of casos) {
      const res = await http()
        .post('/auth/renovar')
        .set({ ...origem, ...extra });
      expect({ extra, status: res.status }).toEqual({ extra, status: 401 });
      expect(res.body).toEqual(corpoRef);
      expect(
        setCookies(res).filter((l) => /Expires=Thu, 01 Jan 1970/.test(l)),
      ).toHaveLength(3);
    }
  });

  it('o acesso (JWT) nao serve como refresh', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const res = await http()
      .post('/auth/renovar')
      .set({ Cookie: `praxis_refresh=${jar.praxis_acesso}`, ...origem });
    expect(res.status).toBe(401);
  });

  it('com o cabecalho de cliente api devolve o token novo no corpo', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const res = await renovar(jar, { 'x-praxis-cliente': 'api' });
    expect((res.body as { token: string }).token).toMatch(/^eyJ/);
  });

  it('psicologo desativado nao renova (e o acesso dele cai)', async () => {
    const admin = await novaConta();
    const { jar: jarAdmin } = await entrar(admin);
    const emailColega = `colega-${++n}-${sufixo}@teste.local`;
    const criado = await postarComoNavegador(jarAdmin, '/psicologos', {
      nome: 'Colega',
      email: emailColega,
      senha: SENHA,
      abordagemPadrao: 'TCC',
    }).expect(201);
    const colegaId = (criado.body as { psicologoId: string }).psicologoId;
    const colega = await entrar({ ...admin, email: emailColega });
    expect(colega.res.status).toBe(200);
    await postarComoNavegador(
      jarAdmin,
      `/psicologos/${colegaId}/desativar`,
    ).expect(200);
    expect((await renovar(colega.jar)).status).toBe(401);
    await acesso(colega.jar).expect(401);
  });
});

describe('ociosidade (30 min) e limite absoluto (7 dias)', () => {
  it('parado ate 30 min renova; parado mais que 30 min = 401 e a familia e revogada (EXPIROU)', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    relogioEm(29 * MIN);
    expect((await renovar(jar)).status).toBe(200);
    // a ociosidade conta desde a ULTIMA atividade (a renovacao), nao desde o login
    relogioEm(29 * MIN + 29 * MIN);
    expect((await renovar(jar)).status).toBe(200);
    relogioEm(58 * MIN + 31 * MIN);
    const parado = await renovar(jar);
    expect(parado.status).toBe(401);
    const linhas = await sessoes(c);
    expect(linhas.every((l) => l.revogadaEm !== null)).toBe(true);
    expect(linhas.at(-1)!.motivoRevogacao).toBe('EXPIROU');
  });

  it('atividade (chamada autenticada) renova o prazo de ociosidade', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    relogioEm(20 * MIN);
    await acesso(jar).expect(200); // grava ultimoUsoEm (+20 min)
    relogioEm(20 * MIN + 25 * MIN);
    // 45 min desde o login, mas so 25 desde a ultima atividade
    expect((await renovar(jar)).status).toBe(200);
  });

  it('acima de 7 dias = 401, mesmo com atividade recente; o acesso tambem cai', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const sete = 7 * DIA;
    // 10 min antes do limite: atividade recente (dono ajusta o ultimoUsoEm) e renovacao ok
    relogioEm(sete - 10 * MIN);
    await comoOwner(
      c.clinicaId,
      (tx) =>
        tx.sessao.updateMany({
          where: { psicologoId: c.psicologoId, usadoEm: null },
          data: { ultimoUsoEm: new Date(Date.now() + sete - 11 * MIN) },
        }),
      { psicologoId: c.psicologoId },
    );
    expect((await renovar(jar)).status).toBe(200);
    await acesso(jar).expect(200);
    // 20 min depois: so 20 min parado, mas passou dos 7 dias do login
    relogioEm(sete + 10 * MIN);
    await acesso(jar).expect(401);
    const res = await renovar(jar);
    expect(res.status).toBe(401);
    const linhas = await sessoes(c);
    expect(linhas.at(-1)!.motivoRevogacao).toBe('EXPIROU');
  });
});

describe('sair, sair de todos e troca de senha', () => {
  it('sair: revoga a familia NA HORA (JWT e refresh), limpa os cookies; Bearer da mesma sessao tambem cai', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const api = await http()
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: c.email, senha: SENHA });
    const bearer = (api.body as { token: string }).token;
    const antigoAcesso = jar.praxis_acesso;
    await renovar(jar);
    const res = await postarComoNavegador(jar, '/auth/sair').expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(
      setCookies(res).filter((l) => /Expires=Thu, 01 Jan 1970/.test(l)),
    ).toHaveLength(3);
    // o JWT que o navegador tinha continua valido por assinatura, mas a sessao caiu
    await http()
      .get('/eu')
      .set('Cookie', `praxis_acesso=${antigoAcesso}`)
      .expect(401);
    await http().get('/eu').set('Cookie', paraApi(jar)).expect(401);
    guardar(jar, res);
    expect((await renovar(jar)).status).toBe(401);
    // a OUTRA sessao (login api) segue
    await http()
      .get('/eu')
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    const familias = (await sessoes(c)).filter((s) => s.revogadaEm);
    expect(familias.length).toBeGreaterThanOrEqual(2);
    expect(new Set(familias.map((f) => f.motivoRevogacao))).toEqual(
      new Set(['SAIU']),
    );
  });

  it('sair com Bearer (sem cookie) tambem revoga', async () => {
    const c = await novaConta();
    const api = await http()
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: c.email, senha: SENHA });
    const t = (api.body as { token: string }).token;
    const h = { Authorization: `Bearer ${t}` };
    await http().post('/auth/sair').set(h).expect(200);
    await http().get('/eu').set(h).expect(401);
  });

  it('sair de todos: derruba TODAS as sessoes do psicologo (a atual inclusive) e audita na mesma transacao', async () => {
    const c = await novaConta();
    const a = await entrar(c);
    const b = await entrar(c);
    const outra = await novaConta();
    const o = await entrar(outra);
    const res = await postarComoNavegador(a.jar, '/auth/sair-de-todos').expect(
      200,
    );
    expect(res.body).toEqual({ ok: true });
    await acesso(a.jar).expect(401);
    await acesso(b.jar).expect(401);
    expect((await renovar(b.jar)).status).toBe(401);
    // outra conta nao e afetada
    await acesso(o.jar).expect(200);
    const linhas = await sessoes(c);
    expect(new Set(linhas.map((l) => l.motivoRevogacao))).toEqual(
      new Set(['SAIU_DE_TODOS']),
    );
    const t = await trilha(c);
    expect(t.filter((x) => x.acao === 'SAIU_DE_TODOS')).toEqual([
      {
        acao: 'SAIU_DE_TODOS',
        recurso: 'Sessao',
        recursoId: (await sessoes(c))[0].id,
      },
    ]);
  });

  it('atomicidade: falha da auditoria em sair-de-todos = 500 e NADA e revogado', async () => {
    const c = await novaConta();
    const a = await entrar(c);
    const b = await entrar(c);
    jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('auditoria fora'));
    await postarComoNavegador(a.jar, '/auth/sair-de-todos').expect(500);
    expect((await sessoes(c)).every((s) => s.revogadaEm === null)).toBe(true);
    await acesso(a.jar).expect(200);
    await acesso(b.jar).expect(200);
  });

  it('atomicidade: falha da auditoria no reuso = 500 e a familia NAO e revogada (mesma transacao)', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const antigo = jar.praxis_refresh;
    await renovar(jar);
    jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('auditoria fora'));
    const r = await http()
      .post('/auth/renovar')
      .set({ Cookie: `praxis_refresh=${antigo}`, ...origem });
    expect(r.status).toBe(500);
    expect((await sessoes(c)).every((s) => s.revogadaEm === null)).toBe(true);
  });

  it('trocar senha: derruba as OUTRAS sessoes (JWT e refresh), mantem a atual com acesso novo', async () => {
    const c = await novaConta();
    const atual = await entrar(c);
    const outra = await entrar(c);
    const antigoAcesso = atual.jar.praxis_acesso;
    const res = await postarComoNavegador(atual.jar, '/auth/trocar-senha', {
      senhaAtual: SENHA,
      novaSenha: 'outra-senha-forte-1',
    }).expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
    // cookie de acesso novo (mesmo sid, tv novo); csrf e refresh intactos
    expect(atributos(res, 'praxis_acesso')).toMatch(/HttpOnly/);
    expect(setCookies(res)).toHaveLength(1);
    guardar(atual.jar, res);
    await acesso(atual.jar).expect(200);
    // o acesso antigo (tv velho) cai
    await http()
      .get('/eu')
      .set('Cookie', `praxis_acesso=${antigoAcesso}`)
      .expect(401);
    // outra sessao: JWT cai e refresh nao renova
    await acesso(outra.jar).expect(401);
    expect((await renovar(outra.jar)).status).toBe(401);
    // a atual ainda renova
    expect((await renovar(atual.jar)).status).toBe(200);
    const linhas = await sessoes(c);
    expect(
      linhas.filter((l) => l.motivoRevogacao === 'SENHA_TROCADA'),
    ).toHaveLength(1);
  });

  it('sessao REVOGADA = 401 imediato mesmo com JWT valido (revogada pelo dono do banco)', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    await acesso(jar).expect(200);
    await comoOwner(
      c.clinicaId,
      (tx) =>
        tx.sessao.updateMany({
          where: { psicologoId: c.psicologoId },
          data: { revogadaEm: new Date(), motivoRevogacao: 'SAIU' },
        }),
      { psicologoId: c.psicologoId },
    );
    await acesso(jar).expect(401);
  });
});

describe('CSRF e checagem de Origin', () => {
  const corpoPaciente = { nome: 'Paciente Csrf' };
  const postar = (jar: Jar, extra: Record<string, string>) =>
    http()
      .post('/pacientes')
      .set({ Cookie: paraApi(jar), ...extra })
      .send(corpoPaciente);

  it('POST por cookie: sem header = 403; header errado = 403; Origin errada = 403; sem Origin = 403', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const csrf = jar.praxis_csrf;
    const corpoFixo = {
      statusCode: 403,
      message: 'Requisicao recusada',
      error: 'Forbidden',
    };
    const respostas = [
      await postar(jar, origem),
      await postar(jar, { ...origem, 'X-CSRF-Token': 'x'.repeat(43) }),
      await postar(jar, { ...origem, 'X-CSRF-Token': 'curto' }),
      await postar(jar, { 'X-CSRF-Token': csrf }),
      await postar(jar, {
        'X-CSRF-Token': csrf,
        Origin: 'https://atacante.exemplo.com',
      }),
      await postar(jar, { 'X-CSRF-Token': csrf, Origin: 'null' }),
      await postar(jar, {
        'X-CSRF-Token': csrf,
        Origin: `${ORIGEM_APP}.atacante.com`,
      }),
    ];
    for (const r of respostas) {
      expect(r.status).toBe(403);
      expect(r.body).toEqual(corpoFixo);
    }
    // nada foi criado
    const lista = await http().get('/pacientes').set('Cookie', paraApi(jar));
    expect(lista.body).toEqual([]);
  });

  it('Origin certa + header certo = ok; Referer da origem certa vale no lugar do Origin', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    await postar(jar, { ...origem, 'X-CSRF-Token': jar.praxis_csrf }).expect(
      201,
    );
    await postar(jar, {
      Referer: `${ORIGEM_APP}/pacientes/novo`,
      'X-CSRF-Token': jar.praxis_csrf,
    }).expect(201);
    await postar(jar, {
      Referer: 'https://atacante.exemplo.com/x',
      'X-CSRF-Token': jar.praxis_csrf,
    }).expect(403);
  });

  it('PATCH tambem exige (metodo nao seguro); header de OUTRA sessao nao vale', async () => {
    const c = await novaConta();
    const a = await entrar(c);
    const b = await entrar(c);
    const criado = await postar(a.jar, {
      ...origem,
      'X-CSRF-Token': a.jar.praxis_csrf,
    }).expect(201);
    const id = (criado.body as { id: string }).id;
    const patch = (jar: Jar, extra: Record<string, string>) =>
      http()
        .patch(`/pacientes/${id}`)
        .set({ Cookie: paraApi(jar), ...extra })
        .send({ nome: 'Novo Nome' });
    await patch(a.jar, origem).expect(403);
    await patch(a.jar, {
      ...origem,
      'X-CSRF-Token': b.jar.praxis_csrf,
    }).expect(403);
    await patch(a.jar, {
      ...origem,
      'X-CSRF-Token': a.jar.praxis_csrf,
    }).expect(200);
  });

  it('GET por cookie sem header nem Origin = ok (metodo seguro)', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    await http().get('/pacientes').set('Cookie', paraApi(jar)).expect(200);
  });

  it('Bearer fica fora do CSRF (sem header, sem Origin) e tambem com cookie junto', async () => {
    const c = await novaConta();
    const api = await http()
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: c.email, senha: SENHA });
    const h = {
      Authorization: `Bearer ${(api.body as { token: string }).token}`,
    };
    await http().post('/pacientes').set(h).send(corpoPaciente).expect(201);
  });

  it('sem nenhuma credencial: 401 (nao 403)', async () => {
    await http().post('/pacientes').send(corpoPaciente).expect(401);
  });

  it('login, cadastro de clinica e renovar: so Origin (sem CSRF); Origin errada ou ausente = 403', async () => {
    const c = await novaConta();
    const body = { email: c.email, senha: SENHA };
    const errada = { Origin: 'https://atacante.exemplo.com' };
    await http().post('/auth/login').set(errada).send(body).expect(403);
    await http().post('/auth/login').send(body).expect(403);
    await http().post('/auth/login').set(origem).send(body).expect(200);
    await http()
      .post('/auth/login')
      .set({ Referer: `${ORIGEM_APP}/login` })
      .send(body)
      .expect(200);

    const email = `csrf-${++n}-${sufixo}@teste.local`;
    await http()
      .post('/clinicas')
      .set(errada)
      .send(corpoClinica(email, { senha: SENHA }))
      .expect(403);
    await http()
      .post('/clinicas')
      .send(corpoClinica(email, { senha: SENHA }))
      .expect(403);
    const ok = await http()
      .post('/clinicas')
      .set(origem)
      .send(corpoClinica(email, { senha: SENHA }))
      .expect(201);
    criadas.push((ok.body as { clinicaId: string }).clinicaId);

    const { jar } = await entrar(c);
    await http()
      .post('/auth/renovar')
      .set({ Cookie: paraRenovar(jar), ...errada })
      .expect(403);
    await http()
      .post('/auth/renovar')
      .set({ Cookie: paraRenovar(jar) })
      .expect(403);
    // 403 nao queimou o refresh: a renovacao certa ainda funciona
    expect((await renovar(jar)).status).toBe(200);
  });

  it('rotas publicas do termo ficam fora do CSRF (POST com cookie, sem header, sem Origin: nao e 403)', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    const r = await http()
      .post(`/publico/consentimento/${'a'.repeat(43)}/aceitar`)
      .set('Cookie', paraApi(jar))
      .send({ aceito: true });
    expect(r.status).toBe(404);
  });
});

describe('throttler de renovar (30/min por IP)', () => {
  it('o 31o pedido no minuto = 429 com Retry-After, corpo generico', async () => {
    const comLimite = await criarApp();
    try {
      const pedir = () =>
        request(comLimite.getHttpServer()).post('/auth/renovar').set(origem);
      for (let i = 0; i < 30; i++) await pedir().expect(401);
      const r = await pedir();
      expect(r.status).toBe(429);
      expect(r.headers['retry-after']).toBeDefined();
      expect(JSON.stringify(r.body)).not.toMatch(/praxis_|refresh/i);
    } finally {
      await comLimite.close();
    }
  });
});

describe('tenant: o contexto do refresh nao vaza', () => {
  it('depois de uma renovacao, a mesma conexao nao enxerga sessoes sem contexto', async () => {
    const c = await novaConta();
    const { jar } = await entrar(c);
    await renovar(jar);
    const semContexto = await app
      .get(TenantPrismaService)
      .run(c.clinicaId, (tx) => tx.sessao.findMany());
    expect(semContexto).toEqual([]);
  });
});
