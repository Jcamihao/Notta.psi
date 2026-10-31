import { randomUUID } from 'node:crypto';
import { Papel, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, ddl } from './acesso-owner';

// Barreiras de banco em "Psicologo"/"Clinica" e privilegios do notta_app (Postgres real).
// UPDATE so na PROPRIA linha e so em nome/abordagemPadrao/senhaHash/senhaProvisoria/
// tokenVersao; sem TEMP. INSERT so de colega provisorio ou do 1o ADMIN; sem DELETE;
// trigger da senha provisoria e da versao do token (M-2 da 2a revisao).
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: teste de acesso exige o papel notta_owner (ver backend/README.md)',
  );
}

const app = new PrismaClient();
const owner = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_OWNER } },
});
const tenant = new TenantPrismaService(app as unknown as PrismaService);

const sufixo = randomUUID().slice(0, 8);
const A = randomUUID();
const B = randomUUID();
const clinicas = [A, B];
type U = { clinicaId: string; psicologoId: string };
let adminA: U;
let psiA: U;
let psiB: U;

const dadosPsicologo = (clinicaId: string, nome: string, papel: Papel) => ({
  clinicaId,
  nome,
  papel,
  email: `${nome}-${sufixo}@teste.local`,
  senhaHash: 'x',
  abordagemPadrao: 'TCC' as const,
  // Como o codigo cria: colega provisorio (equipe), ADMIN definitivo (cadastro).
  senhaProvisoria: papel === 'PSICOLOGO',
});

async function criarPsicologo(clinicaId: string, nome: string, papel: Papel) {
  const p = await tenant.run(clinicaId, (tx) =>
    tx.psicologo.create({ data: dadosPsicologo(clinicaId, nome, papel) }),
  );
  return { clinicaId, psicologoId: p.id };
}

const estado = (u: U) =>
  tenant.run(u.clinicaId, (tx) =>
    tx.psicologo.findFirstOrThrow({
      where: { id: u.psicologoId },
      select: { senhaHash: true, senhaProvisoria: true, tokenVersao: true },
    }),
  );

// UPDATE na PROPRIA linha (contexto do proprio usuario).
const naPropriaLinha = (u: U, data: Prisma.PsicologoUpdateManyMutationInput) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.psicologo.updateMany({
      where: { id: u.psicologoId, clinicaId: u.clinicaId },
      data,
    }),
  );

// UPDATE de nome na linha `alvo`, no contexto de `quem`.
const mudarNome = (quem: U, alvo: U, nome: string) =>
  tenant.runComoUsuario(quem, (tx) =>
    tx.psicologo.updateMany({
      where: { id: alvo.psicologoId, clinicaId: alvo.clinicaId },
      data: { nome },
    }),
  );

const nomeDe = async (u: U) =>
  (
    await tenant.run(u.clinicaId, (tx) =>
      tx.psicologo.findFirstOrThrow({ where: { id: u.psicologoId } }),
    )
  ).nome;

beforeAll(async () => {
  for (const [id, nome] of [
    [A, 'A'],
    [B, 'B'],
  ]) {
    await tenant.run(id, (tx) =>
      tx.clinica.create({ data: { id, nome: `${nome}-${sufixo}` } }),
    );
  }
  adminA = await criarPsicologo(A, 'admin-a', 'ADMIN');
  psiA = await criarPsicologo(A, 'psi-a', 'PSICOLOGO');
  psiB = await criarPsicologo(B, 'psi-b', 'PSICOLOGO');
});

afterAll(async () => {
  await ddl(owner, 'DROP TABLE IF EXISTS _teste_sequencia');
  await apagarClinicas(clinicas);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('UPDATE em Psicologo: so a propria linha', () => {
  it('policies de Psicologo: select/insert/delete por clinica, update proprio, login_lookup', async () => {
    const p = await owner.$queryRaw<{ policyname: string; cmd: string }[]>`
      SELECT policyname, cmd FROM pg_policies
      WHERE tablename = 'Psicologo' ORDER BY policyname`;
    expect(p).toEqual([
      { policyname: 'login_lookup', cmd: 'SELECT' },
      { policyname: 'psicologo_update_proprio', cmd: 'UPDATE' },
      { policyname: 'tenant_isolation_delete', cmd: 'DELETE' },
      { policyname: 'tenant_isolation_insert', cmd: 'INSERT' },
      { policyname: 'tenant_isolation_select', cmd: 'SELECT' },
    ]);
  });

  it('colega da mesma clinica nao atualiza a linha de outro nem a do ADMIN (0 linhas)', async () => {
    expect(await mudarNome(psiA, adminA, 'hack')).toEqual({ count: 0 });
    expect(await mudarNome(adminA, psiA, 'hack')).toEqual({ count: 0 });
    expect(await nomeDe(adminA)).toBe('admin-a');
    expect(await nomeDe(psiA)).toBe('psi-a');
  });

  it('atualiza a PROPRIA linha (nome, abordagemPadrao, senhaHash)', async () => {
    const r = await tenant.runComoUsuario(psiA, (tx) =>
      tx.psicologo.updateMany({
        where: { id: psiA.psicologoId, clinicaId: A },
        data: { nome: 'psi-a novo', abordagemPadrao: 'ACT', senhaHash: 'y' },
      }),
    );
    expect(r).toEqual({ count: 1 });
    expect(await nomeDe(psiA)).toBe('psi-a novo');
    await mudarNome(psiA, psiA, 'psi-a');
  });

  it('troca de senha (item 62): a PROPRIA linha troca; colega e ADMIN nao (0)', async () => {
    const trocar = (quem: U, alvo: U) =>
      tenant.runComoUsuario(quem, (tx) =>
        tx.psicologo.updateMany({
          where: { id: alvo.psicologoId, clinicaId: alvo.clinicaId },
          data: {
            senhaHash: 'trocada',
            senhaProvisoria: false,
            tokenVersao: { increment: 1 },
          },
        }),
      );
    const psiB2 = await criarPsicologo(B, 'psi-b2', 'PSICOLOGO');
    expect(await trocar(psiB, psiB2)).toEqual({ count: 0 });
    expect(await trocar(psiB, adminA)).toEqual({ count: 0 });
    expect(await estado(psiB2)).toEqual({
      senhaHash: 'x',
      senhaProvisoria: true,
      tokenVersao: 0,
    });
    expect(await trocar(psiB2, psiB2)).toEqual({ count: 1 });
    expect(await estado(psiB2)).toEqual({
      senhaHash: 'trocada',
      senhaProvisoria: false,
      tokenVersao: 1,
    });
    // sem psicologoId no contexto: 0
    const soClinica = await tenant.run(B, (tx) =>
      tx.psicologo.updateMany({
        where: { id: psiB2.psicologoId, clinicaId: B },
        data: { nome: 'hack' },
      }),
    );
    expect(soClinica).toEqual({ count: 0 });
  });

  it.each<[string, Prisma.PsicologoUncheckedUpdateManyInput]>([
    ['papel', { papel: 'ADMIN' }],
    ['email', { email: `outro-${sufixo}@teste.local` }],
    ['clinicaId', { clinicaId: B }],
    ['id', { id: randomUUID() }],
  ])(
    'coluna imutavel para o app: UPDATE %s = permission denied',
    async (_, data) => {
      await expect(
        tenant.runComoUsuario(psiA, (tx) =>
          tx.psicologo.updateMany({
            where: { id: psiA.psicologoId, clinicaId: A },
            data,
          }),
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it('sem psicologoId no contexto (so clinica): UPDATE afeta 0', async () => {
    const r = await tenant.run(A, (tx) =>
      tx.psicologo.updateMany({
        where: { id: psiA.psicologoId, clinicaId: A },
        data: { nome: 'hack' },
      }),
    );
    expect(r).toEqual({ count: 0 });
    expect(await nomeDe(psiA)).toBe('psi-a');
  });

  it('psicologoId certo com clinica errada: UPDATE afeta 0', async () => {
    const misturado = { clinicaId: B, psicologoId: psiA.psicologoId };
    const r = await tenant.runComoUsuario(misturado, (tx) =>
      tx.psicologo.updateMany({
        where: { id: psiA.psicologoId },
        data: { nome: 'hack' },
      }),
    );
    expect(r).toEqual({ count: 0 });
    // Sem WHERE o Postgres nao aplica a policy de SELECT: so a de UPDATE barra.
    const semWhere = await tenant.runComoUsuario(
      misturado,
      (tx) => tx.$executeRaw`UPDATE "Psicologo" SET "nome" = 'hack'`,
    );
    expect(semWhere).toBe(0);
    expect(await nomeDe(psiA)).toBe('psi-a');
  });

  it('outra clinica nao atualiza (0 linhas)', async () => {
    expect(await mudarNome(psiB, psiA, 'hack')).toEqual({ count: 0 });
  });

  it('SELECT e INSERT seguem por clinica', async () => {
    const lista = await tenant.run(A, (tx) =>
      tx.psicologo.findMany({
        where: { clinicaId: A },
        orderBy: { nome: 'asc' },
      }),
    );
    expect(lista.map((p) => p.nome)).toEqual(['admin-a', 'psi-a']);
    const extra = await criarPsicologo(A, 'extra-a', 'PSICOLOGO');
    expect(await nomeDe(extra)).toBe('extra-a');
  });
});

describe('privilegios do notta_app', () => {
  it('nao consegue CREATE TEMP TABLE', async () => {
    await expect(
      app.$executeRawUnsafe('CREATE TEMP TABLE _teste_temp (x int)'),
    ).rejects.toThrow(/permission denied/);
  });

  it('nao consegue criar large object (lo_create/lo_creat fora de RLS): permission denied', async () => {
    // O REVOKE esta em prisma/bootstrap/endurecer-banco.sql (superuser, uma vez por banco).
    for (const sql of ['SELECT lo_create(0)', 'SELECT lo_creat(-1)']) {
      await expect(app.$queryRawUnsafe(sql)).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('tabela nova do owner com sequence: app insere (DEFAULT PRIVILEGES em SEQUENCES)', async () => {
    await ddl(owner, 'DROP TABLE IF EXISTS _teste_sequencia');
    await ddl(
      owner,
      'CREATE TABLE _teste_sequencia (id serial PRIMARY KEY, x text)',
    );
    await expect(
      app.$executeRawUnsafe("INSERT INTO _teste_sequencia (x) VALUES ('a')"),
    ).resolves.toBe(1);
  });
});

// M-2: o banco segura sozinho o que antes so o codigo segurava.
describe('INSERT em Psicologo: so colega provisorio ou o 1o ADMIN da clinica', () => {
  const inserir = (clinicaId: string, data: object) =>
    tenant.run(clinicaId, (tx) =>
      tx.psicologo.createMany({
        data: [
          {
            ...dadosPsicologo(clinicaId, `n-${randomUUID()}`, 'PSICOLOGO'),
            ...data,
          },
        ],
      }),
    );
  const novaClinica = async () => {
    const id = randomUUID();
    clinicas.push(id);
    await tenant.run(id, (tx) =>
      tx.clinica.create({ data: { id, nome: `nova-${sufixo}` } }),
    );
    return id;
  };

  it('colega insere ADMIN na clinica que ja tem psicologo = erro', async () => {
    for (const data of [
      { papel: 'ADMIN', senhaProvisoria: false },
      { papel: 'ADMIN', senhaProvisoria: true },
    ]) {
      await expect(inserir(A, data)).rejects.toThrow(/row-level security/);
    }
  });

  it('colega nao provisorio ou com tokenVersao != 0 = erro', async () => {
    await expect(inserir(A, { senhaProvisoria: false })).rejects.toThrow(
      /row-level security/,
    );
    for (const tokenVersao of [1, 999, -5]) {
      await expect(inserir(A, { tokenVersao })).rejects.toThrow(
        /row-level security/,
      );
    }
  });

  it('colega provisorio com versao 0 entra (o que a equipe faz)', async () => {
    await expect(inserir(A, {})).resolves.toEqual({ count: 1 });
  });

  it('clinica nova: 1o ADMIN definitivo entra; provisorio, versao != 0 ou 2o ADMIN = erro', async () => {
    const C = await novaClinica();
    const admin = { papel: 'ADMIN', senhaProvisoria: false };
    await expect(
      inserir(C, { ...admin, senhaProvisoria: true }),
    ).rejects.toThrow(/row-level security/);
    await expect(inserir(C, { ...admin, tokenVersao: 3 })).rejects.toThrow(
      /row-level security/,
    );
    await expect(inserir(C, admin)).resolves.toEqual({ count: 1 });
    await expect(inserir(C, admin)).rejects.toThrow(/row-level security/);
  });
});

describe('DELETE em Psicologo e UPDATE/DELETE em Clinica: o app nao tem', () => {
  it('colega apaga o ADMIN = permission denied (e a linha fica)', async () => {
    await expect(
      tenant.run(A, (tx) =>
        tx.psicologo.deleteMany({
          where: { id: adminA.psicologoId, clinicaId: A },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    expect(await nomeDe(adminA)).toBe('admin-a');
  });

  it('UPDATE e DELETE de Clinica = permission denied', async () => {
    await expect(
      tenant.run(A, (tx) =>
        tx.clinica.updateMany({ where: { id: A }, data: { nome: 'hack' } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      tenant.run(A, (tx) => tx.clinica.deleteMany({ where: { id: A } })),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('trigger em Psicologo: senha provisoria e versao do token', () => {
  let p: U;
  beforeEach(async () => {
    p = await criarPsicologo(A, `t-${randomUUID().slice(0, 8)}`, 'PSICOLOGO');
  });

  it('sair da senha provisoria sem trocar o hash = erro', async () => {
    await expect(naPropriaLinha(p, { senhaProvisoria: false })).rejects.toThrow(
      /senhaProvisoria/,
    );
    await expect(
      naPropriaLinha(p, {
        senhaProvisoria: false,
        tokenVersao: { increment: 1 },
      }),
    ).rejects.toThrow(/senhaProvisoria/);
    expect(await estado(p)).toMatchObject({
      senhaProvisoria: true,
      tokenVersao: 0,
    });
  });

  it('tokenVersao: -5, +2, ou +1 sem trocar o hash = erro', async () => {
    for (const data of [
      { senhaHash: 'h1', tokenVersao: -5 },
      { senhaHash: 'h2', tokenVersao: 2 },
      { tokenVersao: 1 },
    ]) {
      await expect(naPropriaLinha(p, data)).rejects.toThrow(/tokenVersao/);
    }
    expect(await estado(p)).toEqual({
      senhaHash: 'x',
      senhaProvisoria: true,
      tokenVersao: 0,
    });
  });

  it('troca legitima (hash + provisoria false + versao +1) = ok; voltar a provisoria = erro', async () => {
    const troca = {
      senhaHash: 'nova',
      senhaProvisoria: false,
      tokenVersao: { increment: 1 },
    };
    expect(await naPropriaLinha(p, troca)).toEqual({ count: 1 });
    // troca voluntaria seguinte tambem passa (sem provisoria)
    expect(
      await naPropriaLinha(p, {
        senhaHash: 'outra',
        tokenVersao: { increment: 1 },
      }),
    ).toEqual({ count: 1 });
    expect(await estado(p)).toEqual({
      senhaHash: 'outra',
      senhaProvisoria: false,
      tokenVersao: 2,
    });
    await expect(
      naPropriaLinha(p, { senhaHash: 'mais', senhaProvisoria: true }),
    ).rejects.toThrow(/senhaProvisoria/);
  });

  it('nome e abordagem seguem livres, sem mexer em senha nem versao', async () => {
    expect(
      await naPropriaLinha(p, { nome: 'livre', abordagemPadrao: 'ACT' }),
    ).toEqual({ count: 1 });
  });

  it('o app nao desliga nem troca o trigger', async () => {
    await expect(
      app.$executeRawUnsafe('ALTER TABLE "Psicologo" DISABLE TRIGGER ALL'),
    ).rejects.toThrow(/must be owner/);
    await expect(
      app.$executeRawUnsafe('SET session_replication_role = replica'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.$executeRawUnsafe(
        'CREATE OR REPLACE FUNCTION psicologo_barreira_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$',
      ),
    ).rejects.toThrow(/permission denied|must be owner/);
    const [t] = await owner.$queryRaw<{ dono: string; ativo: string }[]>`
      SELECT pg_get_userbyid(p.proowner) AS dono, t.tgenabled AS ativo
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = '"Psicologo"'::regclass AND NOT t.tgisinternal`;
    expect(t).toEqual({ dono: 'notta_owner', ativo: 'O' });
  });
});
