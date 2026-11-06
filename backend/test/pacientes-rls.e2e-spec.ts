import { randomUUID } from 'node:crypto';
import { Papel, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas } from './acesso-owner';

// RLS e privilegios de "Paciente" (item 9) no Postgres real, como notta_app.
// Padrao psicologo_proprio de docs/ACESSO.md: colega (inclusive ADMIN) e outra clinica veem ZERO.
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: teste de acesso exige o papel notta_owner (ver backend/README.md)',
  );
}

// connection_limit=1: toda consulta reusa a MESMA conexao (prova vazamento de contexto).
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('connection_limit', '1');
const app = new PrismaClient({ datasources: { db: { url: url.toString() } } });
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
const pacienteDe: Record<string, string> = {};

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
        senhaProvisoria: papel === 'PSICOLOGO',
      },
    }),
  );
  return { clinicaId, psicologoId: p.id };
}

const novoPaciente = (u: U, nomeCifrado: string) =>
  tenant.runComoUsuario(u, async (tx) => {
    const id = randomUUID();
    await tx.paciente.create({
      data: {
        id,
        clinicaId: u.clinicaId,
        psicologoId: u.psicologoId,
        nomeCifrado,
      },
    });
    return id;
  });

const ver = (u: U) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.paciente.findMany({ select: { id: true } }),
  );

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
  pacienteDe.adminA = await novoPaciente(adminA, 'x');
  pacienteDe.psiA = await novoPaciente(psiA, 'x');
  pacienteDe.psiB = await novoPaciente(psiB, 'x');
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('Paciente: estrutura no banco', () => {
  it('RLS ENABLE + FORCE, psicologo_proprio + policies de recifragem do dono, sem FK em cascade', async () => {
    const [t] = await owner.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Paciente'`;
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.$queryRaw<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE tablename = 'Paciente'`;
    expect(p.map((x) => x.policyname).sort()).toEqual([
      'paciente_recifrar_select',
      'paciente_recifrar_update',
      'psicologo_proprio',
    ]);
    const c = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"Paciente"'::regclass AND contype = 'f' AND confdeltype = 'c'`;
    expect(c).toEqual([]);
  });
});

describe('Paciente: leitura isolada por psicologo', () => {
  it('sem contexto = ZERO linhas (nao erro, nao todas)', async () => {
    expect(await app.$queryRaw`SELECT id FROM "Paciente"`).toEqual([]);
    // so a clinica, sem psicologo: tambem zero (falha fechada)
    expect(
      await tenant.run(A, (tx) =>
        tx.paciente.findMany({ select: { id: true } }),
      ),
    ).toEqual([]);
  });

  it('cada um ve so o proprio; colega da mesma clinica (inclusive ADMIN) e outra clinica veem zero do alheio', async () => {
    expect(await ver(adminA)).toEqual([{ id: pacienteDe.adminA }]);
    expect(await ver(psiA)).toEqual([{ id: pacienteDe.psiA }]);
    expect(await ver(psiB)).toEqual([{ id: pacienteDe.psiB }]);
    // contexto montado com clinica de uma e psicologo de outra: zero
    const cruzado = await tenant.runComoUsuario(
      { clinicaId: B, psicologoId: psiA.psicologoId },
      (tx) => tx.paciente.findMany(),
    );
    expect(cruzado).toEqual([]);
  });
});

describe('Paciente: escrita', () => {
  it('INSERT com psicologoId alheio (colega ou ADMIN) e recusado pela policy', async () => {
    const inserir = (quem: U, dono: U) =>
      tenant.runComoUsuario(quem, (tx) =>
        tx.paciente.create({
          data: {
            id: randomUUID(),
            clinicaId: dono.clinicaId,
            psicologoId: dono.psicologoId,
            nomeCifrado: 'x',
          },
        }),
      );
    await expect(inserir(psiA, adminA)).rejects.toThrow(/row-level security/);
    await expect(inserir(adminA, psiA)).rejects.toThrow(/row-level security/);
    await expect(inserir(psiA, psiB)).rejects.toThrow();
    expect(await ver(adminA)).toHaveLength(1);
  });

  it('UPDATE das colunas cifradas na propria linha funciona; em linha de colega afeta 0', async () => {
    const mudar = (quem: U, id: string, nomeCifrado: string) =>
      tenant.runComoUsuario(quem, (tx) =>
        tx.paciente.updateMany({
          where: { id },
          data: { nomeCifrado },
        }),
      );
    expect(await mudar(psiA, pacienteDe.psiA, 'novo')).toEqual({ count: 1 });
    expect(await mudar(adminA, pacienteDe.psiA, 'hack')).toEqual({ count: 0 });
    expect(await mudar(psiB, pacienteDe.psiA, 'hack')).toEqual({ count: 0 });
    const [l] = await tenant.runComoUsuario(psiA, (tx) =>
      tx.paciente.findMany({ select: { nomeCifrado: true } }),
    );
    expect(l.nomeCifrado).toBe('novo');
  });

  it('UPDATE de id, clinicaId e psicologoId e DELETE: permission denied (privilegio, nao so policy)', async () => {
    const sql = (u: U, texto: string) =>
      tenant.runComoUsuario(u, (tx) => tx.$executeRawUnsafe(texto));
    for (const coluna of ['"psicologoId"', '"clinicaId"', '"id"']) {
      await expect(
        sql(psiA, `UPDATE "Paciente" SET ${coluna} = ${coluna}`),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(sql(psiA, `DELETE FROM "Paciente"`)).rejects.toThrow(
      /permission denied/,
    );
    expect(await ver(psiA)).toHaveLength(1);
  });
});
