import { randomUUID } from 'node:crypto';
import { Papel, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner, mudarPapelComoOwner } from './acesso-owner';

// Item 58, camada do banco: policy psicologo_desativar_colega + trigger psicologo_barreira_update
// (Postgres real). Quem desativa quem, e o que NUNCA acontece (reativar, mudar o proprio
// `ativo`, mexer em outra coluna do alvo).
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: este teste usa o papel praxis_owner (ver backend/README.md)',
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
let adminB: U;

async function criar(
  clinicaId: string,
  nome: string,
  papel: Papel,
): Promise<U> {
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

// Colega novo por teste (cada teste desativa o seu).
const colega = (nome = `c-${randomUUID().slice(0, 8)}`) =>
  criar(A, nome, 'PSICOLOGO');

// UPDATE em `alvo` no contexto de `quem`.
const mexer = (
  quem: U,
  alvo: U,
  data: Prisma.PsicologoUncheckedUpdateManyInput,
) =>
  tenant.runComoUsuario(quem, (tx) =>
    tx.psicologo.updateMany({
      where: { id: alvo.psicologoId, clinicaId: alvo.clinicaId },
      data,
    }),
  );

const desativar = (quem: U, alvo: U) =>
  mexer(quem, alvo, { ativo: false, desativadoEm: new Date() });

const linha = (u: U) =>
  tenant.run(u.clinicaId, (tx) =>
    tx.psicologo.findFirstOrThrow({ where: { id: u.psicologoId } }),
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
  adminA = await criar(A, 'admin-a', 'ADMIN');
  adminB = await criar(B, 'admin-b', 'ADMIN');
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('estrutura (item 58)', () => {
  it('colunas, CHECK, grants por coluna, policy e trigger', async () => {
    const cols = await owner.$queryRaw<{ column_name: string; d: string }[]>`
      SELECT column_name, column_default AS d FROM information_schema.columns
      WHERE table_name = 'Psicologo' AND column_name IN ('ativo', 'desativadoEm')
      ORDER BY column_name`;
    expect(cols).toEqual([
      { column_name: 'ativo', d: 'true' },
      { column_name: 'desativadoEm', d: null },
    ]);
    const [chk] = await owner.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = '"Psicologo"'::regclass AND conname = 'Psicologo_ativo_desativadoEm_check'`;
    expect(chk.def).toContain('ativo = false');
    const grants = await owner.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.column_privileges
      WHERE table_name = 'Psicologo' AND grantee = 'praxis_app' AND privilege_type = 'UPDATE'
      ORDER BY column_name`;
    expect(grants.map((g) => g.column_name)).toEqual([
      'abordagemPadrao',
      'ativo',
      'desativadoEm',
      'nome',
      'senhaHash',
      'senhaProvisoria',
      'tokenVersao',
    ]);
    // Policy: ADMIN ativo da clinica, alvo PSICOLOGO ativo que nao e o ator; depois, desativado.
    const [pol] = await owner.$queryRaw<{ qual: string; chk: string }[]>`
      SELECT qual, with_check AS chk FROM pg_policies
      WHERE tablename = 'Psicologo' AND policyname = 'psicologo_desativar_colega'`;
    for (const t of [pol.qual, pol.chk]) {
      expect(t).toContain(`papel = 'PSICOLOGO'`);
      expect(t).toMatch(
        /id <> NULLIF\(current_setting\('app.current_psicologo_id'/,
      );
      expect(t).toContain(`ator.papel = 'ADMIN'`);
      expect(t).toContain('ator.ativo');
    }
    expect(pol.chk).toContain('NOT ativo');
    expect(pol.qual).toMatch(/AND ativo AND/);
  });
});

describe('ADMIN desativa colega', () => {
  it('ADMIN ativo desativa colega ativo: 1 linha, ativo=false, desativadoEm preenchido, resto igual', async () => {
    const c = await colega();
    const antes = await linha(c);
    expect(antes).toMatchObject({ ativo: true, desativadoEm: null });
    expect(await desativar(adminA, c)).toEqual({ count: 1 });
    const depois = await linha(c);
    expect(depois.ativo).toBe(false);
    expect(depois.desativadoEm).toBeInstanceOf(Date);
    expect({ ...depois, ativo: true, desativadoEm: null }).toEqual(antes);
  });

  it('colega (PSICOLOGO) nao desativa outro colega nem o ADMIN (0 linhas)', async () => {
    const autor = await colega();
    const alvo = await colega();
    expect(await desativar(autor, alvo)).toEqual({ count: 0 });
    expect(await desativar(autor, adminA)).toEqual({ count: 0 });
    expect(await linha(alvo)).toMatchObject({ ativo: true });
    expect(await linha(adminA)).toMatchObject({ ativo: true });
  });

  it('ADMIN nao desativa outro ADMIN (0 linhas)', async () => {
    const outro = await colega();
    await mudarPapelComoOwner(A, outro.psicologoId, 'ADMIN');
    expect(await desativar(adminA, outro)).toEqual({ count: 0 });
    expect(await linha(outro)).toMatchObject({ ativo: true, papel: 'ADMIN' });
  });

  it('ADMIN de OUTRA clinica nao desativa (0 linhas, nem com a clinica certa no WHERE)', async () => {
    const alvo = await colega();
    expect(await desativar(adminB, alvo)).toEqual({ count: 0 });
    const misturado = await tenant.runComoUsuario(
      { clinicaId: A, psicologoId: adminB.psicologoId },
      (tx) =>
        tx.psicologo.updateMany({
          where: { id: alvo.psicologoId },
          data: { ativo: false, desativadoEm: new Date() },
        }),
    );
    expect(misturado).toEqual({ count: 0 });
    expect(await linha(alvo)).toMatchObject({ ativo: true });
  });

  it('sem psicologoId no contexto (so clinica): 0 linhas', async () => {
    const alvo = await colega();
    const r = await tenant.run(A, (tx) =>
      tx.psicologo.updateMany({
        where: { id: alvo.psicologoId },
        data: { ativo: false, desativadoEm: new Date() },
      }),
    );
    expect(r).toEqual({ count: 0 });
  });

  it('ADMIN que ja esta desativado nao desativa ninguem (0 linhas)', async () => {
    const velho = await colega();
    // Papel so muda pelo dono: vira PSICOLOGO, o ADMIN desativa, volta a ADMIN.
    await mudarPapelComoOwner(A, velho.psicologoId, 'ADMIN');
    await mudarPapelComoOwner(A, velho.psicologoId, 'PSICOLOGO');
    expect(await desativar(adminA, velho)).toEqual({ count: 1 });
    await mudarPapelComoOwner(A, velho.psicologoId, 'ADMIN');
    const alvo = await colega();
    expect(await desativar(velho, alvo)).toEqual({ count: 0 });
    expect(await linha(alvo)).toMatchObject({ ativo: true });
  });

  it('ativo=false sem desativadoEm (e a data sem desativar) = barrado pelo trigger; CHECK barra o INSERT com data', async () => {
    const a = await colega();
    await expect(mexer(adminA, a, { ativo: false })).rejects.toThrow(
      /nunca reativa/,
    );
    const b = await colega();
    await expect(
      mexer(adminA, b, { desativadoEm: new Date() }),
    ).rejects.toThrow(/nunca reativa/);
    expect(await linha(a)).toMatchObject({ ativo: true, desativadoEm: null });
    expect(await linha(b)).toMatchObject({ ativo: true, desativadoEm: null });
    await expect(
      tenant.run(A, (tx) =>
        tx.psicologo.create({
          data: {
            clinicaId: A,
            nome: 'ativo-com-data',
            email: `ativo-data-${sufixo}@teste.local`,
            senhaHash: 'x',
            abordagemPadrao: 'TCC',
            senhaProvisoria: true,
            desativadoEm: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/Psicologo_ativo_desativadoEm_check/);
  });

  it('INSERT ja desativado e barrado (colega novo nasce ativo)', async () => {
    await expect(
      tenant.run(A, (tx) =>
        tx.psicologo.create({
          data: {
            clinicaId: A,
            nome: 'nasce-morto',
            email: `morto-${sufixo}@teste.local`,
            senhaHash: 'x',
            abordagemPadrao: 'TCC',
            senhaProvisoria: true,
            ativo: false,
            desativadoEm: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('nunca reativa; ninguem muda o proprio ativo', () => {
  it('ADMIN nao reativa colega desativado (0 linhas)', async () => {
    const c = await colega();
    await desativar(adminA, c);
    expect(await mexer(adminA, c, { ativo: true, desativadoEm: null })).toEqual(
      { count: 0 },
    );
    expect((await linha(c)).ativo).toBe(false);
  });

  it('o proprio desativado nao se reativa: trigger "nunca reativa"', async () => {
    const c = await colega();
    await desativar(adminA, c);
    await expect(
      mexer(c, c, { ativo: true, desativadoEm: null }),
    ).rejects.toThrow(/nunca reativa/);
    expect((await linha(c)).ativo).toBe(false);
  });

  it('nem o dono do banco reativa (policy e trigger valem para ele)', async () => {
    const c = await colega();
    await desativar(adminA, c);
    const reativar = (psicologoId: string) =>
      comoOwner(
        A,
        (tx) =>
          tx.psicologo.updateMany({
            where: { id: c.psicologoId, clinicaId: A },
            data: { ativo: true, desativadoEm: null },
          }),
        { psicologoId },
      );
    // Como o ADMIN no contexto: a policy so enxerga alvo ativo (0 linhas).
    expect(await reativar(adminA.psicologoId)).toEqual({ count: 0 });
    // Como o proprio no contexto: a linha e visivel, quem barra e o trigger.
    await expect(reativar(c.psicologoId)).rejects.toThrow(/nunca reativa/);
    expect((await linha(c)).ativo).toBe(false);
  });

  it('desativado nao muda desativadoEm (data fica a da desativacao)', async () => {
    const c = await colega();
    await desativar(adminA, c);
    const { desativadoEm } = await linha(c);
    await expect(mexer(c, c, { desativadoEm: new Date(0) })).rejects.toThrow(
      /nunca reativa/,
    );
    expect((await linha(c)).desativadoEm).toEqual(desativadoEm);
  });

  it('colega nao desativa a si mesmo (trigger "proprio ativo")', async () => {
    const c = await colega();
    await expect(desativar(c, c)).rejects.toThrow(/proprio ativo/);
    expect(await linha(c)).toMatchObject({ ativo: true });
  });

  it('ADMIN nao desativa a si mesmo', async () => {
    // 2o ADMIN nao nasce por INSERT: o dono promove um colega.
    const admin = await colega();
    await mudarPapelComoOwner(A, admin.psicologoId, 'ADMIN');
    await expect(desativar(admin, admin)).rejects.toThrow(/proprio ativo/);
    expect(await linha(admin)).toMatchObject({ ativo: true });
  });
});

describe('ADMIN nao mexe em mais nada do alvo', () => {
  it.each<[string, Prisma.PsicologoUncheckedUpdateManyInput]>([
    ['papel', { papel: 'ADMIN' }],
    ['email', { email: `outro-${sufixo}@teste.local` }],
    ['clinicaId', { clinicaId: B }],
  ])('coluna imutavel para o app: %s = permission denied', async (_n, data) => {
    const c = await colega();
    await expect(mexer(adminA, c, data)).rejects.toThrow(/permission denied/);
    expect(await linha(c)).toMatchObject({ papel: 'PSICOLOGO', clinicaId: A });
  });

  it.each<[string, Prisma.PsicologoUncheckedUpdateManyInput]>([
    ['senhaHash', { senhaHash: 'do-admin' }],
    ['nome', { nome: 'renomeado' }],
    ['abordagemPadrao', { abordagemPadrao: 'ACT' }],
    ['senhaProvisoria + senhaHash', { senhaHash: 'z', senhaProvisoria: false }],
    [
      'tokenVersao + senhaHash',
      { senhaHash: 'z', tokenVersao: { increment: 1 } },
    ],
    [
      'senhaHash junto com a desativacao',
      { senhaHash: 'do-admin', ativo: false, desativadoEm: new Date() },
    ],
  ])(
    '%s do colega = barrado (so ativo e desativadoEm mudam)',
    async (_n, data) => {
      const c = await colega();
      const antes = await linha(c);
      await expect(mexer(adminA, c, data)).rejects.toThrow(
        /senhaProvisoria|tokenVersao|so ativo e desativadoEm mudam/,
      );
      expect(await linha(c)).toEqual(antes);
    },
  );
});
