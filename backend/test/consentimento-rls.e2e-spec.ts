import { randomUUID } from 'node:crypto';
import { Papel, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner, ddl } from './acesso-owner';

// RLS, privilegios, FK, CHECK e trigger de "Consentimento" (item 10) no Postgres real.
// Padrao psicologo_proprio + somente-acrescentar (docs/ACESSO.md).
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
const linhaDe: Record<string, string> = {};

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

// Grava como `u`, com o dono/paciente/seq que o teste quiser (para provar o que o banco recusa).
const gravar = (
  u: U,
  alvo: { dono?: U; pacienteId: string; seq?: number; evento?: string },
) =>
  tenant.runComoUsuario(u, async (tx) => {
    const dono = alvo.dono ?? u;
    const l = await tx.consentimento.create({
      data: {
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        pacienteId: alvo.pacienteId,
        seq: alvo.seq ?? 1,
        evento: alvo.evento ?? 'CONCEDIDO',
        termoVersao: 'v',
        termoTexto: 't',
      },
    });
    return l.id;
  });

const ver = (u: U) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.consentimento.findMany({ select: { id: true } }),
  );

const sql = (u: U, texto: string) =>
  tenant.runComoUsuario(u, (tx) => tx.$executeRawUnsafe(texto));

// Como notta_owner (dono), com o contexto do usuario.
const sqlDono = (u: U, texto: string) =>
  comoOwner(u.clinicaId, (tx) => tx.$executeRawUnsafe(texto), {
    psicologoId: u.psicologoId,
  });

beforeAll(async () => {
  for (const [id, nome] of [
    [A, 'A'],
    [B, 'B'],
  ]) {
    await tenant.run(id, (tx) =>
      tx.clinica.create({ data: { id, nome: `${nome}-${sufixo}` } }),
    );
  }
  adminA = await criarPsicologo(A, 'cons-admin-a', 'ADMIN');
  psiA = await criarPsicologo(A, 'cons-psi-a', 'PSICOLOGO');
  psiB = await criarPsicologo(B, 'cons-psi-b', 'PSICOLOGO');
  pacienteDe.adminA = await novoPaciente(adminA);
  pacienteDe.psiA = await novoPaciente(psiA);
  pacienteDe.psiB = await novoPaciente(psiB);
  linhaDe.adminA = await gravar(adminA, { pacienteId: pacienteDe.adminA });
  linhaDe.psiA = await gravar(psiA, { pacienteId: pacienteDe.psiA });
  linhaDe.psiB = await gravar(psiB, { pacienteId: pacienteDe.psiB });
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('Consentimento: estrutura no banco', () => {
  it('RLS ENABLE + FORCE, policies esperadas, triggers de linha e de TRUNCATE, sem FK em cascade', async () => {
    const [t] = await owner.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Consentimento'`;
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.$queryRaw<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE tablename = 'Consentimento' ORDER BY policyname`;
    expect(p.map((x) => x.policyname)).toEqual([
      'consentimento_dono_delete',
      'consentimento_dono_update',
      'consentimento_origem_paciente', // item 22, RESTRITIVA (origem PACIENTE so no fluxo publico)
      'psicologo_proprio',
    ]);
    const g = await owner.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = '"Consentimento"'::regclass AND NOT tgisinternal ORDER BY tgname`;
    expect(g.map((x) => x.tgname)).toEqual([
      'consentimento_barreira_linha',
      'consentimento_barreira_truncate',
    ]);
    const c = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"Consentimento"'::regclass AND contype = 'f' AND confdeltype = 'c'`;
    expect(c).toEqual([]);
  });

  it('seq unico por paciente e CHECK de evento e de seq existem no banco', async () => {
    const u = await owner.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'Consentimento' AND indexdef LIKE 'CREATE UNIQUE%' AND indexname <> 'Consentimento_pkey'
        AND indexname NOT LIKE '%conviteId%'`;
    expect(u).toHaveLength(1);
    expect(u[0].indexdef).toContain('("pacienteId", "psicologoId", seq)');
    const k = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"Consentimento"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(k.map((x) => x.conname)).toEqual([
      'Consentimento_evento_check',
      'Consentimento_origem_check',
      'Consentimento_origem_convite_check',
      'Consentimento_seq_check',
    ]);
  });

  it('notta_app tem so SELECT e INSERT (nada de UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)', async () => {
    const [g] = await owner.$queryRaw<Record<string, boolean>[]>`
      SELECT
        has_table_privilege('notta_app', '"Consentimento"', 'SELECT') AS sel,
        has_table_privilege('notta_app', '"Consentimento"', 'INSERT') AS ins,
        has_table_privilege('notta_app', '"Consentimento"', 'UPDATE') AS upd,
        has_table_privilege('notta_app', '"Consentimento"', 'DELETE') AS del,
        has_table_privilege('notta_app', '"Consentimento"', 'TRUNCATE') AS trunc,
        has_table_privilege('notta_app', '"Consentimento"', 'REFERENCES') AS ref,
        has_table_privilege('notta_app', '"Consentimento"', 'TRIGGER') AS trg`;
    expect(g).toEqual({
      sel: true,
      ins: true,
      upd: false,
      del: false,
      trunc: false,
      ref: false,
      trg: false,
    });
  });
});

describe('Consentimento: leitura isolada por psicologo', () => {
  it('sem contexto = ZERO linhas (nao erro, nao todas)', async () => {
    expect(await app.$queryRaw`SELECT id FROM "Consentimento"`).toEqual([]);
    // so a clinica, sem psicologo: tambem zero (falha fechada)
    expect(
      await tenant.run(A, (tx) =>
        tx.consentimento.findMany({ select: { id: true } }),
      ),
    ).toEqual([]);
  });

  it('cada um ve so o proprio; colega (inclusive ADMIN) e outra clinica veem zero do alheio', async () => {
    expect(await ver(adminA)).toEqual([{ id: linhaDe.adminA }]);
    expect(await ver(psiA)).toEqual([{ id: linhaDe.psiA }]);
    expect(await ver(psiB)).toEqual([{ id: linhaDe.psiB }]);
    const cruzado = await tenant.runComoUsuario(
      { clinicaId: B, psicologoId: psiA.psicologoId },
      (tx) => tx.consentimento.findMany(),
    );
    expect(cruzado).toEqual([]);
  });
});

describe('Consentimento: escrita', () => {
  it('INSERT com psicologoId alheio (colega, ADMIN ou outra clinica) e recusado pela policy', async () => {
    const p = pacienteDe.psiA;
    await expect(
      gravar(psiA, { dono: adminA, pacienteId: p, seq: 9 }),
    ).rejects.toThrow(/row-level security/);
    await expect(
      gravar(adminA, { dono: psiA, pacienteId: p, seq: 9 }),
    ).rejects.toThrow(/row-level security/);
    await expect(
      gravar(psiA, { dono: psiB, pacienteId: p, seq: 9 }),
    ).rejects.toThrow();
    await expect(
      gravar(psiA, {
        dono: { clinicaId: B, psicologoId: psiA.psicologoId },
        pacienteId: p,
        seq: 9,
      }),
    ).rejects.toThrow();
    expect(await ver(psiA)).toHaveLength(1);
  });

  it('INSERT sem contexto e recusado', async () => {
    await expect(
      app.$executeRaw`INSERT INTO "Consentimento" (id, "clinicaId", "psicologoId", "pacienteId", seq, evento, "termoVersao", "termoTexto") VALUES (${randomUUID()}, ${psiA.clinicaId}, ${psiA.psicologoId}, ${pacienteDe.psiA}, 7, 'CONCEDIDO', 'v', 't')`,
    ).rejects.toThrow(/row-level security/);
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

  it('seq repetido no mesmo paciente colide no unique; evento e seq invalidos caem no CHECK', async () => {
    const p = pacienteDe.psiA;
    await expect(gravar(psiA, { pacienteId: p, seq: 1 })).rejects.toThrow(
      /Unique constraint/,
    );
    await expect(
      gravar(psiA, { pacienteId: p, seq: 2, evento: 'TALVEZ' }),
    ).rejects.toThrow(/Consentimento_evento_check/);
    await expect(gravar(psiA, { pacienteId: p, seq: 0 })).rejects.toThrow(
      /Consentimento_seq_check/,
    );
    expect(await ver(psiA)).toHaveLength(1);
  });

  it('paciente com consentimento nao pode ser apagado (FK RESTRICT, nada de cascade)', async () => {
    await expect(
      comoOwner(
        psiA.clinicaId,
        (tx) => tx.paciente.deleteMany({ where: { id: pacienteDe.psiA } }),
        { psicologoId: psiA.psicologoId },
      ),
    ).rejects.toThrow();
    expect(await ver(psiA)).toHaveLength(1);
  });
});

describe('Consentimento: somente-acrescentar', () => {
  it('notta_app: UPDATE, DELETE e TRUNCATE = permission denied (mesmo com o desvio de teste ligado)', async () => {
    const desvio = (u: U, texto: string) =>
      tenant.runComoUsuario(u, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.limpeza_de_teste', '1', true)`;
        return tx.$executeRawUnsafe(texto);
      });
    await expect(
      sql(psiA, `UPDATE "Consentimento" SET evento = 'REVOGADO'`),
    ).rejects.toThrow(/permission denied/);
    await expect(sql(psiA, `DELETE FROM "Consentimento"`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(sql(psiA, `TRUNCATE "Consentimento"`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(desvio(psiA, `DELETE FROM "Consentimento"`)).rejects.toThrow(
      /permission denied/,
    );
    expect(await ver(psiA)).toHaveLength(1);
  });

  it('trigger barra UPDATE e DELETE ate para o notta_owner (dono)', async () => {
    await expect(
      sqlDono(psiA, `UPDATE "Consentimento" SET evento = 'REVOGADO'`),
    ).rejects.toThrow(/somente-acrescentar/);
    await expect(sqlDono(psiA, `DELETE FROM "Consentimento"`)).rejects.toThrow(
      /somente-acrescentar/,
    );
    // o desvio so vale com `app.limpeza_de_teste = 1` na transacao: sem ele, barrado
    await expect(
      comoOwner(
        psiA.clinicaId,
        (tx) =>
          tx.consentimento.deleteMany({
            where: { psicologoId: psiA.psicologoId },
          }),
        { psicologoId: psiA.psicologoId },
      ),
    ).rejects.toThrow(/somente-acrescentar/);
    // o desvio NAO libera UPDATE
    await expect(
      comoOwner(
        psiA.clinicaId,
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.limpeza_de_teste', '1', true)`;
          return tx.$executeRawUnsafe(
            `UPDATE "Consentimento" SET evento = 'REVOGADO'`,
          );
        },
        { psicologoId: psiA.psicologoId },
      ),
    ).rejects.toThrow(/somente-acrescentar/);
    expect(await ver(psiA)).toHaveLength(1);
  });

  it('trigger barra TRUNCATE ate para o dono (com lock_timeout)', async () => {
    await expect(ddl(owner, `TRUNCATE "Consentimento"`)).rejects.toThrow(
      /somente-acrescentar/,
    );
    expect(await ver(psiA)).toHaveLength(1);
    expect(await ver(psiB)).toHaveLength(1);
  });
});
