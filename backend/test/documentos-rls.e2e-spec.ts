import { randomUUID } from 'node:crypto';
import { Papel, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner, ddl } from './acesso-owner';

// RLS, privilegios, FK, CHECK e trigger de imutabilidade de "Documento" (itens 12, 14, 15 e 44)
// no Postgres real, como notta_app e como notta_owner.
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
  it('RLS ENABLE + FORCE, policies separadas, sem FK em cascade, so SELECT e INSERT na tabela', async () => {
    const [t] = await owner.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Documento'`;
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.$queryRaw<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE tablename = 'Documento' ORDER BY policyname`;
    // psicologo_proprio (unica, do item 12) foi trocada: o WITH CHECK dela impedia aprovar.
    expect(p).toEqual([
      { policyname: 'documento_dono_delete' },
      { policyname: 'documento_dono_update' },
      { policyname: 'documento_insert_proprio' },
      { policyname: 'documento_select_proprio' },
      { policyname: 'documento_update_proprio' },
    ]);
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

  it('notta_app tem UPDATE so em 5 colunas, nenhum DELETE/TRUNCATE; triggers e CHECKs existem', async () => {
    const col = await owner.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.column_privileges
      WHERE table_name = 'Documento' AND grantee = 'notta_app' AND privilege_type = 'UPDATE'
      ORDER BY column_name`;
    expect(col.map((x) => x.column_name)).toEqual([
      'aprovadoEm',
      'atualizadoEm',
      'conteudoCifrado',
      'dataSessao',
      'status',
    ]);
    const [priv] = await owner.$queryRaw<{ del: boolean; trg: boolean }[]>`
      SELECT has_table_privilege('notta_app', '"Documento"', 'DELETE') AS del,
             has_table_privilege('notta_app', '"Documento"', 'TRIGGER') AS trg`;
    expect(priv).toEqual({ del: false, trg: false });
    const trg = await owner.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE tgrelid = '"Documento"'::regclass AND NOT tgisinternal ORDER BY tgname`;
    expect(trg).toEqual([
      { tgname: 'documento_barreira_linha' },
      { tgname: 'documento_barreira_truncate' },
    ]);
    const chk = await owner.$queryRaw<{ conname: string; def: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = '"Documento"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(chk.map((x) => x.conname)).toEqual([
      'Documento_aprovado_check',
      'Documento_status_check',
      'Documento_substitui_check',
      'Documento_tipo_check',
    ]);
    expect(chk[0].def).toMatch(/APROVADO.*aprovadoEm.*IS NOT NULL/);
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
    expect(c.map((x) => x.conname)).toEqual(
      expect.arrayContaining([
        'Documento_status_check',
        'Documento_tipo_check',
      ]),
    );
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

  it('notta_app: DELETE e TRUNCATE = permission denied (privilegio, nao so policy)', async () => {
    await expect(sql(psiA, `DELETE FROM "Documento"`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(sql(psiA, `TRUNCATE "Documento"`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('notta_app: colunas de identidade nao tem UPDATE (permission denied)', async () => {
    for (const col of [
      'id',
      'clinicaId',
      'psicologoId',
      'pacienteId',
      'tipo',
      'substituiId',
      'criadoEm',
    ]) {
      await expect(
        sql(psiA, `UPDATE "Documento" SET "${col}" = "${col}"`),
      ).rejects.toThrow(/permission denied/);
    }
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

// ---- Itens 14, 15 e 44: editar rascunho, aprovar e imutavel no banco ----
const sqlDono = (u: U, texto: string, desvio = false) =>
  comoOwner(
    u.clinicaId,
    async (tx) => {
      if (desvio)
        await tx.$executeRaw`SELECT set_config('app.limpeza_de_teste', '1', true)`;
      return tx.$executeRawUnsafe(texto);
    },
    { psicologoId: u.psicologoId },
  );

const estadoDe = (u: U, id: string) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.documento.findFirstOrThrow({
      where: { id },
      select: {
        status: true,
        aprovadoEm: true,
        conteudoCifrado: true,
        dataSessao: true,
        atualizadoEm: true,
      },
    }),
  );

// Rascunho novo do psicologo `u` (paciente dele) e, se pedido, ja aprovado por UPDATE do app.
async function novoDoc(
  u: U,
  pacienteId: string,
  opcoes: { aprovado?: boolean; substituiId?: string } = {},
) {
  const id = randomUUID();
  await tenant.runComoUsuario(u, async (tx) => {
    await tx.documento.create({
      data: {
        id,
        clinicaId: u.clinicaId,
        psicologoId: u.psicologoId,
        pacienteId,
        tipo: 'EVOLUCAO',
        conteudoCifrado: 'cifrado-original',
        dataSessao: new Date('2026-01-10'),
        substituiId: opcoes.substituiId ?? null,
      },
    });
    if (opcoes.aprovado)
      await tx.$executeRawUnsafe(
        `UPDATE "Documento" SET status = 'APROVADO', "aprovadoEm" = now() WHERE id = '${id}'`,
      );
  });
  return id;
}

describe('Documento: editar e aprovar pelo app', () => {
  it('app edita conteudo e data do RASCUNHO e o atualizadoEm anda', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA);
    const antes = await estadoDe(psiA, id);
    await sql(
      psiA,
      `UPDATE "Documento" SET "conteudoCifrado" = 'novo', "dataSessao" = NULL, "atualizadoEm" = now() + interval '1 second' WHERE id = '${id}'`,
    );
    const depois = await estadoDe(psiA, id);
    expect(depois.conteudoCifrado).toBe('novo');
    expect(depois.dataSessao).toBeNull();
    expect(depois.atualizadoEm.getTime()).toBeGreaterThan(
      antes.atualizadoEm.getTime(),
    );
  });

  it('app aprova o proprio rascunho (status + aprovadoEm, mesmo conteudo)', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA, { aprovado: true });
    const e = await estadoDe(psiA, id);
    expect(e.status).toBe('APROVADO');
    expect(e.aprovadoEm).toBeInstanceOf(Date);
    expect(e.conteudoCifrado).toBe('cifrado-original');
  });

  it('colega, ADMIN e outra clinica: UPDATE em documento alheio afeta 0 linhas', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA);
    for (const outro of [adminA, psiB]) {
      const n = await sql(
        outro,
        `UPDATE "Documento" SET "conteudoCifrado" = 'invadido' WHERE id = '${id}'`,
      );
      expect(n).toBe(0);
    }
    expect((await estadoDe(psiA, id)).conteudoCifrado).toBe('cifrado-original');
  });

  it('sem contexto, UPDATE nao acha nada (zero linhas)', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA);
    expect(
      await owner.$executeRawUnsafe(
        `UPDATE "Documento" SET "conteudoCifrado" = 'x' WHERE id = '${id}'`,
      ),
    ).toBe(0);
  });
});

describe('Documento: trigger de imutabilidade (item 44)', () => {
  it('aprovado: app nao faz UPDATE nem por SQL direto (conteudo, data, status, aprovadoEm, atualizadoEm)', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA, { aprovado: true });
    const antes = await estadoDe(psiA, id);
    for (const set of [
      `"conteudoCifrado" = 'adulterado'`,
      `"dataSessao" = NULL`,
      `status = 'RASCUNHO', "aprovadoEm" = NULL`,
      `status = 'RASCUNHO'`,
      `"aprovadoEm" = now()`,
      `"atualizadoEm" = now()`,
      // UPDATE "vazio" (mesmos valores) tambem e barrado: nada muda, nem atualizadoEm
      `status = status`,
    ]) {
      await expect(
        sql(psiA, `UPDATE "Documento" SET ${set} WHERE id = '${id}'`),
      ).rejects.toThrow(/Documento aprovado e imutavel \(UPDATE barrado\)/);
    }
    expect(await estadoDe(psiA, id)).toEqual(antes);
  });

  it('aprovado: o DONO da tabela tambem nao altera', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA, { aprovado: true });
    const antes = await estadoDe(psiA, id);
    for (const set of [
      `"conteudoCifrado" = 'adulterado'`,
      `status = 'RASCUNHO', "aprovadoEm" = NULL`,
      `tipo = 'ANAMNESE'`,
      `"pacienteId" = '${pacienteDe.psiA}'`,
    ]) {
      await expect(
        sqlDono(psiA, `UPDATE "Documento" SET ${set} WHERE id = '${id}'`),
      ).rejects.toThrow(/imutavel \(UPDATE barrado\)/);
    }
    // o desvio de limpeza NAO libera UPDATE
    await expect(
      sqlDono(
        psiA,
        `UPDATE "Documento" SET "conteudoCifrado" = 'x' WHERE id = '${id}'`,
        true,
      ),
    ).rejects.toThrow(/imutavel \(UPDATE barrado\)/);
    expect(await estadoDe(psiA, id)).toEqual(antes);
  });

  it('aprovar trocando o conteudo, a data ou sem aprovadoEm e barrado (app e dono)', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA);
    const antes = await estadoDe(psiA, id);
    for (const set of [
      `status = 'APROVADO', "aprovadoEm" = now(), "conteudoCifrado" = 'trocado'`,
      `status = 'APROVADO', "aprovadoEm" = now(), "dataSessao" = '2020-01-01'`,
      `status = 'APROVADO'`,
    ]) {
      await expect(
        sql(psiA, `UPDATE "Documento" SET ${set} WHERE id = '${id}'`),
      ).rejects.toThrow(/a aprovacao nao pode mudar o conteudo/);
      await expect(
        sqlDono(psiA, `UPDATE "Documento" SET ${set} WHERE id = '${id}'`),
      ).rejects.toThrow(/a aprovacao nao pode mudar o conteudo/);
    }
    expect(await estadoDe(psiA, id)).toEqual(antes);
  });

  it('rascunho: nao ganha aprovadoEm sem aprovar, nem muda tipo, paciente, dono, id ou substituiId (dono tambem)', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA);
    await expect(
      sql(
        psiA,
        `UPDATE "Documento" SET "aprovadoEm" = now() WHERE id = '${id}'`,
      ),
    ).rejects.toThrow(/rascunho nao tem data de aprovacao/);
    const outroPaciente = await novoPaciente(psiA);
    const outroDoc = await novoDoc(psiA, pacienteDe.psiA, { aprovado: true });
    for (const set of [
      `tipo = 'ANAMNESE'`,
      `"pacienteId" = '${outroPaciente}'`,
      `"psicologoId" = '${adminA.psicologoId}'`,
      `"clinicaId" = '${B}'`,
      `id = '${randomUUID()}'`,
      `"substituiId" = '${outroDoc}'`,
    ]) {
      await expect(
        sqlDono(psiA, `UPDATE "Documento" SET ${set} WHERE id = '${id}'`),
      ).rejects.toThrow(/identidade e imutavel/);
    }
    expect((await estadoDe(psiA, id)).status).toBe('RASCUNHO');
  });

  it('DELETE de aprovado barrado ate para o dono; desvio so para o dono e so para DELETE', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA, { aprovado: true });
    await expect(
      sqlDono(psiA, `DELETE FROM "Documento" WHERE id = '${id}'`),
    ).rejects.toThrow(/Documento aprovado e imutavel \(DELETE barrado\)/);
    // notta_app: sem privilegio de DELETE, mesmo com o desvio ligado
    await expect(
      tenant.runComoUsuario(psiA, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.limpeza_de_teste', '1', true)`;
        return tx.$executeRawUnsafe(
          `DELETE FROM "Documento" WHERE id = '${id}'`,
        );
      }),
    ).rejects.toThrow(/permission denied/);
    expect((await estadoDe(psiA, id)).status).toBe('APROVADO');
    // desvio explicito do dono: so a limpeza das suites
    expect(
      await sqlDono(psiA, `DELETE FROM "Documento" WHERE id = '${id}'`, true),
    ).toBe(1);
  });

  it('DELETE de rascunho pelo dono nao tem barreira (o app nao tem o privilegio)', async () => {
    const id = await novoDoc(psiA, pacienteDe.psiA);
    expect(
      await sqlDono(psiA, `DELETE FROM "Documento" WHERE id = '${id}'`),
    ).toBe(1);
  });

  it('TRUNCATE barrado ate para o dono (com lock_timeout)', async () => {
    await expect(ddl(owner, `TRUNCATE "Documento"`)).rejects.toThrow(
      /TRUNCATE barrado/,
    );
    expect(await ver(psiA)).not.toHaveLength(0);
  });
});

describe('Documento: insercao e correcao (CHECK e FK)', () => {
  it('INSERT ja APROVADO ou com aprovadoEm e recusado pela policy', async () => {
    await expect(
      sql(
        psiA,
        `INSERT INTO "Documento" (id, "clinicaId", "psicologoId", "pacienteId", tipo, status, "aprovadoEm", "conteudoCifrado", "atualizadoEm")
         VALUES ('${randomUUID()}', '${psiA.clinicaId}', '${psiA.psicologoId}', '${pacienteDe.psiA}', 'EVOLUCAO', 'APROVADO', now(), 'x', now())`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      sql(
        psiA,
        `INSERT INTO "Documento" (id, "clinicaId", "psicologoId", "pacienteId", tipo, status, "aprovadoEm", "conteudoCifrado", "atualizadoEm")
         VALUES ('${randomUUID()}', '${psiA.clinicaId}', '${psiA.psicologoId}', '${pacienteDe.psiA}', 'EVOLUCAO', 'RASCUNHO', now(), 'x', now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('substituiId = o proprio id cai no CHECK', async () => {
    const id = randomUUID();
    await expect(
      sql(
        psiA,
        `INSERT INTO "Documento" (id, "clinicaId", "psicologoId", "pacienteId", tipo, "substituiId", "conteudoCifrado", "atualizadoEm")
         VALUES ('${id}', '${psiA.clinicaId}', '${psiA.psicologoId}', '${pacienteDe.psiA}', 'EVOLUCAO', '${id}', 'x', now())`,
      ),
    ).rejects.toThrow(/Documento_substitui_check/);
  });

  it('correcao liga ao aprovado do MESMO paciente e dono; outro paciente, colega, outra clinica e inexistente dao o MESMO erro', async () => {
    const aprovado = await novoDoc(psiA, pacienteDe.psiA, { aprovado: true });
    const corrige = await novoDoc(psiA, pacienteDe.psiA, {
      substituiId: aprovado,
    });
    expect(
      await tenant.runComoUsuario(psiA, (tx) =>
        tx.documento.count({ where: { id: corrige, substituiId: aprovado } }),
      ),
    ).toBe(1);

    const outroPaciente = await novoPaciente(psiA);
    const aprovadoOutroPaciente = await novoDoc(psiA, outroPaciente, {
      aprovado: true,
    });
    const erro = async (substituiId: string) => {
      try {
        await novoDoc(psiA, pacienteDe.psiA, { substituiId });
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error('deveria ter falhado');
    };
    const inexistente = await erro(randomUUID());
    expect(inexistente).toMatch(/Foreign key constraint/);
    expect(await erro(aprovadoOutroPaciente)).toBe(inexistente);
    expect(await erro(docDe.adminA)).toBe(inexistente);
    expect(await erro(docDe.psiB)).toBe(inexistente);
  });

  it('documento corrigido nao pode ser apagado enquanto a correcao existir (RESTRICT)', async () => {
    const aprovado = await novoDoc(psiA, pacienteDe.psiA, { aprovado: true });
    await novoDoc(psiA, pacienteDe.psiA, { substituiId: aprovado });
    await expect(
      sqlDono(psiA, `DELETE FROM "Documento" WHERE id = '${aprovado}'`, true),
    ).rejects.toThrow(/Foreign key constraint|violates foreign key/);
  });
});
