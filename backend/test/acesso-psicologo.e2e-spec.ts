import { randomUUID } from 'node:crypto';
import { Papel, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

// Barreiras de banco em "Psicologo" e privilegios do notta_app (Postgres real).
// UPDATE so na PROPRIA linha e so em nome/abordagemPadrao/senhaHash; sem TEMP.
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
type U = { clinicaId: string; psicologoId: string };
let adminA: U;
let psiA: U;
let psiB: U;

async function criarPsicologo(clinicaId: string, nome: string, papel: Papel) {
  const p = await tenant.run(clinicaId, (tx) =>
    tx.psicologo.create({
      data: {
        clinicaId,
        nome,
        papel,
        email: `${nome}-${sufixo}@teste.local`,
        senhaHash: 'x',
        abordagemPadrao: 'TCC',
      },
    }),
  );
  return { clinicaId, psicologoId: p.id };
}

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
  await owner.$executeRawUnsafe('DROP TABLE IF EXISTS _teste_sequencia');
  for (const id of [A, B]) {
    await tenant.run(id, async (tx) => {
      await tx.psicologo.deleteMany({ where: { clinicaId: id } });
      await tx.clinica.deleteMany({ where: { id } });
    });
  }
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

  it.each<[string, Prisma.PsicologoUpdateManyMutationInput]>([
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

  it('SELECT, INSERT e DELETE seguem por clinica', async () => {
    const lista = await tenant.run(A, (tx) =>
      tx.psicologo.findMany({
        where: { clinicaId: A },
        orderBy: { nome: 'asc' },
      }),
    );
    expect(lista.map((p) => p.nome)).toEqual(['admin-a', 'psi-a']);
    const extra = await criarPsicologo(A, 'extra-a', 'PSICOLOGO');
    const del = await tenant.run(A, (tx) =>
      tx.psicologo.deleteMany({
        where: { id: extra.psicologoId, clinicaId: A },
      }),
    );
    expect(del).toEqual({ count: 1 });
  });
});

describe('privilegios do notta_app', () => {
  it('nao consegue CREATE TEMP TABLE', async () => {
    await expect(
      app.$executeRawUnsafe('CREATE TEMP TABLE _teste_temp (x int)'),
    ).rejects.toThrow(/permission denied/);
  });

  it('tabela nova do owner com sequence: app insere (DEFAULT PRIVILEGES em SEQUENCES)', async () => {
    await owner.$executeRawUnsafe('DROP TABLE IF EXISTS _teste_sequencia');
    await owner.$executeRawUnsafe(
      'CREATE TABLE _teste_sequencia (id serial PRIMARY KEY, x text)',
    );
    await expect(
      app.$executeRawUnsafe("INSERT INTO _teste_sequencia (x) VALUES ('a')"),
    ).resolves.toBe(1);
  });
});
