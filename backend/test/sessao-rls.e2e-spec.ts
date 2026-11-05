import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Papel, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner } from './acesso-owner';

// RLS, privilegios, FK, CHECK e trigger de "Sessao" (itens 46 e 49) no Postgres real, incluindo a
// policy da renovacao (sessao_por_hash). O fluxo HTTP esta em sessao.e2e-spec.ts.
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

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const novoHash = () => sha(randomBytes(32).toString('base64url'));
const DIA = 24 * 3600 * 1000;

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

// Cria como `u`, com o dono/hash/datas que o teste quiser (para provar o que o banco recusa).
const criarSessao = (
  u: U,
  alvo: {
    dono?: U;
    refreshHash?: string;
    familia?: string;
    criadoEm?: Date;
    absolutaAte?: Date;
    usadoEm?: Date;
    revogadaEm?: Date;
    motivoRevogacao?: string;
  } = {},
) =>
  tenant.runComoUsuario(u, async (tx) => {
    const dono = alvo.dono ?? u;
    const criadoEm = alvo.criadoEm ?? new Date();
    const s = await tx.sessao.create({
      data: {
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        familia: alvo.familia ?? randomUUID(),
        refreshHash: alvo.refreshHash ?? novoHash(),
        criadoEm,
        ultimoUsoEm: criadoEm,
        absolutaAte: alvo.absolutaAte ?? new Date(criadoEm.getTime() + 7 * DIA),
        usadoEm: alvo.usadoEm,
        revogadaEm: alvo.revogadaEm,
        motivoRevogacao: alvo.motivoRevogacao,
      },
    });
    return s.id;
  });

const ver = (u: U) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.sessao.findMany({ select: { id: true } }),
  );

const sql = (u: U, texto: string) =>
  tenant.runComoUsuario(u, (tx) => tx.$executeRawUnsafe(texto));

const sqlDono = (u: U, texto: string) =>
  comoOwner(u.clinicaId, (tx) => tx.$executeRawUnsafe(texto), {
    psicologoId: u.psicologoId,
  });

// Renovacao: so o hash no contexto (sem clinica nem psicologo).
const comHash = <T>(
  hash: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) => tenant.runRefresh(hash, (tx) => fn(tx));

beforeAll(async () => {
  for (const [id, nome] of [
    [A, 'A'],
    [B, 'B'],
  ]) {
    await tenant.run(id, (tx) =>
      tx.clinica.create({ data: { id, nome: `${nome}-${sufixo}` } }),
    );
  }
  adminA = await criarPsicologo(A, 'sess-admin-a', 'ADMIN');
  psiA = await criarPsicologo(A, 'sess-psi-a', 'PSICOLOGO');
  psiB = await criarPsicologo(B, 'sess-psi-b', 'PSICOLOGO');
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('Sessao: estrutura no banco', () => {
  it('RLS ENABLE + FORCE, policies esperadas, trigger, sem FK em cascade', async () => {
    const [t] = await owner.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Sessao'`;
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.$queryRaw<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE tablename = 'Sessao' ORDER BY policyname`;
    expect(p.map((x) => x.policyname)).toEqual([
      'sessao_dono_delete',
      'sessao_dono_update',
      'sessao_insert_proprio',
      'sessao_por_hash',
      'sessao_select_proprio',
      'sessao_update_proprio',
    ]);
    const g = await owner.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = '"Sessao"'::regclass AND NOT tgisinternal ORDER BY tgname`;
    expect(g.map((x) => x.tgname)).toEqual(['sessao_barreira']);
    const c = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"Sessao"'::regclass AND contype = 'f' AND confdeltype = 'c'`;
    expect(c).toEqual([]);
  });

  it('CHECKs (hash hex, motivo, par revogada/motivo, limite de 7 dias) e unique do hash existem', async () => {
    const k = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"Sessao"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(k.map((x) => x.conname)).toEqual([
      'Sessao_absoluta_check',
      'Sessao_motivo_check',
      'Sessao_refreshHash_check',
      'Sessao_revogada_motivo_check',
    ]);
    const u = await owner.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'Sessao_refreshHash_key'`;
    expect(u).toHaveLength(1);
    expect(u[0].indexdef).toContain('UNIQUE');
  });

  it('notta_app: SELECT e INSERT; UPDATE so em 4 colunas; sem DELETE nem TRUNCATE', async () => {
    const [g] = await owner.$queryRaw<Record<string, boolean>[]>`
      SELECT
        has_table_privilege('notta_app', '"Sessao"', 'SELECT') AS sel,
        has_table_privilege('notta_app', '"Sessao"', 'INSERT') AS ins,
        has_table_privilege('notta_app', '"Sessao"', 'UPDATE') AS upd,
        has_table_privilege('notta_app', '"Sessao"', 'DELETE') AS del,
        has_table_privilege('notta_app', '"Sessao"', 'TRUNCATE') AS trunc,
        has_table_privilege('notta_app', '"Sessao"', 'TRIGGER') AS trg`;
    expect(g).toEqual({
      sel: true,
      ins: true,
      upd: false,
      del: false,
      trunc: false,
      trg: false,
    });
    const cols = await owner.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.column_privileges
      WHERE table_name = 'Sessao' AND grantee = 'notta_app' AND privilege_type = 'UPDATE'
      ORDER BY column_name`;
    expect(cols.map((c) => c.column_name)).toEqual([
      'motivoRevogacao',
      'revogadaEm',
      'ultimoUsoEm',
      'usadoEm',
    ]);
  });
});

describe('Sessao: leitura e escrita isoladas por psicologo', () => {
  let sessaoAdminA: string;
  let sessaoPsiA: string;
  let sessaoPsiB: string;

  beforeAll(async () => {
    sessaoAdminA = await criarSessao(adminA);
    sessaoPsiA = await criarSessao(psiA);
    sessaoPsiB = await criarSessao(psiB);
  });

  it('sem contexto = ZERO linhas (nao erro, nao todas); so a clinica, sem psicologo: zero', async () => {
    expect(await app.$queryRaw`SELECT id FROM "Sessao"`).toEqual([]);
    expect(
      await tenant.run(A, (tx) => tx.sessao.findMany({ select: { id: true } })),
    ).toEqual([]);
  });

  it('cada um ve so a propria; colega (inclusive ADMIN) e outra clinica veem zero da alheia', async () => {
    expect((await ver(psiA)).map((c) => c.id)).toEqual([sessaoPsiA]);
    expect((await ver(adminA)).map((c) => c.id)).toEqual([sessaoAdminA]);
    expect((await ver(psiB)).map((c) => c.id)).toEqual([sessaoPsiB]);
  });

  it('INSERT com psicologoId alheio (colega, outra clinica) e recusado pela policy', async () => {
    await expect(criarSessao(psiA, { dono: adminA })).rejects.toThrow(
      /row-level security/i,
    );
    await expect(criarSessao(psiA, { dono: psiB })).rejects.toThrow(
      /row-level security/i,
    );
  });

  it('INSERT ja usada ou ja revogada e recusado (nasce ativa)', async () => {
    await expect(criarSessao(psiA, { usadoEm: new Date() })).rejects.toThrow(
      /row-level security/i,
    );
    await expect(
      criarSessao(psiA, { revogadaEm: new Date(), motivoRevogacao: 'SAIU' }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('FK: o par (psicologoId, clinicaId) tem de existir; clinica trocada e recusada', async () => {
    await expect(
      tenant.run(
        psiA.clinicaId,
        (tx) =>
          tx.sessao.create({
            data: {
              clinicaId: psiA.clinicaId,
              psicologoId: randomUUID(),
              familia: randomUUID(),
              refreshHash: novoHash(),
              criadoEm: new Date(),
              ultimoUsoEm: new Date(),
              absolutaAte: new Date(Date.now() + DIA),
            },
          }),
        { psicologoId: psiA.psicologoId },
      ),
    ).rejects.toThrow(/row-level security|Foreign key/i);
  });

  it('o refresh cru nao cabe no banco: so hex de SHA-256 (CHECK)', async () => {
    await expect(
      criarSessao(psiA, { refreshHash: randomBytes(32).toString('base64url') }),
    ).rejects.toThrow(/refreshHash_check|check constraint/i);
  });

  it('hash repetido e barrado (unique); motivo fora da lista e barrado; motivo sem revogacao e barrado', async () => {
    const hash = novoHash();
    await criarSessao(psiA, { refreshHash: hash });
    await expect(criarSessao(psiA, { refreshHash: hash })).rejects.toThrow(
      /Unique constraint/i,
    );
    const id = await criarSessao(psiA);
    await expect(
      sql(
        psiA,
        `UPDATE "Sessao" SET "revogadaEm" = now(), "motivoRevogacao" = 'QUALQUER' WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/Sessao_motivo_check/);
    await expect(
      sql(
        psiA,
        `UPDATE "Sessao" SET "motivoRevogacao" = 'SAIU' WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/Sessao_revogada_motivo_check/);
  });

  it('limite absoluto: prazo maior que 7 dias do criadoEm e barrado; 7 dias exatos passam', async () => {
    const criadoEm = new Date();
    await expect(
      criarSessao(psiA, {
        criadoEm,
        absolutaAte: new Date(criadoEm.getTime() + 7 * DIA + 1000),
      }),
    ).rejects.toThrow(/Sessao_absoluta_check|check constraint/i);
    await expect(
      criarSessao(psiA, {
        criadoEm,
        absolutaAte: new Date(criadoEm.getTime() + 7 * DIA),
      }),
    ).resolves.toBeDefined();
  });
});

describe('Sessao: sem DELETE e UPDATE so nas colunas permitidas (notta_app)', () => {
  it('DELETE e TRUNCATE do app = permission denied (nem com o desvio de limpeza)', async () => {
    const id = await criarSessao(psiA);
    await expect(
      tenant.runComoUsuario(psiA, async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.limpeza_de_teste', '1', true)`,
        );
        return tx.$executeRawUnsafe(
          `DELETE FROM "Sessao" WHERE "id" = '${id}'`,
        );
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(sql(psiA, `TRUNCATE "Sessao"`)).rejects.toThrow(
      /permission denied/i,
    );
    expect((await ver(psiA)).map((s) => s.id)).toContain(id);
  });

  it('UPDATE de identidade, hash e prazo pelo app = permission denied', async () => {
    const id = await criarSessao(psiA);
    for (const col of [
      `"familia" = '${randomUUID()}'`,
      `"refreshHash" = '${novoHash()}'`,
      `"absolutaAte" = now()`,
      `"criadoEm" = now()`,
      `"psicologoId" = '${adminA.psicologoId}'`,
    ]) {
      await expect(
        sql(psiA, `UPDATE "Sessao" SET ${col} WHERE "id" = '${id}'`),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('colega e outra clinica afetam 0 linhas ao revogar sessao alheia', async () => {
    const id = await criarSessao(psiA);
    const revogar = (u: U) =>
      tenant.runComoUsuario(u, (tx) =>
        tx.sessao.updateMany({
          where: { id },
          data: { revogadaEm: new Date(), motivoRevogacao: 'SAIU' },
        }),
      );
    expect((await revogar(adminA)).count).toBe(0);
    expect((await revogar(psiB)).count).toBe(0);
    expect((await revogar(psiA)).count).toBe(1);
  });
});

describe('Sessao: policy da renovacao (sessao_por_hash)', () => {
  it('so enxerga a linha do proprio hash; hash errado, vazio ou ausente = 0 linhas', async () => {
    const h1 = novoHash();
    const h2 = novoHash();
    const s1 = await criarSessao(psiA, { refreshHash: h1 });
    await criarSessao(psiB, { refreshHash: h2 });
    const ids = (await comHash(h1, (tx) => tx.sessao.findMany())).map(
      (s) => s.id,
    );
    expect(ids).toEqual([s1]);
    expect(await comHash(novoHash(), (tx) => tx.sessao.findMany())).toEqual([]);
    // sem hash: ZERO (nem erro, nem todas)
    expect(await app.$queryRaw`SELECT id FROM "Sessao"`).toEqual([]);
    // hash vazio no contexto nao casa com nada
    expect(
      await tenant.run(
        A,
        (tx) =>
          tx.$queryRaw`SELECT set_config('app.refresh_hash', '', true), (SELECT count(*) FROM "Sessao")::int AS n`,
      ),
    ).toEqual([{ set_config: '', n: 0 }]);
  });

  it('o hash NAO abre outras tabelas (Psicologo, Auditoria, Paciente)', async () => {
    const h = novoHash();
    await criarSessao(psiA, { refreshHash: h });
    const r = await comHash(h, async (tx) => ({
      psicologos: await tx.psicologo.count(),
      auditoria: await tx.auditoria.count(),
      pacientes: await tx.paciente.count(),
    }));
    expect(r).toEqual({ psicologos: 0, auditoria: 0, pacientes: 0 });
  });

  it('com o hash so SELECT: UPDATE e INSERT sem assumir o dono afetam 0 / sao recusados', async () => {
    const h = novoHash();
    const id = await criarSessao(psiA, { refreshHash: h });
    const r = await comHash(h, (tx) =>
      tx.sessao.updateMany({
        where: { id },
        data: { usadoEm: new Date() },
      }),
    );
    expect(r.count).toBe(0);
    await expect(
      comHash(h, (tx) =>
        tx.sessao.create({
          data: {
            clinicaId: psiA.clinicaId,
            psicologoId: psiA.psicologoId,
            familia: randomUUID(),
            refreshHash: novoHash(),
            criadoEm: new Date(),
            ultimoUsoEm: new Date(),
            absolutaAte: new Date(Date.now() + DIA),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('assumirDono com a clinica e o psicologo LIDOS DA LINHA: revoga a familia e cria a proxima', async () => {
    const h = novoHash();
    const familia = randomUUID();
    const s1 = await criarSessao(psiA, { refreshHash: h, familia });
    const s0 = await criarSessao(psiA, { familia });
    const r = await tenant.runRefresh(h, async (tx, assumirDono) => {
      const linha = await tx.sessao.findFirstOrThrow({
        where: { refreshHash: h },
      });
      await assumirDono(linha);
      const { count } = await tx.sessao.updateMany({
        where: { familia, revogadaEm: null },
        data: { revogadaEm: new Date(), motivoRevogacao: 'REUSO' },
      });
      return count;
    });
    expect(r).toBe(2);
    const linhas = await tenant.runComoUsuario(psiA, (tx) =>
      tx.sessao.findMany({ where: { familia }, select: { id: true } }),
    );
    expect(linhas.map((l) => l.id).sort()).toEqual([s0, s1].sort());
  });
});

describe('Sessao: trigger sessao_barreira (todos os papeis, o dono inclusive)', () => {
  it('revogada nao revive: nem voltar revogadaEm a NULL, nem mudar o motivo, nem ultimoUsoEm', async () => {
    const id = await criarSessao(psiA);
    await tenant.runComoUsuario(psiA, (tx) =>
      tx.sessao.updateMany({
        where: { id },
        data: { revogadaEm: new Date(), motivoRevogacao: 'SAIU' },
      }),
    );
    for (const set of [
      `"revogadaEm" = NULL, "motivoRevogacao" = NULL`,
      `"motivoRevogacao" = 'REUSO'`,
      `"ultimoUsoEm" = now()`,
      `"usadoEm" = now()`,
    ]) {
      await expect(
        sql(psiA, `UPDATE "Sessao" SET ${set} WHERE "id" = '${id}'`),
      ).rejects.toThrow(/revogada e final/);
      await expect(
        sqlDono(psiA, `UPDATE "Sessao" SET ${set} WHERE "id" = '${id}'`),
      ).rejects.toThrow(/revogada e final/);
    }
  });

  it('usada nao volta a valer (usadoEm nao vira NULL nem muda); pode ser revogada depois', async () => {
    const id = await criarSessao(psiA);
    await tenant.runComoUsuario(psiA, (tx) =>
      tx.sessao.updateMany({ where: { id }, data: { usadoEm: new Date() } }),
    );
    await expect(
      sql(psiA, `UPDATE "Sessao" SET "usadoEm" = NULL WHERE "id" = '${id}'`),
    ).rejects.toThrow(/nao volta a valer/);
    await expect(
      sqlDono(
        psiA,
        `UPDATE "Sessao" SET "usadoEm" = NULL WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/nao volta a valer/);
    await expect(
      sql(psiA, `UPDATE "Sessao" SET "usadoEm" = now() WHERE "id" = '${id}'`),
    ).rejects.toThrow(/nao volta a valer/);
    const r = await tenant.runComoUsuario(psiA, (tx) =>
      tx.sessao.updateMany({
        where: { id },
        data: { revogadaEm: new Date(), motivoRevogacao: 'REUSO' },
      }),
    );
    expect(r.count).toBe(1);
  });

  it('identidade e imutavel ate para o dono (id, clinica, psicologo, familia, hash, criadoEm, absolutaAte)', async () => {
    const id = await criarSessao(psiA);
    for (const set of [
      `"id" = '${randomUUID()}'`,
      `"familia" = '${randomUUID()}'`,
      `"refreshHash" = '${novoHash()}'`,
      `"criadoEm" = now() - interval '1 day'`,
      `"absolutaAte" = now() + interval '1 hour'`,
      `"psicologoId" = '${adminA.psicologoId}'`,
    ]) {
      await expect(
        sqlDono(psiA, `UPDATE "Sessao" SET ${set} WHERE "id" = '${id}'`),
      ).rejects.toThrow(/identidade e imutavel/);
    }
  });

  it('o dono ainda consegue mexer em ultimoUsoEm de sessao ativa (fixture de teste de ociosidade)', async () => {
    const id = await criarSessao(psiA);
    const r = await comoOwner(
      psiA.clinicaId,
      (tx) =>
        tx.sessao.updateMany({
          where: { id },
          data: { ultimoUsoEm: new Date(Date.now() - 2 * DIA) },
        }),
      { psicologoId: psiA.psicologoId },
    );
    expect(r.count).toBe(1);
  });
});
