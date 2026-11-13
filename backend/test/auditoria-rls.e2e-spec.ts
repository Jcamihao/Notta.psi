import { randomUUID } from 'node:crypto';
import { Papel, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner, ddl } from './acesso-owner';

// RLS, privilegios e trigger de "Auditoria" (item 11) no Postgres real. Somente-acrescentar.
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: teste de acesso exige o papel praxis_owner (ver backend/README.md)',
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

const registrar = (u: U, dono: U = u, acao = 'LEU') =>
  tenant.runComoUsuario(u, async (tx) => {
    const l = await tx.auditoria.create({
      data: {
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        acao,
        recurso: 'Paciente',
        recursoId: randomUUID(),
      },
    });
    return l.id;
  });

const ver = (u: U) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.auditoria.findMany({ select: { id: true } }),
  );

const sql = (u: U, texto: string) =>
  tenant.runComoUsuario(u, (tx) => tx.$executeRawUnsafe(texto));

// Como praxis_owner (dono), com o contexto do usuario.
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
  adminA = await criarPsicologo(A, 'aud-admin-a', 'ADMIN');
  psiA = await criarPsicologo(A, 'aud-psi-a', 'PSICOLOGO');
  psiB = await criarPsicologo(B, 'aud-psi-b', 'PSICOLOGO');
  linhaDe.adminA = await registrar(adminA);
  linhaDe.psiA = await registrar(psiA);
  linhaDe.psiB = await registrar(psiB);
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('Auditoria: estrutura no banco', () => {
  it('RLS ENABLE + FORCE, policies esperadas, trigger de linha e de TRUNCATE, sem FK em cascade', async () => {
    const [t] = await owner.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Auditoria'`;
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.$queryRaw<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE tablename = 'Auditoria' ORDER BY policyname`;
    expect(p.map((x) => x.policyname)).toEqual([
      'auditoria_descartar_insert',
      'auditoria_dono_delete',
      'auditoria_dono_update',
      'auditoria_insert',
      'auditoria_select_proprio',
    ]);
    const g = await owner.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = '"Auditoria"'::regclass AND NOT tgisinternal ORDER BY tgname`;
    expect(g.map((x) => x.tgname)).toEqual([
      'auditoria_barreira_linha',
      'auditoria_barreira_truncate',
    ]);
    const c = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"Auditoria"'::regclass AND contype = 'f' AND confdeltype = 'c'`;
    expect(c).toEqual([]);
  });

  it('praxis_app tem so SELECT e INSERT (nada de UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)', async () => {
    const [g] = await owner.$queryRaw<Record<string, boolean>[]>`
      SELECT
        has_table_privilege('praxis_app', '"Auditoria"', 'SELECT') AS sel,
        has_table_privilege('praxis_app', '"Auditoria"', 'INSERT') AS ins,
        has_table_privilege('praxis_app', '"Auditoria"', 'UPDATE') AS upd,
        has_table_privilege('praxis_app', '"Auditoria"', 'DELETE') AS del,
        has_table_privilege('praxis_app', '"Auditoria"', 'TRUNCATE') AS trunc,
        has_table_privilege('praxis_app', '"Auditoria"', 'REFERENCES') AS ref,
        has_table_privilege('praxis_app', '"Auditoria"', 'TRIGGER') AS trg`;
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

describe('Auditoria: leitura isolada por psicologo', () => {
  it('sem contexto = ZERO linhas (nao erro, nao todas)', async () => {
    expect(await app.$queryRaw`SELECT id FROM "Auditoria"`).toEqual([]);
    // so a clinica, sem psicologo: tambem zero (falha fechada)
    expect(
      await tenant.run(A, (tx) =>
        tx.auditoria.findMany({ select: { id: true } }),
      ),
    ).toEqual([]);
  });

  it('cada um ve so as proprias; colega (inclusive ADMIN) e outra clinica veem zero do alheio', async () => {
    expect(await ver(adminA)).toEqual([{ id: linhaDe.adminA }]);
    expect(await ver(psiA)).toEqual([{ id: linhaDe.psiA }]);
    expect(await ver(psiB)).toEqual([{ id: linhaDe.psiB }]);
    const cruzado = await tenant.runComoUsuario(
      { clinicaId: B, psicologoId: psiA.psicologoId },
      (tx) => tx.auditoria.findMany(),
    );
    expect(cruzado).toEqual([]);
  });
});

describe('Auditoria: escrita', () => {
  it('INSERT com psicologoId alheio (colega, ADMIN ou outra clinica) e recusado pela policy', async () => {
    await expect(registrar(psiA, adminA)).rejects.toThrow(/row-level security/);
    await expect(registrar(adminA, psiA)).rejects.toThrow(/row-level security/);
    await expect(registrar(psiA, psiB)).rejects.toThrow();
    // clinicaId alheio com o proprio psicologoId
    await expect(
      registrar(psiA, { clinicaId: B, psicologoId: psiA.psicologoId }),
    ).rejects.toThrow();
    expect(await ver(psiA)).toHaveLength(1);
  });

  it('INSERT sem contexto e recusado (nao grava em nome de ninguem)', async () => {
    await expect(
      app.$executeRaw`INSERT INTO "Auditoria" (id, "clinicaId", "psicologoId", acao, recurso) VALUES (${randomUUID()}, ${psiA.clinicaId}, ${psiA.psicologoId}, 'LEU', 'Paciente')`,
    ).rejects.toThrow(/row-level security/);
  });

  it('psicologoId inexistente: erro de FK; recursoId qualquer (sem FK) e aceito', async () => {
    await expect(
      tenant.runComoUsuario({ clinicaId: A, psicologoId: randomUUID() }, (tx) =>
        tx.auditoria.create({
          data: {
            clinicaId: A,
            psicologoId: randomUUID(),
            acao: 'LEU',
            recurso: 'Paciente',
          },
        }),
      ),
    ).rejects.toThrow();
    await registrar(psiA); // recursoId aleatorio, sem paciente correspondente
    expect(await ver(psiA)).toHaveLength(2);
  });
});

describe('Auditoria: somente-acrescentar', () => {
  it('praxis_app: UPDATE, DELETE e TRUNCATE = permission denied (mesmo com o desvio de teste ligado)', async () => {
    const desvio = (u: U, texto: string) =>
      tenant.runComoUsuario(u, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.limpeza_de_teste', '1', true)`;
        return tx.$executeRawUnsafe(texto);
      });
    await expect(
      sql(psiA, `UPDATE "Auditoria" SET acao = 'LEU'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sql(psiA, `UPDATE "Auditoria" SET "psicologoId" = "psicologoId"`),
    ).rejects.toThrow(/permission denied/);
    await expect(sql(psiA, `DELETE FROM "Auditoria"`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(sql(psiA, `TRUNCATE "Auditoria"`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(desvio(psiA, `DELETE FROM "Auditoria"`)).rejects.toThrow(
      /permission denied/,
    );
    expect(await ver(psiA)).toHaveLength(2);
  });

  it('trigger barra UPDATE e DELETE ate para o praxis_owner (dono)', async () => {
    await expect(
      sqlDono(psiA, `UPDATE "Auditoria" SET acao = 'EDITOU'`),
    ).rejects.toThrow(/somente-acrescentar/);
    await expect(sqlDono(psiA, `DELETE FROM "Auditoria"`)).rejects.toThrow(
      /somente-acrescentar/,
    );
    // o desvio so vale com `app.limpeza_de_teste = 1` na transacao: sem ele, barrado
    await expect(
      comoOwner(
        psiA.clinicaId,
        (tx) =>
          tx.auditoria.deleteMany({ where: { psicologoId: psiA.psicologoId } }),
        { psicologoId: psiA.psicologoId },
      ),
    ).rejects.toThrow(/somente-acrescentar/);
    // o desvio NAO libera UPDATE
    await expect(
      comoOwner(
        psiA.clinicaId,
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.limpeza_de_teste', '1', true)`;
          return tx.$executeRawUnsafe(`UPDATE "Auditoria" SET acao = 'EDITOU'`);
        },
        { psicologoId: psiA.psicologoId },
      ),
    ).rejects.toThrow(/somente-acrescentar/);
    expect(await ver(psiA)).toHaveLength(2);
  });

  it('trigger barra TRUNCATE ate para o dono (com lock_timeout)', async () => {
    await expect(ddl(owner, `TRUNCATE "Auditoria"`)).rejects.toThrow(
      /somente-acrescentar/,
    );
    expect(await ver(psiA)).toHaveLength(2);
    expect(await ver(psiB)).toHaveLength(1);
  });
});
