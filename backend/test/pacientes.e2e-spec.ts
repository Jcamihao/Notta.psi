import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';

const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `pac-${n}-${sufixo}@teste.local`;
const SENHA = 'senha-forte-123';
const ERRO_500 = { statusCode: 500, message: 'Internal Server Error' };

type Paciente = {
  id: string;
  nome: string;
  nascimento: string | null;
  telefone: string | null;
  email: string | null;
  criadoEm: string;
};
type Usuario = { clinicaId: string; psicologoId: string; token: string };

let app: NestExpressApplication;
const criadas: string[] = [];

const http = () => request(app.getHttpServer());
const com = (token: string | undefined, r: request.Test) =>
  token ? r.set('Authorization', `Bearer ${token}`) : r;
const post = (u: Usuario | undefined, corpo: object) =>
  com(u?.token, http().post('/pacientes').send(corpo));
const get = (u: Usuario | undefined, caminho = '') =>
  com(u?.token, http().get(`/pacientes${caminho}`));
const patch = (u: Usuario | undefined, id: string, corpo: object) =>
  com(u?.token, http().patch(`/pacientes/${id}`).send(corpo));

async function login(e: string, senha = SENHA) {
  const res = await http()
    .post('/auth/login')
    .send({ email: e, senha })
    .expect(200);
  return (res.body as { token: string }).token;
}

async function novaClinica(e: string): Promise<Usuario> {
  const res = await http()
    .post('/clinicas')
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
    .set('Authorization', `Bearer ${provisorio}`)
    .send({ senhaAtual: SENHA, novaSenha: 'senha-definitiva-1' })
    .expect(200);
  return {
    clinicaId: admin.clinicaId,
    psicologoId: (res.body as { psicologoId: string }).psicologoId,
    token: (troca.body as { token: string }).token,
  };
}

const criar = async (u: Usuario, corpo: object) =>
  (await post(u, corpo).expect(201)).body as Paciente;

// Linha crua do banco, como o proprio psicologo (RLS), para provar o que esta gravado.
const linhaCrua = (u: Usuario, id: string) =>
  app
    .get(TenantPrismaService)
    .runComoUsuario(u, (tx) => tx.paciente.findFirstOrThrow({ where: { id } }));

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

describe('POST /pacientes', () => {
  it('201 com os campos decifrados; sem *Cifrado; dono = token', async () => {
    const res = await post(a, {
      nome: '  Maria da Silva ',
      nascimento: '1990-05-17',
      telefone: '+55 (11) 99999-0000',
      email: 'maria@exemplo.com',
    }).expect(201);
    const p = res.body as Paciente;
    expect(Object.keys(p).sort()).toEqual([
      'criadoEm',
      'email',
      'id',
      'nascimento',
      'nome',
      'telefone',
    ]);
    expect(p).toMatchObject({
      nome: 'Maria da Silva',
      nascimento: '1990-05-17',
      telefone: '+55 (11) 99999-0000',
      email: 'maria@exemplo.com',
    });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    const crua = await linhaCrua(a, p.id);
    expect(crua).toMatchObject({
      clinicaId: a.clinicaId,
      psicologoId: a.psicologoId,
    });
  });

  it('so o nome: opcionais voltam null', async () => {
    const p = await criar(a, { nome: 'So Nome' });
    expect(p).toMatchObject({
      nome: 'So Nome',
      nascimento: null,
      telefone: null,
      email: null,
    });
  });

  it('no banco nao ha texto puro: as 4 colunas estao no formato v1.k1.* e nao contem o dado', async () => {
    const p = await criar(a, {
      nome: 'Fulana Cifrada',
      nascimento: '1985-01-02',
      telefone: '11 98888-7777',
      email: 'fulana.cifrada@exemplo.com',
    });
    const crua = await linhaCrua(a, p.id);
    const colunas = [
      crua.nomeCifrado,
      crua.nascimentoCifrado,
      crua.telefoneCifrado,
      crua.emailCifrado,
    ];
    for (const c of colunas)
      expect(c).toMatch(/^v1\.k1\.[\w-]+\.[\w-]+\.[\w-]*$/);
    const tudo = JSON.stringify(crua);
    for (const puro of ['Fulana', '1985', '98888', 'fulana.cifrada']) {
      expect(tudo).not.toContain(puro);
    }
  });

  it('o mesmo nome em dois pacientes gera textos cifrados diferentes (iv aleatorio)', async () => {
    const x = await criar(a, { nome: 'Igual' });
    const y = await criar(a, { nome: 'Igual' });
    expect((await linhaCrua(a, x.id)).nomeCifrado).not.toBe(
      (await linhaCrua(a, y.id)).nomeCifrado,
    );
  });

  it('AAD: cifrado de um paciente copiado para outro do MESMO psicologo nao decifra (500 generico, sem o nome)', async () => {
    // clinica propria: a linha adulterada nao pode quebrar a listagem dos outros testes
    const c = await novaClinica(email('aad'));
    const x = await criar(c, { nome: 'Nome Secreto X' });
    const y = await criar(c, { nome: 'Nome Secreto Y' });
    const cifradoY = (await linhaCrua(c, y.id)).nomeCifrado;
    await app.get(TenantPrismaService).runComoUsuario(c, (tx) =>
      tx.paciente.updateMany({
        where: { id: x.id },
        data: { nomeCifrado: cifradoY },
      }),
    );
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const res = await get(c, `/${x.id}`).expect(500);
    expect(res.body).toEqual(ERRO_500);
    expect(JSON.stringify(res.body)).not.toContain('Secreto');
    expect(JSON.stringify(log.mock.calls)).not.toContain('Secreto');
    // a lista tambem falha fechada: nao devolve o nome trocado
    const lista = await get(c).expect(500);
    expect(JSON.stringify(lista.body)).not.toContain('Secreto');
    log.mockRestore();
    // o outro continua legivel
    await get(c, `/${y.id}`).expect(200);
  });
});

describe('validacao', () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  it.each([
    ['sem nome', {}],
    ['nome vazio (so espacos)', { nome: '   ' }],
    ['nome com 121 caracteres', { nome: 'a'.repeat(121) }],
    ['nome nao string', { nome: 123 }],
    ['nascimento futuro', { nome: 'X', nascimento: amanha }],
    ['nascimento impossivel', { nome: 'X', nascimento: '2026-02-30' }],
    ['nascimento antes de 1900', { nome: 'X', nascimento: '1899-12-31' }],
    ['nascimento em outro formato', { nome: 'X', nascimento: '17/05/1990' }],
    ['e-mail invalido', { nome: 'X', email: 'nao-e-email' }],
    [
      'e-mail com mais de 254',
      { nome: 'X', email: `${'a'.repeat(250)}@x.com` },
    ],
    ['telefone curto', { nome: 'X', telefone: '1234567' }],
    ['telefone longo', { nome: 'X', telefone: '1'.repeat(21) }],
    ['telefone com letras', { nome: 'X', telefone: '1199999-000a' }],
    ['campo extra clinicaId', { nome: 'X', clinicaId: randomUUID() }],
    ['campo extra psicologoId', { nome: 'X', psicologoId: randomUUID() }],
    ['campo extra id', { nome: 'X', id: randomUUID() }],
  ])('400: %s', async (_t, corpo) => {
    await post(a, corpo).expect(400);
  });

  it('aceita nascimento de hoje e de 1900-01-01', async () => {
    await post(a, { nome: 'Bebe', nascimento: hoje }).expect(201);
    await post(a, { nome: 'Idoso', nascimento: '1900-01-01' }).expect(201);
  });

  it('401 sem token e com token lixo', async () => {
    await post(undefined, { nome: 'X' }).expect(401);
    await get(undefined).expect(401);
    await get(undefined, `/${randomUUID()}`).expect(401);
    await patch(undefined, randomUUID(), { nome: 'X' }).expect(401);
    await get({ ...a, token: 'lixo' }).expect(401);
  });

  it('403 com senha provisoria (colega recem-criado) em todas as rotas', async () => {
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
      () => post(prov, { nome: 'X' }),
      () => get(prov),
      () => get(prov, `/${randomUUID()}`),
      () => patch(prov, randomUUID(), { nome: 'X' }),
    ];
    for (const chamar of chamadas) {
      expect((await chamar().expect(403)).body).toEqual(esperado);
    }
  });
});

describe('GET /pacientes e /pacientes/:id', () => {
  it('lista so os proprios, ordenados por nome (pt-BR, sem caixa/acento)', async () => {
    const c = await novaClinica(email('lista'));
    for (const nome of ['Zélia', 'ana', 'Édson', 'Bruno']) {
      await criar(c, { nome });
    }
    const res = await get(c).expect(200);
    expect((res.body as Paciente[]).map((p) => p.nome)).toEqual([
      'ana',
      'Bruno',
      'Édson',
      'Zélia',
    ]);
  });

  it('ADMIN nao ve paciente de colega e o colega nao ve o do ADMIN (lista e por id)', async () => {
    const doAdmin = await criar(a, { nome: 'Paciente do Admin' });
    const doColega = await criar(psi, { nome: 'Paciente do Colega' });
    const nomesA = ((await get(a).expect(200)).body as Paciente[]).map(
      (p) => p.id,
    );
    const nomesPsi = ((await get(psi).expect(200)).body as Paciente[]).map(
      (p) => p.id,
    );
    expect(nomesA).toContain(doAdmin.id);
    expect(nomesA).not.toContain(doColega.id);
    expect(nomesPsi).toContain(doColega.id);
    expect(nomesPsi).not.toContain(doAdmin.id);
    await get(a, `/${doColega.id}`).expect(404);
    await get(psi, `/${doAdmin.id}`).expect(404);
  });

  it('404 IDENTICO para inexistente, de colega e de outra clinica (GET e PATCH)', async () => {
    const doColega = await criar(psi, { nome: 'Alheio' });
    const doutraClinica = await criar(b, { nome: 'Alheio B' });
    const inexistente = randomUUID();
    const corpos = new Set<string>();
    for (const id of [doColega.id, doutraClinica.id, inexistente]) {
      const g = await get(a, `/${id}`).expect(404);
      const p = await patch(a, id, { nome: 'Invasor' }).expect(404);
      corpos.add(JSON.stringify(g.body));
      corpos.add(JSON.stringify(p.body));
    }
    expect([...corpos]).toHaveLength(1);
    // e o PATCH de invasor nao alterou nada
    expect((await get(psi, `/${doColega.id}`).expect(200)).body).toMatchObject({
      nome: 'Alheio',
    });
  });

  it('id que nao e uuid = 400', async () => {
    await get(a, '/nao-e-uuid').expect(400);
    await patch(a, 'nao-e-uuid', { nome: 'X' }).expect(400);
  });

  it('GET por id devolve o mesmo corpo do POST', async () => {
    const p = await criar(a, {
      nome: 'Leitura',
      nascimento: '2000-02-29',
      email: 'l@x.com',
    });
    expect((await get(a, `/${p.id}`).expect(200)).body).toEqual(p);
  });
});

describe('PATCH /pacientes/:id', () => {
  it('edita so o que veio; null limpa os opcionais; atualizadoEm avanca', async () => {
    const p = await criar(a, {
      nome: 'Antes',
      nascimento: '1990-01-01',
      telefone: '11 99999-0000',
      email: 'antes@x.com',
    });
    const antes = (await linhaCrua(a, p.id)).atualizadoEm;
    await new Promise((r) => setTimeout(r, 20));
    const r1 = await patch(a, p.id, { nome: ' Depois ' }).expect(200);
    expect(r1.body).toEqual({ ...p, nome: 'Depois' });
    const r2 = await patch(a, p.id, {
      telefone: null,
      email: 'novo@x.com',
      nascimento: '1991-02-03',
    }).expect(200);
    expect(r2.body).toEqual({
      ...p,
      nome: 'Depois',
      telefone: null,
      email: 'novo@x.com',
      nascimento: '1991-02-03',
    });
    const r3 = await patch(a, p.id, { email: null, nascimento: null }).expect(
      200,
    );
    expect(r3.body).toMatchObject({ email: null, nascimento: null });
    const depois = await linhaCrua(a, p.id);
    expect(depois.atualizadoEm.getTime()).toBeGreaterThan(antes.getTime());
    expect(depois.telefoneCifrado).toBeNull();
    expect(depois.criadoEm).toEqual((await linhaCrua(a, p.id)).criadoEm);
  });

  it('o texto novo tambem vai cifrado', async () => {
    const p = await criar(a, { nome: 'Cifra Patch' });
    await patch(a, p.id, { telefone: '11 97777-6666' }).expect(200);
    const crua = await linhaCrua(a, p.id);
    expect(crua.telefoneCifrado).toMatch(/^v1\.k1\./);
    expect(JSON.stringify(crua)).not.toContain('97777');
  });

  it('400: corpo vazio, nome null, campo extra, dados invalidos', async () => {
    const p = await criar(a, { nome: 'Valida' });
    await patch(a, p.id, {}).expect(400);
    await patch(a, p.id, { nome: null }).expect(400);
    await patch(a, p.id, { nome: '   ' }).expect(400);
    await patch(a, p.id, { psicologoId: randomUUID() }).expect(400);
    await patch(a, p.id, { clinicaId: b.clinicaId }).expect(400);
    await patch(a, p.id, { email: 'ruim' }).expect(400);
    await patch(a, p.id, { nascimento: '2999-01-01' }).expect(400);
    expect((await get(a, `/${p.id}`).expect(200)).body).toMatchObject({
      nome: 'Valida',
    });
  });
});
