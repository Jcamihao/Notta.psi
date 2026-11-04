import { randomUUID } from 'node:crypto';
import { Papel, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas } from './acesso-owner';

// RLS, privilegios, FK e CHECK de "Documento" (item 12) no Postgres real, como notta_app.
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
const docDe: Record<string, string> = {};

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

const novoPaciente = (u: U) =>
  tenant.runComoUsuario(u, async (tx) => {
    const id = randomUUID();
    await tx.paciente.create({
      data: {
        id,
        clinicaId: u.clinicaId,
        psicologoId: u.psicologoId,
        nomeCifrado: 'x',
      },
    });
    return id;
  });

// Grava como `u`, com o dono/paciente/status/tipo que o teste quiser (prova o que o banco recusa).
const gravar = (
  u: U,
  alvo: { dono?: U; pacienteId: string; status?: string; tipo?: string },
) =>
  tenant.runComoUsuario(u, async (tx) => {
    const dono = alvo.dono ?? u;
    const l = await tx.documento.create({
      data: {
        id: randomUUID(),
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        pacienteId: alvo.pacienteId,
        tipo: alvo.tipo ?? 'NOTA_BRUTA',
        ...(alvo.status && { status: alvo.status }),
        conteudoCifrado: 'x',
      },
    });
    return l.id;
  });

const ver = (u: U) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.documento.findMany({ select: { id: true } }),
  );

const sql = (u: U, texto: string) =>
  tenant.runComoUsuario(u, (tx) => tx.$executeRawUnsafe(texto));

beforeAll(async () => {
  for (const [id, nome] of [
    [A, 'A'],
    [B, 'B'],
  ]) {
    await tenant.run(id, (tx) =>
      tx.clinica.create({ data: { id, nome: `${nome}-${sufixo}` } }),
    );
  }
  adminA = await criarPsicologo(A, 'doc-admin-a', 'ADMIN');
  psiA = await criarPsicologo(A, 'doc-psi-a', 'PSICOLOGO');
  psiB = await criarPsicologo(B, 'doc-psi-b', 'PSICOLOGO');
  pacienteDe.adminA = await novoPaciente(adminA);
  pacienteDe.psiA = await novoPaciente(psiA);
  pacienteDe.psiB = await novoPaciente(psiB);
  docDe.adminA = await gravar(adminA, { pacienteId: pacienteDe.adminA });
  docDe.psiA = await gravar(psiA, { pacienteId: pacienteDe.psiA });
  docDe.psiB = await gravar(psiB, { pacienteId: pacienteDe.psiB });
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('Documento: estrutura no banco', () => {
  it('RLS ENABLE + FORCE, so a policy psicologo_proprio, sem FK em cascade, so SELECT e INSERT', async () => {
    const [t] = await owner.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Documento'`;
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.$queryRaw<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE tablename = 'Documento'`;
    expect(p).toEqual([{ policyname: 'psicologo_proprio' }]);
    const c = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"Documento"'::regclass AND contype = 'f' AND confdeltype = 'c'`;
    expect(c).toEqual([]);
    const g = await owner.$queryRaw<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'Documento' AND grantee = 'notta_app' ORDER BY privilege_type`;
    expect(g).toEqual([
      { privilege_type: 'INSERT' },
      { privilege_type: 'SELECT' },
    ]);
  });
});

describe('Documento: leitura isolada por psicologo', () => {
  it('sem contexto = ZERO linhas (nao erro, nao todas)', async () => {
    expect(await app.$queryRaw`SELECT id FROM "Documento"`).toEqual([]);
    // so a clinica, sem psicologo: tambem zero (falha fechada)
    expect(
      await tenant.run(A, (tx) =>
        tx.documento.findMany({ select: { id: true } }),
      ),
    ).toEqual([]);
  });

  it('cada um ve so o proprio; colega da mesma clinica (inclusive ADMIN) e outra clinica veem zero do alheio', async () => {
    expect(await ver(adminA)).toEqual([{ id: docDe.adminA }]);
    expect(await ver(psiA)).toEqual([{ id: docDe.psiA }]);
    expect(await ver(psiB)).toEqual([{ id: docDe.psiB }]);
    // contexto montado com clinica de uma e psicologo de outra: zero
    const cruzado = await tenant.runComoUsuario(
      { clinicaId: B, psicologoId: psiA.psicologoId },
      (tx) => tx.documento.findMany(),
    );
    expect(cruzado).toEqual([]);
  });
});

describe('Documento: escrita', () => {
  it('INSERT com psicologoId alheio (colega ou ADMIN) e recusado pela policy', async () => {
    await expect(
      gravar(psiA, { dono: adminA, pacienteId: pacienteDe.adminA }),
    ).rejects.toThrow(/row-level security/);
    await expect(
      gravar(adminA, { dono: psiA, pacienteId: pacienteDe.psiA }),
    ).rejects.toThrow(/row-level security/);
    await expect(
      gravar(psiA, { dono: psiB, pacienteId: pacienteDe.psiB }),
    ).rejects.toThrow();
    expect(await ver(adminA)).toHaveLength(1);
  });

  it("INSERT ja APROVADO e recusado pela policy (WITH CHECK exige status = 'RASCUNHO')", async () => {
    await expect(
      gravar(psiA, { pacienteId: pacienteDe.psiA, status: 'APROVADO' }),
    ).rejects.toThrow(/row-level security/);
    expect(await ver(psiA)).toHaveLength(1);
  });

  it('tipo fora da lista cai no CHECK do banco; CHECK de status existe', async () => {
    await expect(
      gravar(psiA, { pacienteId: pacienteDe.psiA, tipo: 'RECEITA' }),
    ).rejects.toThrow(/Documento_tipo_check/);
    // status: a policy recusa antes do CHECK, entao so a existencia do CHECK e provada aqui.
    const c = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"Documento"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(c).toEqual([
      { conname: 'Documento_status_check' },
      { conname: 'Documento_tipo_check' },
    ]);
    for (const tipo of ['NOTA_BRUTA', 'EVOLUCAO', 'ANAMNESE']) {
      await gravar(psiA, { pacienteId: pacienteDe.psiA, tipo });
    }
    expect(await ver(psiA)).toHaveLength(4);
  });

  it('FK filha: paciente de colega, de outra clinica e inexistente dao o MESMO erro (sem oraculo)', async () => {
    const erro = async (pacienteId: string) => {
      try {
        await gravar(psiA, { pacienteId });
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error('deveria ter falhado');
    };
    const inexistente = await erro(randomUUID());
    expect(inexistente).toMatch(/Foreign key constraint/);
    expect(await erro(pacienteDe.adminA)).toBe(inexistente);
    expect(await erro(pacienteDe.psiB)).toBe(inexistente);
  });

  it('notta_app: UPDATE, DELETE e TRUNCATE = permission denied (privilegio, nao so policy)', async () => {
    await expect(
      sql(psiA, `UPDATE "Documento" SET status = 'APROVADO'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sql(psiA, `UPDATE "Documento" SET "conteudoCifrado" = 'x'`),
    ).rejects.toThrow(/permission denied/);
    await expect(sql(psiA, `DELETE FROM "Documento"`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(sql(psiA, `TRUNCATE "Documento"`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('paciente com documento nao pode ser apagado (FK RESTRICT, nada de cascade)', async () => {
    const antes = (await ver(psiB)).length;
    await expect(
      tenant.runComoUsuario(psiB, async () =>
        owner.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_clinica_id', ${psiB.clinicaId}, true)`;
          await tx.$executeRaw`SELECT set_config('app.current_psicologo_id', ${psiB.psicologoId}, true)`;
          await tx.paciente.deleteMany({ where: { id: pacienteDe.psiB } });
        }),
      ),
    ).rejects.toThrow();
    expect(await ver(psiB)).toHaveLength(antes);
  });
});
