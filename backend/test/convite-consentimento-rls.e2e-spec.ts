import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Papel, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner } from './acesso-owner';

// RLS, privilegios, FK, CHECK e trigger de "ConviteConsentimento" (item 22) e as colunas novas de
// "Consentimento" (origem, conviteId) no Postgres real. Inclui a policy publica convite_por_token.
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
const pacienteDe: Record<string, string> = {};

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const novoHash = () => sha(randomBytes(32).toString('base64url'));
const MAIS_7_DIAS = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

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

// Cria como `u`, com o dono/paciente/hash que o teste quiser (para provar o que o banco recusa).
const criarConvite = (
  u: U,
  alvo: {
    dono?: U;
    pacienteId: string;
    tokenHash?: string;
    estado?: string;
    expiraEm?: Date;
  },
) =>
  tenant.runComoUsuario(u, async (tx) => {
    const dono = alvo.dono ?? u;
    const c = await tx.conviteConsentimento.create({
      data: {
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        pacienteId: alvo.pacienteId,
        tokenHash: alvo.tokenHash ?? novoHash(),
        termoVersao: 'v-teste',
        expiraEm: alvo.expiraEm ?? MAIS_7_DIAS(),
        ...(alvo.estado ? { estado: alvo.estado } : {}),
      },
    });
    return c.id;
  });

const ver = (u: U) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.conviteConsentimento.findMany({ select: { id: true } }),
  );

const sql = (u: U, texto: string) =>
  tenant.runComoUsuario(u, (tx) => tx.$executeRawUnsafe(texto));

// Como praxis_owner (dono), com o contexto do usuario.
const sqlDono = (u: U, texto: string) =>
  comoOwner(u.clinicaId, (tx) => tx.$executeRawUnsafe(texto), {
    psicologoId: u.psicologoId,
  });

// Fluxo publico: so o hash no contexto (sem clinica nem psicologo).
const comHash = <T>(
  hash: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) => tenant.runConvite(hash, (tx) => fn(tx));

const mudar = (hash: string, estado: string) =>
  comHash(hash, (tx) =>
    tx.conviteConsentimento.updateMany({
      where: { tokenHash: hash },
      data: { estado, usadoEm: new Date() },
    }),
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
  adminA = await criarPsicologo(A, 'conv-admin-a', 'ADMIN');
  psiA = await criarPsicologo(A, 'conv-psi-a', 'PSICOLOGO');
  psiB = await criarPsicologo(B, 'conv-psi-b', 'PSICOLOGO');
  pacienteDe.adminA = await novoPaciente(adminA);
  pacienteDe.psiA = await novoPaciente(psiA);
  pacienteDe.psiB = await novoPaciente(psiB);
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('ConviteConsentimento: estrutura no banco', () => {
  it('RLS ENABLE + FORCE, policies esperadas, trigger, sem FK em cascade', async () => {
    const [t] = await owner.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'ConviteConsentimento'`;
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.$queryRaw<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE tablename = 'ConviteConsentimento' ORDER BY policyname`;
    expect(p.map((x) => x.policyname)).toEqual([
      'convite_cancelar_proprio',
      'convite_dono_delete',
      'convite_dono_update',
      'convite_insert_proprio',
      'convite_por_token_select',
      'convite_por_token_update',
      'convite_select_proprio',
      'convite_transferir_select',
    ]);
    const g = await owner.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = '"ConviteConsentimento"'::regclass AND NOT tgisinternal ORDER BY tgname`;
    // 20261110120000: + trigger de insert para paciente excluido (item 26).
    expect(g.map((x) => x.tgname)).toEqual([
      'convite_consentimento_barreira',
      'convite_paciente_excluido',
    ]);
    const c = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid IN ('"ConviteConsentimento"'::regclass, '"Consentimento"'::regclass)
        AND contype = 'f' AND confdeltype = 'c'`;
    expect(c).toEqual([]);
  });

  it('CHECKs (estado, usadoEm, formato do hash) e indice unico parcial existem', async () => {
    const k = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"ConviteConsentimento"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(k.map((x) => x.conname)).toEqual([
      'ConviteConsentimento_estado_check',
      'ConviteConsentimento_tokenHash_check',
      'ConviteConsentimento_usadoEm_check',
    ]);
    const u = await owner.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'ConviteConsentimento_um_pendente_por_paciente'`;
    expect(u).toHaveLength(1);
    expect(u[0].indexdef).toContain('("pacienteId", "psicologoId")');
    expect(u[0].indexdef).toContain(`'PENDENTE'`);
  });

  it('praxis_app: SELECT e INSERT; UPDATE so em estado e usadoEm; sem DELETE nem TRUNCATE', async () => {
    const [g] = await owner.$queryRaw<Record<string, boolean>[]>`
      SELECT
        has_table_privilege('praxis_app', '"ConviteConsentimento"', 'SELECT') AS sel,
        has_table_privilege('praxis_app', '"ConviteConsentimento"', 'INSERT') AS ins,
        has_table_privilege('praxis_app', '"ConviteConsentimento"', 'UPDATE') AS upd,
        has_table_privilege('praxis_app', '"ConviteConsentimento"', 'DELETE') AS del,
        has_table_privilege('praxis_app', '"ConviteConsentimento"', 'TRUNCATE') AS trunc,
        has_table_privilege('praxis_app', '"ConviteConsentimento"', 'TRIGGER') AS trg`;
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
      WHERE table_name = 'ConviteConsentimento' AND grantee = 'praxis_app' AND privilege_type = 'UPDATE'
      ORDER BY column_name`;
    expect(cols.map((c) => c.column_name)).toEqual(['estado', 'usadoEm']);
  });

  it('Consentimento: policy restritiva de origem, CHECKs e unique do convite existem', async () => {
    const p = await owner.$queryRaw<
      { policyname: string; permissive: string }[]
    >`
      SELECT policyname, permissive FROM pg_policies
      WHERE tablename = 'Consentimento' AND policyname = 'consentimento_origem_paciente'`;
    expect(p).toEqual([
      {
        policyname: 'consentimento_origem_paciente',
        permissive: 'RESTRICTIVE',
      },
    ]);
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
});

describe('ConviteConsentimento: leitura e escrita isoladas por psicologo', () => {
  let conviteAdminA: string;
  let convitePsiA: string;
  let convitePsiB: string;

  beforeAll(async () => {
    conviteAdminA = await criarConvite(adminA, {
      pacienteId: pacienteDe.adminA,
    });
    convitePsiA = await criarConvite(psiA, { pacienteId: pacienteDe.psiA });
    convitePsiB = await criarConvite(psiB, { pacienteId: pacienteDe.psiB });
  });

  it('sem contexto = ZERO linhas (nao erro, nao todas); so a clinica, sem psicologo: zero', async () => {
    expect(await app.$queryRaw`SELECT id FROM "ConviteConsentimento"`).toEqual(
      [],
    );
    expect(
      await tenant.run(A, (tx) =>
        tx.conviteConsentimento.findMany({ select: { id: true } }),
      ),
    ).toEqual([]);
  });

  it('cada um ve so o proprio; colega (inclusive ADMIN) e outra clinica veem zero do alheio', async () => {
    expect((await ver(psiA)).map((c) => c.id)).toEqual([convitePsiA]);
    expect((await ver(adminA)).map((c) => c.id)).toEqual([conviteAdminA]);
    expect((await ver(psiB)).map((c) => c.id)).toEqual([convitePsiB]);
  });

  it('INSERT com psicologoId alheio (colega, outra clinica) e recusado pela policy', async () => {
    await expect(
      criarConvite(psiA, { dono: adminA, pacienteId: pacienteDe.adminA }),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      criarConvite(psiA, { dono: psiB, pacienteId: pacienteDe.psiB }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('INSERT ja ACEITO e recusado (nasce PENDENTE)', async () => {
    await expect(
      criarConvite(psiA, { pacienteId: pacienteDe.psiA, estado: 'ACEITO' }),
    ).rejects.toThrow(/row-level security|check/i);
  });

  it('FK: paciente alheio e paciente inexistente dao o MESMO erro', async () => {
    const msg = async (pacienteId: string) =>
      criarConvite(psiA, { pacienteId }).then(
        () => 'sem erro',
        (e: Error) =>
          e.message
            .replace(/\s+/g, ' ')
            .match(/Foreign key constraint[^.]*/)?.[0] ?? e.message,
      );
    const alheio = await msg(pacienteDe.psiB);
    const inexistente = await msg(randomUUID());
    expect(alheio).toMatch(/Foreign key/i);
    expect(alheio).toBe(inexistente);
  });

  it('o token cru nao cabe no banco: so hex de SHA-256 (CHECK)', async () => {
    await expect(
      criarConvite(psiA, {
        pacienteId: pacienteDe.psiA,
        tokenHash: randomBytes(32).toString('base64url'),
      }),
    ).rejects.toThrow(/tokenHash_check|check constraint/i);
  });
});

describe('ConviteConsentimento: 1 PENDENTE por paciente (indice unico parcial)', () => {
  it('2o PENDENTE do mesmo paciente e barrado; depois de cancelar o 1o, outro entra', async () => {
    const p = await novoPaciente(psiA);
    const primeiro = await criarConvite(psiA, { pacienteId: p });
    await expect(criarConvite(psiA, { pacienteId: p })).rejects.toThrow(
      /Unique constraint|um_pendente/i,
    );
    await tenant.runComoUsuario(psiA, (tx) =>
      tx.conviteConsentimento.updateMany({
        where: { id: primeiro },
        data: { estado: 'CANCELADO', usadoEm: new Date() },
      }),
    );
    await expect(criarConvite(psiA, { pacienteId: p })).resolves.toBeDefined();
  });
});

describe('ConviteConsentimento: cancelar pelo psicologo', () => {
  it('PENDENTE -> CANCELADO ok; colega e outra clinica afetam 0; psicologo NAO marca ACEITO/RECUSADO', async () => {
    const p = await novoPaciente(psiA);
    const id = await criarConvite(psiA, { pacienteId: p });
    const agora = new Date();
    const upd = (u: U, estado: string) =>
      tenant.runComoUsuario(u, (tx) =>
        tx.conviteConsentimento.updateMany({
          where: { id },
          data: { estado, usadoEm: agora },
        }),
      );
    expect((await upd(adminA, 'CANCELADO')).count).toBe(0);
    expect((await upd(psiB, 'CANCELADO')).count).toBe(0);
    await expect(upd(psiA, 'ACEITO')).rejects.toThrow(/row-level security/i);
    await expect(upd(psiA, 'RECUSADO')).rejects.toThrow(/row-level security/i);
    expect((await upd(psiA, 'CANCELADO')).count).toBe(1);
    // final: o proprio psicologo nao mexe mais (USING exige PENDENTE)
    expect((await upd(psiA, 'CANCELADO')).count).toBe(0);
  });

  it('praxis_app nao altera outras colunas (expiraEm, tokenHash) nem apaga', async () => {
    const p = await novoPaciente(psiA);
    const id = await criarConvite(psiA, { pacienteId: p });
    await expect(
      sql(
        psiA,
        `UPDATE "ConviteConsentimento" SET "expiraEm" = now() WHERE id = '${id}'`,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      sql(
        psiA,
        `UPDATE "ConviteConsentimento" SET "tokenHash" = '${novoHash()}' WHERE id = '${id}'`,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      sql(psiA, `DELETE FROM "ConviteConsentimento"`),
    ).rejects.toThrow(/permission denied/i);
    await expect(sql(psiA, `TRUNCATE "ConviteConsentimento"`)).rejects.toThrow(
      /permission denied/i,
    );
    // nem com o desvio de limpeza de teste ligado (nao e dono, nao tem DELETE)
    await expect(
      tenant.runComoUsuario(psiA, async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.limpeza_de_teste', '1', true)`,
        );
        await tx.$executeRawUnsafe(`DELETE FROM "ConviteConsentimento"`);
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('ConviteConsentimento: policy publica convite_por_token', () => {
  let hash: string;
  let outroHash: string;
  let id: string;
  let outroId: string;

  beforeAll(async () => {
    const p1 = await novoPaciente(psiA);
    const p2 = await novoPaciente(psiB);
    hash = novoHash();
    outroHash = novoHash();
    id = await criarConvite(psiA, { pacienteId: p1, tokenHash: hash });
    outroId = await criarConvite(psiB, {
      pacienteId: p2,
      tokenHash: outroHash,
    });
  });

  it('com o hash enxerga SO a linha dele (sem clinica nem psicologo no contexto)', async () => {
    const r = await comHash(hash, (tx) =>
      tx.conviteConsentimento.findMany({ select: { id: true } }),
    );
    expect(r).toEqual([{ id }]);
    const r2 = await comHash(outroHash, (tx) =>
      tx.conviteConsentimento.findMany({ select: { id: true } }),
    );
    expect(r2).toEqual([{ id: outroId }]);
  });

  it('hash desconhecido = 0 linhas; nao vaza para a proxima transacao da mesma conexao', async () => {
    expect(
      await comHash(novoHash(), (tx) =>
        tx.conviteConsentimento.findMany({ select: { id: true } }),
      ),
    ).toEqual([]);
    expect(await app.$queryRaw`SELECT id FROM "ConviteConsentimento"`).toEqual(
      [],
    );
  });

  it('o hash NAO abre outras tabelas (Paciente, Consentimento, Documento)', async () => {
    const r = await comHash(hash, async (tx) => ({
      pacientes: await tx.paciente.count(),
      consentimentos: await tx.consentimento.count(),
      documentos: await tx.documento.count(),
    }));
    expect(r).toEqual({ pacientes: 0, consentimentos: 0, documentos: 0 });
  });

  it('com o hash so se muda PENDENTE -> ACEITO|RECUSADO: CANCELADO e outra linha nao', async () => {
    await expect(mudar(hash, 'CANCELADO')).rejects.toThrow(
      /row-level security/i,
    );
    await expect(mudar(hash, 'PENDENTE')).rejects.toThrow(
      /row-level security|barrado|invalida/i,
    );
    // hash errado: 0 linhas
    const r = await comHash(outroHash, (tx) =>
      tx.conviteConsentimento.updateMany({
        where: { id },
        data: { estado: 'ACEITO', usadoEm: new Date() },
      }),
    );
    expect(r.count).toBe(0);
  });

  it('PENDENTE -> ACEITO com o hash funciona uma vez; a 2a tentativa afeta 0 linhas', async () => {
    expect((await mudar(hash, 'ACEITO')).count).toBe(1);
    expect((await mudar(hash, 'ACEITO')).count).toBe(0);
    expect((await mudar(hash, 'RECUSADO')).count).toBe(0);
    const l = await tenant.runComoUsuario(psiA, (tx) =>
      tx.conviteConsentimento.findUniqueOrThrow({ where: { id } }),
    );
    expect(l.estado).toBe('ACEITO');
    expect(l.usadoEm).not.toBeNull();
  });

  it('o hash nao autoriza INSERT (nem DELETE) em ConviteConsentimento', async () => {
    const p = await novoPaciente(psiA);
    await expect(
      comHash(novoHash(), (tx) =>
        tx.conviteConsentimento.create({
          data: {
            clinicaId: A,
            psicologoId: psiA.psicologoId,
            pacienteId: p,
            tokenHash: novoHash(),
            termoVersao: 'v',
            expiraEm: MAIS_7_DIAS(),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      comHash(hash, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM "ConviteConsentimento"`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('ConviteConsentimento: trigger barra transicao invalida, identidade e estado final (dono inclusive)', () => {
  let pend: string;
  let aceito: string;
  let cancelado: string;
  let hashAceito: string;

  beforeAll(async () => {
    pend = await criarConvite(psiA, { pacienteId: await novoPaciente(psiA) });
    hashAceito = novoHash();
    aceito = await criarConvite(psiA, {
      pacienteId: await novoPaciente(psiA),
      tokenHash: hashAceito,
    });
    await mudar(hashAceito, 'ACEITO');
    cancelado = await criarConvite(psiA, {
      pacienteId: await novoPaciente(psiA),
    });
    await tenant.runComoUsuario(psiA, (tx) =>
      tx.conviteConsentimento.updateMany({
        where: { id: cancelado },
        data: { estado: 'CANCELADO', usadoEm: new Date() },
      }),
    );
  });

  it.each([
    ['ACEITO', 'CANCELADO'],
    ['ACEITO', 'RECUSADO'],
    ['ACEITO', 'PENDENTE'],
  ])(
    'estado final ACEITO -> %s e barrado, ate para o dono',
    async (_a, novo) => {
      await expect(
        sqlDono(
          psiA,
          `UPDATE "ConviteConsentimento" SET "estado" = '${novo}', "usadoEm" = now() WHERE id = '${aceito}'`,
        ),
      ).rejects.toThrow(/estado final e imutavel/);
    },
  );

  it('CANCELADO -> ACEITO e barrado, ate para o dono', async () => {
    await expect(
      sqlDono(
        psiA,
        `UPDATE "ConviteConsentimento" SET "estado" = 'ACEITO' WHERE id = '${cancelado}'`,
      ),
    ).rejects.toThrow(/estado final e imutavel/);
  });

  it('PENDENTE -> PENDENTE e barrado (transicao invalida), dono inclusive', async () => {
    await expect(
      sqlDono(
        psiA,
        `UPDATE "ConviteConsentimento" SET "usadoEm" = now() WHERE id = '${pend}'`,
      ),
    ).rejects.toThrow(/transicao de estado invalida/);
  });

  it('sair de PENDENTE sem usadoEm e barrado', async () => {
    await expect(
      sqlDono(
        psiA,
        `UPDATE "ConviteConsentimento" SET "estado" = 'ACEITO' WHERE id = '${pend}'`,
      ),
    ).rejects.toThrow(/usadoEm e obrigatorio/);
  });

  it.each([
    ['expiraEm', `now() + interval '30 days'`],
    ['tokenHash', `'${'a'.repeat(64)}'`],
    ['termoVersao', `'outra'`],
    ['criadoEm', `now() - interval '1 day'`],
    ['pacienteId', `'${randomUUID()}'`],
  ])(
    'identidade imutavel: %s nao muda nem para o dono (PENDENTE)',
    async (col, valor) => {
      await expect(
        sqlDono(
          psiA,
          `UPDATE "ConviteConsentimento" SET "${col}" = ${valor} WHERE id = '${pend}'`,
        ),
      ).rejects.toThrow(/identidade e imutavel/);
    },
  );
});

describe('Consentimento: origem PACIENTE so nasce no fluxo publico', () => {
  const evento = (
    pacienteId: string,
    extra: Record<string, unknown>,
    dono: U = psiA,
  ) => ({
    clinicaId: dono.clinicaId,
    psicologoId: dono.psicologoId,
    pacienteId,
    seq: 1,
    evento: 'CONCEDIDO',
    termoVersao: 'v',
    termoTexto: 't',
    ...extra,
  });

  it('registro manual: origem default PSICOLOGO, sem convite', async () => {
    const p = await novoPaciente(psiA);
    const l = await tenant.runComoUsuario(psiA, (tx) =>
      tx.consentimento.create({ data: evento(p, {}) }),
    );
    expect(l.origem).toBe('PSICOLOGO');
    expect(l.conviteId).toBeNull();
  });

  it('PACIENTE sem convite (policy) e convite sem PACIENTE (CHECK) sao recusados', async () => {
    const p = await novoPaciente(psiA);
    await expect(
      tenant.runComoUsuario(psiA, (tx) =>
        tx.consentimento.create({ data: evento(p, { origem: 'PACIENTE' }) }),
      ),
    ).rejects.toThrow(/row-level security|origem_convite_check/i);
    const c = await criarConvite(psiA, { pacienteId: p });
    await expect(
      tenant.runComoUsuario(psiA, (tx) =>
        tx.consentimento.create({ data: evento(p, { conviteId: c }) }),
      ),
    ).rejects.toThrow(/origem_convite_check|check constraint/i);
    await expect(
      tenant.runComoUsuario(psiA, (tx) =>
        tx.consentimento.create({ data: evento(p, { origem: 'OUTRA' }) }),
      ),
    ).rejects.toThrow(/origem_check|check constraint/i);
  });

  it('o psicologo NAO forja "aceito pelo paciente": convite PENDENTE, ACEITO sem o hash, ou REVOGADO sao recusados', async () => {
    const p = await novoPaciente(psiA);
    const hash = novoHash();
    const c = await criarConvite(psiA, { pacienteId: p, tokenHash: hash });
    const forjado = (extra: object = {}) =>
      tenant.runComoUsuario(psiA, (tx) =>
        tx.consentimento.create({
          data: evento(p, { origem: 'PACIENTE', conviteId: c, ...extra }),
        }),
      );
    // PENDENTE (e sem hash no contexto)
    await expect(forjado()).rejects.toThrow(/row-level security/i);
    // ACEITO, mas ainda sem o hash no contexto (so o fluxo publico o tem)
    await mudar(hash, 'ACEITO');
    await expect(forjado()).rejects.toThrow(/row-level security/i);
    // com o hash certo mas evento REVOGADO: recusado
    await expect(
      tenant.runConvite(hash, async (tx, assumir) => {
        await assumir(psiA);
        await tx.consentimento.create({
          data: evento(p, {
            origem: 'PACIENTE',
            conviteId: c,
            evento: 'REVOGADO',
          }),
        });
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('fluxo publico (hash certo + dono do convite + convite ACEITO): grava com origem PACIENTE; o 2o evento do mesmo convite colide', async () => {
    const p = await novoPaciente(psiA);
    const hash = novoHash();
    const c = await criarConvite(psiA, { pacienteId: p, tokenHash: hash });
    await mudar(hash, 'ACEITO');
    const gravar = (seq: number) =>
      tenant.runConvite(hash, async (tx, assumir) => {
        await assumir(psiA);
        return tx.consentimento.create({
          data: evento(p, { origem: 'PACIENTE', conviteId: c, seq }),
        });
      });
    const l = await gravar(1);
    expect(l).toMatchObject({ origem: 'PACIENTE', conviteId: c, seq: 1 });
    await expect(gravar(2)).rejects.toThrow(/Unique constraint/i);
    // o psicologo ve a linha como qualquer consentimento seu
    const ve = await tenant.runComoUsuario(psiA, (tx) =>
      tx.consentimento.findMany({ where: { pacienteId: p } }),
    );
    expect(ve).toHaveLength(1);
  });

  it('o hash de OUTRO convite nao serve: convite alheio e de outro paciente dao erro', async () => {
    const p = await novoPaciente(psiA);
    const p2 = await novoPaciente(psiA);
    const hash = novoHash();
    const hash2 = novoHash();
    await criarConvite(psiA, { pacienteId: p, tokenHash: hash });
    const c2 = await criarConvite(psiA, { pacienteId: p2, tokenHash: hash2 });
    await mudar(hash2, 'ACEITO');
    // convite do paciente p2 apontado para o paciente p: a FK composta nao casa
    await expect(
      tenant.runConvite(hash2, async (tx, assumir) => {
        await assumir(psiA);
        await tx.consentimento.create({
          data: evento(p, { origem: 'PACIENTE', conviteId: c2 }),
        });
      }),
    ).rejects.toThrow(/Foreign key|row-level security/i);
    // hash do convite de p (PENDENTE) com o conviteId de p2: policy recusa
    await expect(
      tenant.runConvite(hash, async (tx, assumir) => {
        await assumir(psiA);
        await tx.consentimento.create({
          data: evento(p2, { origem: 'PACIENTE', conviteId: c2 }),
        });
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('Consentimento continua somente-acrescentar: o dono nao altera a linha de origem PACIENTE', async () => {
    const p = await novoPaciente(psiA);
    const hash = novoHash();
    const c = await criarConvite(psiA, { pacienteId: p, tokenHash: hash });
    await mudar(hash, 'ACEITO');
    await tenant.runConvite(hash, async (tx, assumir) => {
      await assumir(psiA);
      await tx.consentimento.create({
        data: evento(p, { origem: 'PACIENTE', conviteId: c }),
      });
    });
    await expect(
      sqlDono(
        psiA,
        `UPDATE "Consentimento" SET "origem" = 'PSICOLOGO', "conviteId" = NULL WHERE "pacienteId" = '${p}'`,
      ),
    ).rejects.toThrow(/somente-acrescentar/);
    await expect(
      sqlDono(psiA, `DELETE FROM "Consentimento" WHERE "pacienteId" = '${p}'`),
    ).rejects.toThrow(/somente-acrescentar/);
    await expect(
      sql(psiA, `UPDATE "Consentimento" SET "origem" = 'PSICOLOGO'`),
    ).rejects.toThrow(/permission denied/i);
  });
});
