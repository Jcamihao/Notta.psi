import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Papel, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

// Mecanismo de acesso por psicologo (padrao das tabelas clinicas da Fase 2), Postgres real.
// A policy vem do docs/ACESSO.md (o mesmo bloco que a Fase 2 copia): doc e teste nao divergem.
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: teste de acesso exige o papel notta_owner (ver backend/README.md)',
  );
}

// Comandos SQL do bloco `marcador` do docs/ACESSO.md.
function blocoDoDoc(marcador: string) {
  const doc = readFileSync(join(__dirname, '../../docs/ACESSO.md'), 'utf8');
  const bloco = new RegExp(
    `${marcador}:inicio -->\\s*\`\`\`sql([\\s\\S]*?)\`\`\``,
  ).exec(doc);
  if (!bloco) throw new Error(`bloco ${marcador} sumiu do ACESSO.md`);
  return bloco[1]
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

const sqlDoDoc = (tabela = '_teste_acesso') =>
  blocoDoDoc('sql-psicologo-proprio').map((s) =>
    s.replaceAll('"MinhaTabela"', tabela),
  );
// FK filha -> pai do doc (Sessao -> Paciente) aplicada nas tabelas de teste.
const fkFilhaDoDoc = () =>
  blocoDoDoc('sql-fk-filha').map((s) =>
    s.replaceAll('Sessao', '_teste_filho').replaceAll('Paciente', '_teste_pai'),
  );

function comLimite1(url: string) {
  const u = new URL(url);
  u.searchParams.set('connection_limit', '1');
  return u.toString();
}

// connection_limit=1: toda consulta reusa a MESMA conexao (prova vazamento de contexto).
const app = new PrismaClient({
  datasources: { db: { url: comLimite1(process.env.DATABASE_URL!) } },
});
const owner = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_OWNER } },
});
const tenant = new TenantPrismaService(app as unknown as PrismaService);

const sufixo = randomUUID().slice(0, 8);
const A = randomUUID();
const B = randomUUID();
type U = { clinicaId: string; psicologoId: string };
let adminA: U; // ADMIN da clinica A
let psiA: U; // PSICOLOGO da clinica A (colega do admin)
let psiB: U; // PSICOLOGO da clinica B

type Linha = { id: string; texto: string };
const ler = (u: U) =>
  tenant.runComoUsuario(
    u,
    (tx) =>
      tx.$queryRaw<Linha[]>`SELECT id, texto FROM _teste_acesso ORDER BY texto`,
  );
const inserir = (
  tx: Prisma.TransactionClient,
  clinicaId: string,
  psicologoId: string,
  texto: string,
) =>
  tx.$executeRaw`INSERT INTO _teste_acesso (id, "clinicaId", "psicologoId", texto)
    VALUES (${randomUUID()}, ${clinicaId}, ${psicologoId}, ${texto})`;

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

beforeAll(async () => {
  await owner.$executeRawUnsafe('DROP TABLE IF EXISTS _teste_acesso');
  await owner.$executeRawUnsafe(`CREATE TABLE _teste_acesso (
    id text PRIMARY KEY,
    "clinicaId" text NOT NULL,
    "psicologoId" text NOT NULL,
    texto text NOT NULL,
    FOREIGN KEY ("psicologoId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId")
  )`);
  for (const sql of sqlDoDoc()) await owner.$executeRawUnsafe(sql);
  await owner.$executeRawUnsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON _teste_acesso TO notta_app',
  );

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

  await tenant.runComoUsuario(adminA, async (tx) => {
    await inserir(tx, A, adminA.psicologoId, 'admin-1');
    await inserir(tx, A, adminA.psicologoId, 'admin-2');
  });
  await tenant.runComoUsuario(psiA, (tx) =>
    inserir(tx, A, psiA.psicologoId, 'psi-a-1'),
  );
  await tenant.runComoUsuario(psiB, (tx) =>
    inserir(tx, B, psiB.psicologoId, 'psi-b-1'),
  );
});

afterAll(async () => {
  // Tabela de teste nao pode sobrar no banco. DROP antes (FK aponta para Psicologo).
  await owner.$executeRawUnsafe('DROP TABLE IF EXISTS _teste_acesso');
  for (const id of [A, B]) {
    await tenant.run(id, async (tx) => {
      await tx.psicologo.deleteMany({ where: { clinicaId: id } });
      await tx.clinica.deleteMany({ where: { id } });
    });
  }
  await app.$disconnect();
  await owner.$disconnect();
});

describe('policy psicologo_proprio (docs/ACESSO.md)', () => {
  it('a tabela de teste tem RLS FORCE e so a policy psicologo_proprio', async () => {
    const [t] = await owner.$queryRaw<
      { rls: boolean; force: boolean }[]
    >`SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class WHERE relname = '_teste_acesso'`;
    expect(t).toEqual({ rls: true, force: true });
    const policies = await owner.$queryRaw<
      { policyname: string }[]
    >`SELECT policyname FROM pg_policies WHERE tablename = '_teste_acesso'`;
    expect(policies).toEqual([{ policyname: 'psicologo_proprio' }]);
  });

  it('cada psicologo le so as proprias linhas', async () => {
    expect((await ler(adminA)).map((l) => l.texto)).toEqual([
      'admin-1',
      'admin-2',
    ]);
    expect((await ler(psiA)).map((l) => l.texto)).toEqual(['psi-a-1']);
    expect((await ler(psiB)).map((l) => l.texto)).toEqual(['psi-b-1']);
  });

  it('ADMIN nao le prontuario do colega (o papel nao conta no banco)', async () => {
    const doAdmin = await ler(adminA);
    expect(doAdmin.some((l) => l.texto.startsWith('psi-'))).toBe(false);
    const doColega = await ler(psiA);
    expect(doColega.some((l) => l.texto.startsWith('admin-'))).toBe(false);
  });

  it('so clinica no contexto (sem psicologoId) = zero linhas, sem erro', async () => {
    const linhas = await tenant.run(
      A,
      (tx) => tx.$queryRaw<Linha[]>`SELECT id FROM _teste_acesso`,
    );
    expect(linhas).toEqual([]);
  });

  it('sem contexto nenhum = zero linhas (notta_app e owner, por causa do FORCE)', async () => {
    expect(await app.$queryRaw<Linha[]>`SELECT id FROM _teste_acesso`).toEqual(
      [],
    );
    expect(
      await owner.$queryRaw<Linha[]>`SELECT id FROM _teste_acesso`,
    ).toEqual([]);
  });

  it('clinica diferente = zero (inclusive psicologoId de A com clinica B)', async () => {
    const misturado = { clinicaId: B, psicologoId: psiA.psicologoId };
    expect(await ler(misturado)).toEqual([]);
    const deB = await ler(psiB);
    expect(deB.some((l) => !l.texto.startsWith('psi-b'))).toBe(false);
  });

  it('WITH CHECK: INSERT com psicologoId de colega falha', async () => {
    await expect(
      tenant.runComoUsuario(adminA, (tx) =>
        inserir(tx, A, psiA.psicologoId, 'intrusa'),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('WITH CHECK: passar a propria linha para o colega falha', async () => {
    await expect(
      tenant.runComoUsuario(
        adminA,
        (tx) =>
          tx.$executeRaw`UPDATE _teste_acesso SET "psicologoId" = ${psiA.psicologoId} WHERE texto = 'admin-1'`,
      ),
    ).rejects.toThrow(/row-level security/);
    expect((await ler(adminA)).map((l) => l.texto)).toContain('admin-1');
  });

  it('UPDATE e DELETE de linha do colega afetam 0', async () => {
    const r = await tenant.runComoUsuario(adminA, async (tx) => ({
      upd: await tx.$executeRaw`UPDATE _teste_acesso SET texto = 'mexido' WHERE texto = 'psi-a-1'`,
      del: await tx.$executeRaw`DELETE FROM _teste_acesso WHERE texto = 'psi-a-1'`,
    }));
    expect(r).toEqual({ upd: 0, del: 0 });
    expect((await ler(psiA)).map((l) => l.texto)).toEqual(['psi-a-1']);
  });

  it('contexto nao vaza no pool (connection_limit=1): depois do run = zero', async () => {
    expect((await ler(adminA)).length).toBe(2);
    expect(await app.$queryRaw<Linha[]>`SELECT id FROM _teste_acesso`).toEqual(
      [],
    );
    const [g] = await app.$queryRaw<
      { v: string | null }[]
    >`SELECT current_setting('app.current_psicologo_id', true) AS v`;
    expect(g.v ?? '').toBe('');
  });
});

describe('FK de tabela filha inclui o dono (docs/ACESSO.md, bloco sql-fk-filha)', () => {
  let paiAdmin: string;
  let paiPsi: string;

  const criarPai = (u: U) =>
    tenant.runComoUsuario(u, async (tx) => {
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO _teste_pai (id, "clinicaId", "psicologoId")
        VALUES (${id}, ${u.clinicaId}, ${u.psicologoId})`;
      return id;
    });
  // Filha gravada no contexto de `u`, com o proprio psicologoId (passa no WITH CHECK).
  const criarFilha = (u: U, pacienteId: string) =>
    tenant.runComoUsuario(
      u,
      (
        tx,
      ) => tx.$executeRaw`INSERT INTO _teste_filho (id, "pacienteId", "clinicaId", "psicologoId")
        VALUES (${randomUUID()}, ${pacienteId}, ${u.clinicaId}, ${u.psicologoId})`,
    );
  const erroDe = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('era para falhar');
  };
  const contar = async (u: U, tabela: '_teste_pai' | '_teste_filho') =>
    (
      await tenant.runComoUsuario(u, (tx) =>
        tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM ${tabela}`),
      )
    ).length;

  beforeAll(async () => {
    await owner.$executeRawUnsafe('DROP TABLE IF EXISTS _teste_filho');
    await owner.$executeRawUnsafe('DROP TABLE IF EXISTS _teste_pai');
    await owner.$executeRawUnsafe(`CREATE TABLE _teste_pai (
      id text PRIMARY KEY,
      "clinicaId" text NOT NULL,
      "psicologoId" text NOT NULL,
      FOREIGN KEY ("psicologoId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId"),
      UNIQUE (id, "psicologoId", "clinicaId")
    )`);
    await owner.$executeRawUnsafe(`CREATE TABLE _teste_filho (
      id text PRIMARY KEY,
      "pacienteId" text NOT NULL,
      "clinicaId" text NOT NULL,
      "psicologoId" text NOT NULL,
      FOREIGN KEY ("psicologoId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId")
    )`);
    for (const sql of [
      ...sqlDoDoc('_teste_pai'),
      ...sqlDoDoc('_teste_filho'),
      ...fkFilhaDoDoc(),
    ]) {
      await owner.$executeRawUnsafe(sql);
    }
    await owner.$executeRawUnsafe(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON _teste_pai, _teste_filho TO notta_app',
    );
    paiAdmin = await criarPai(adminA);
    paiPsi = await criarPai(psiA);
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe('DROP TABLE IF EXISTS _teste_filho');
    await owner.$executeRawUnsafe('DROP TABLE IF EXISTS _teste_pai');
  });

  it('colega da mesma clinica nao grava filha apontando para o pai de outro psicologo', async () => {
    expect(await contar(psiA, '_teste_pai')).toBe(1); // ve so o proprio pai
    const msg = await erroDe(criarFilha(psiA, paiAdmin));
    expect(msg).toMatch(/foreign key/);
    expect(await contar(adminA, '_teste_filho')).toBe(0);
    expect(await contar(psiA, '_teste_filho')).toBe(0);
  });

  it('sem oraculo: pai alheio e pai inexistente dao o mesmo erro', async () => {
    const inexistente = randomUUID();
    const alheio = await erroDe(criarFilha(psiA, paiAdmin));
    const nada = await erroDe(criarFilha(psiA, inexistente));
    expect(alheio.replaceAll(paiAdmin, 'ID')).toBe(
      nada.replaceAll(inexistente, 'ID'),
    );
  });

  it('filha do proprio pai funciona', async () => {
    expect(await criarFilha(psiA, paiPsi)).toBe(1);
    expect(await contar(psiA, '_teste_filho')).toBe(1);
  });

  it('RESTRICT: apagar o proprio pai com filha falha e nao toca linhas de outro dono', async () => {
    await criarFilha(adminA, paiAdmin);
    const antes = {
      paiPsi: await contar(psiA, '_teste_pai'),
      filhaPsi: await contar(psiA, '_teste_filho'),
    };
    const msg = await erroDe(
      tenant.runComoUsuario(
        adminA,
        (tx) => tx.$executeRaw`DELETE FROM _teste_pai WHERE id = ${paiAdmin}`,
      ),
    );
    expect(msg).toMatch(/foreign key/);
    expect(await contar(adminA, '_teste_pai')).toBe(1);
    expect(await contar(adminA, '_teste_filho')).toBe(1);
    expect({
      paiPsi: await contar(psiA, '_teste_pai'),
      filhaPsi: await contar(psiA, '_teste_filho'),
    }).toEqual(antes);
    const [fk] = await owner.$queryRaw<{ del: string }[]>`
      SELECT confdeltype AS del FROM pg_constraint
      WHERE conrelid = '_teste_filho'::regclass AND confrelid = '_teste_pai'::regclass`;
    expect(fk.del).toBe('r');
  });
});
