import { randomUUID } from 'node:crypto';
import { Papel, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner } from './acesso-owner';

// RLS, privilegios, FK, CHECK e trigger de "GeracaoIa" (itens 19 a 21) e a coluna
// "Documento.geradoPorIa" no Postgres real, como praxis_app e como praxis_owner.
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
const notaDe: Record<string, string> = {};

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

const novaNota = (u: U, pacienteId: string, geradoPorIa = false) =>
  tenant.runComoUsuario(u, async (tx) => {
    const id = randomUUID();
    await tx.documento.create({
      data: {
        id,
        clinicaId: u.clinicaId,
        psicologoId: u.psicologoId,
        pacienteId,
        tipo: 'NOTA_BRUTA',
        conteudoCifrado: 'x',
        geradoPorIa,
      },
    });
    return id;
  });

// Grava como `u` com o dono/paciente/origem/estado que o teste quiser (prova o que o banco recusa).
const gravar = (
  u: U,
  alvo: {
    dono?: U;
    pacienteId: string;
    origemId: string;
    estado?: string;
    tipoDocumento?: string;
    abordagem?: string;
    textoCifrado?: string | null;
  },
) =>
  tenant.runComoUsuario(u, async (tx) => {
    const dono = alvo.dono ?? u;
    const l = await tx.geracaoIa.create({
      data: {
        id: randomUUID(),
        clinicaId: dono.clinicaId,
        psicologoId: dono.psicologoId,
        pacienteId: alvo.pacienteId,
        origemId: alvo.origemId,
        tipoDocumento: alvo.tipoDocumento ?? 'EVOLUCAO',
        abordagem: alvo.abordagem ?? 'TCC',
        estado: alvo.estado ?? 'PREVIA',
        textoCifrado:
          alvo.textoCifrado === undefined ? 'cifrado' : alvo.textoCifrado,
        mapaCifrado: 'cifrado',
        expiraEm: new Date(Date.now() + 30 * 60_000),
      },
    });
    return l.id;
  });

const previa = (u: U) =>
  gravar(u, { pacienteId: pacienteDe[chave(u)], origemId: notaDe[chave(u)] });
const chave = (u: U) =>
  u === adminA ? 'adminA' : u === psiA ? 'psiA' : 'psiB';

const ver = (u: U) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.geracaoIa.findMany({ select: { id: true } }),
  );
const sql = (u: U, texto: string) =>
  tenant.runComoUsuario(u, (tx) => tx.$executeRawUnsafe(texto));
const sqlDono = (u: U, texto: string) =>
  comoOwner(u.clinicaId, (tx) => tx.$executeRawUnsafe(texto), {
    psicologoId: u.psicologoId,
  });
const linha = (u: U, id: string) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.geracaoIa.findFirstOrThrow({ where: { id } }),
  );

const SET_PENDENTE = (id: string) =>
  `UPDATE "GeracaoIa" SET "estado" = 'PENDENTE' WHERE "id" = '${id}'`;
const SET_FALHOU = (id: string) =>
  `UPDATE "GeracaoIa" SET "estado" = 'FALHOU', "motivo" = 'REDE', "retentavel" = true, "finalizadoEm" = now() WHERE "id" = '${id}'`;
const SET_PRONTO = (id: string, doc: string) =>
  `UPDATE "GeracaoIa" SET "estado" = 'PRONTO', "documentoId" = '${doc}', "finalizadoEm" = now(), "textoCifrado" = NULL, "mapaCifrado" = NULL WHERE "id" = '${id}'`;

beforeAll(async () => {
  for (const [id, nome] of [
    [A, 'A'],
    [B, 'B'],
  ]) {
    await tenant.run(id, (tx) =>
      tx.clinica.create({ data: { id, nome: `${nome}-${sufixo}` } }),
    );
  }
  adminA = await criarPsicologo(A, 'ger-admin-a', 'ADMIN');
  psiA = await criarPsicologo(A, 'ger-psi-a', 'PSICOLOGO');
  psiB = await criarPsicologo(B, 'ger-psi-b', 'PSICOLOGO');
  for (const u of [adminA, psiA, psiB]) {
    pacienteDe[chave(u)] = await novoPaciente(u);
    notaDe[chave(u)] = await novaNota(u, pacienteDe[chave(u)]);
  }
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('GeracaoIa: estrutura no banco', () => {
  it('RLS ENABLE + FORCE, policies separadas, sem FK em cascade, so SELECT e INSERT na tabela', async () => {
    const [t] = await owner.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'GeracaoIa'`;
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.$queryRaw<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE tablename = 'GeracaoIa' ORDER BY policyname`;
    expect(p.map((x) => x.policyname)).toEqual([
      'geracaoia_anonimizar_update',
      'geracaoia_descartar_select',
      'geracaoia_dono_delete',
      'geracaoia_dono_update',
      'geracaoia_insert_proprio',
      'geracaoia_recifrar_select',
      'geracaoia_recifrar_update',
      'geracaoia_select_proprio',
      'geracaoia_transferir_select',
      'geracaoia_transferir_update',
      'geracaoia_update_proprio',
    ]);
    const c = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"GeracaoIa"'::regclass AND contype = 'f' AND confdeltype = 'c'`;
    expect(c).toEqual([]);
    const g = await owner.$queryRaw<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'GeracaoIa' AND grantee = 'praxis_app' ORDER BY privilege_type`;
    expect(g).toEqual([
      { privilege_type: 'INSERT' },
      { privilege_type: 'SELECT' },
    ]);
  });

  it('praxis_app: UPDATE so nas colunas de andamento, nenhum DELETE/TRUNCATE; trigger, CHECKs e indice parcial existem', async () => {
    const col = await owner.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.column_privileges
      WHERE table_name = 'GeracaoIa' AND grantee = 'praxis_app' AND privilege_type = 'UPDATE'
      ORDER BY column_name`;
    expect(col.map((x) => x.column_name)).toEqual([
      'atualizadoEm',
      'avisos',
      'documentoId',
      'estado',
      'finalizadoEm',
      'mapaCifrado',
      'motivo',
      'retentavel',
      'textoCifrado',
    ]);
    const [priv] = await owner.$queryRaw<{ del: boolean; trg: boolean }[]>`
      SELECT has_table_privilege('praxis_app', '"GeracaoIa"', 'DELETE') AS del,
             has_table_privilege('praxis_app', '"GeracaoIa"', 'TRIGGER') AS trg`;
    expect(priv).toEqual({ del: false, trg: false });
    const trg = await owner.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE tgrelid = '"GeracaoIa"'::regclass AND NOT tgisinternal`;
    // 20261110120000: + trigger de insert para paciente excluido (item 26).
    expect(trg.map((x) => x.tgname).sort()).toEqual([
      'geracao_ia_barreira',
      'geracaoia_paciente_excluido',
    ]);
    const chk = await owner.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"GeracaoIa"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(chk.map((x) => x.conname)).toEqual([
      'GeracaoIa_abordagem_check',
      'GeracaoIa_estado_check',
      'GeracaoIa_forma_check',
      'GeracaoIa_motivo_check',
      'GeracaoIa_tipoDocumento_check',
    ]);
    const [idx] = await owner.$queryRaw<{ def: string }[]>`
      SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'GeracaoIa_um_pendente_por_psicologo'`;
    expect(idx.def).toMatch(/UNIQUE.*psicologoId.*PENDENTE/);
  });
});

describe('GeracaoIa: leitura isolada por psicologo', () => {
  it('sem contexto = ZERO linhas; so a clinica sem psicologo = zero', async () => {
    await previa(psiA);
    expect(await app.$queryRaw`SELECT id FROM "GeracaoIa"`).toEqual([]);
    expect(
      await tenant.run(A, (tx) =>
        tx.geracaoIa.findMany({ select: { id: true } }),
      ),
    ).toEqual([]);
  });

  it('cada um ve so o proprio; colega (inclusive ADMIN) e outra clinica veem zero do alheio', async () => {
    const id = await previa(psiB);
    expect(await ver(adminA)).toEqual([]);
    expect(await ver(psiA)).toHaveLength(1);
    expect(await ver(psiB)).toEqual([{ id }]);
    const cruzado = await tenant.runComoUsuario(
      { clinicaId: B, psicologoId: psiA.psicologoId },
      (tx) => tx.geracaoIa.findMany(),
    );
    expect(cruzado).toEqual([]);
  });
});

describe('GeracaoIa: escrita', () => {
  it('INSERT com psicologoId alheio (colega, ADMIN ou outra clinica) e recusado', async () => {
    await expect(
      gravar(psiA, {
        dono: adminA,
        pacienteId: pacienteDe.adminA,
        origemId: notaDe.adminA,
      }),
    ).rejects.toThrow(/row-level security/);
    await expect(
      gravar(adminA, {
        dono: psiA,
        pacienteId: pacienteDe.psiA,
        origemId: notaDe.psiA,
      }),
    ).rejects.toThrow(/row-level security/);
    await expect(
      gravar(psiA, {
        dono: psiB,
        pacienteId: pacienteDe.psiB,
        origemId: notaDe.psiB,
      }),
    ).rejects.toThrow();
  });

  it('INSERT fora de PREVIA e recusado pela policy (ninguem nasce PRONTO, PENDENTE ou FALHOU)', async () => {
    for (const estado of ['PENDENTE', 'PRONTO', 'FALHOU']) {
      await expect(
        gravar(psiA, {
          pacienteId: pacienteDe.psiA,
          origemId: notaDe.psiA,
          estado,
        }),
      ).rejects.toThrow(/row-level security/);
    }
  });

  it('CHECKs: tipo, abordagem e forma do estado (PREVIA sem texto cifrado) recusados', async () => {
    const base = { pacienteId: pacienteDe.psiA, origemId: notaDe.psiA };
    await expect(
      gravar(psiA, { ...base, tipoDocumento: 'NOTA_BRUTA' }),
    ).rejects.toThrow(/GeracaoIa_tipoDocumento_check/);
    await expect(gravar(psiA, { ...base, abordagem: 'FREUD' })).rejects.toThrow(
      /GeracaoIa_abordagem_check/,
    );
    await expect(gravar(psiA, { ...base, textoCifrado: null })).rejects.toThrow(
      /GeracaoIa_forma_check/,
    );
  });

  it('FK da origem: nota de colega, de outra clinica, de outro paciente seu e inexistente dao o MESMO erro', async () => {
    const outroPaciente = await novoPaciente(psiA);
    const erro = async (origemId: string, pacienteId = pacienteDe.psiA) => {
      try {
        await gravar(psiA, { pacienteId, origemId });
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error('deveria ter falhado');
    };
    const inexistente = await erro(randomUUID());
    expect(inexistente).toMatch(/Foreign key constraint/);
    expect(await erro(notaDe.adminA)).toBe(inexistente);
    expect(await erro(notaDe.psiB)).toBe(inexistente);
    expect(await erro(notaDe.psiA, outroPaciente)).toBe(inexistente);
  });

  it('praxis_app: DELETE e TRUNCATE = permission denied; colunas de identidade sem UPDATE', async () => {
    await expect(sql(psiA, `DELETE FROM "GeracaoIa"`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(sql(psiA, `TRUNCATE "GeracaoIa"`)).rejects.toThrow(
      /permission denied/,
    );
    for (const col of [
      'id',
      'clinicaId',
      'psicologoId',
      'pacienteId',
      'origemId',
      'tipoDocumento',
      'abordagem',
      'expiraEm',
      'criadoEm',
    ]) {
      await expect(
        sql(psiA, `UPDATE "GeracaoIa" SET "${col}" = "${col}"`),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('nota com pedido de IA nao pode ser apagada (FK RESTRICT)', async () => {
    await expect(
      comoOwner(
        psiA.clinicaId,
        (tx) => tx.documento.deleteMany({ where: { id: notaDe.psiA } }),
        { psicologoId: psiA.psicologoId },
      ),
    ).rejects.toThrow();
  });
});

describe('GeracaoIa: trigger de estados e imutabilidade', () => {
  it('caminho legitimo: PREVIA -> PENDENTE -> FALHOU -> PENDENTE -> PRONTO (documento ligado, cifrados zerados)', async () => {
    const id = await previa(adminA);
    await sql(adminA, SET_PENDENTE(id));
    await sql(adminA, SET_FALHOU(id));
    expect(await linha(adminA, id)).toMatchObject({
      estado: 'FALHOU',
      motivo: 'REDE',
      retentavel: true,
      textoCifrado: 'cifrado',
      mapaCifrado: 'cifrado',
    });
    await sql(
      adminA,
      `UPDATE "GeracaoIa" SET "estado" = 'PENDENTE', "motivo" = NULL, "retentavel" = NULL, "finalizadoEm" = NULL WHERE "id" = '${id}'`,
    );
    // UPDATE primeiro e INSERT do Documento depois, na mesma transacao: a FK confere no COMMIT.
    const doc = randomUUID();
    await tenant.runComoUsuario(adminA, async (tx) => {
      await tx.$executeRawUnsafe(SET_PRONTO(id, doc));
      await tx.documento.create({
        data: {
          id: doc,
          clinicaId: adminA.clinicaId,
          psicologoId: adminA.psicologoId,
          pacienteId: pacienteDe.adminA,
          tipo: 'EVOLUCAO',
          conteudoCifrado: 'x',
          geradoPorIa: true,
        },
      });
    });
    expect(await linha(adminA, id)).toMatchObject({
      estado: 'PRONTO',
      documentoId: doc,
      textoCifrado: null,
      mapaCifrado: null,
    });
  });

  it('FK do documento gerado confere no COMMIT: id inexistente derruba a transacao', async () => {
    const id = await previa(adminA);
    await sql(adminA, SET_PENDENTE(id));
    await expect(sql(adminA, SET_PRONTO(id, randomUUID()))).rejects.toThrow(
      /Foreign key constraint|violates foreign key/,
    );
    expect((await linha(adminA, id)).estado).toBe('PENDENTE');
    await sql(adminA, SET_FALHOU(id));
  });

  it('documento gerado de outro paciente, ou ja ligado a outro pedido, e recusado', async () => {
    const outroPaciente = await novoPaciente(adminA);
    const docOutro = await novaNota(adminA, outroPaciente);
    const id = await previa(adminA);
    await sql(adminA, SET_PENDENTE(id));
    await expect(sql(adminA, SET_PRONTO(id, docOutro))).rejects.toThrow();
    await sql(adminA, SET_FALHOU(id));

    // UNIQUE em documentoId: dois pedidos nao apontam para o mesmo documento
    const doc = await novaNota(psiA, pacienteDe.psiA, true);
    const p1 = await previa(psiA);
    const p2 = await previa(psiA);
    await sql(psiA, SET_PENDENTE(p1));
    await sql(psiA, SET_PRONTO(p1, doc));
    await sql(psiA, SET_PENDENTE(p2));
    await expect(sql(psiA, SET_PRONTO(p2, doc))).rejects.toThrow(
      /unique|duplicate/i,
    );
    await sql(psiA, SET_FALHOU(p2));
  });

  it('transicoes invalidas barradas para o app E para o dono', async () => {
    const id = await previa(adminA);
    for (const run of [sql, sqlDono]) {
      await expect(
        run(
          adminA,
          `UPDATE "GeracaoIa" SET "estado" = 'FALHOU', "motivo" = 'REDE', "retentavel" = true, "finalizadoEm" = now() WHERE "id" = '${id}'`,
        ),
      ).rejects.toThrow(/transicao de estado invalida/);
      await expect(
        run(
          adminA,
          `UPDATE "GeracaoIa" SET "estado" = 'PRONTO', "documentoId" = '${notaDe.adminA}', "finalizadoEm" = now(), "textoCifrado" = NULL, "mapaCifrado" = NULL WHERE "id" = '${id}'`,
        ),
      ).rejects.toThrow(/transicao de estado invalida/);
    }
    await sql(adminA, SET_PENDENTE(id));
    // PENDENTE -> PREVIA e PENDENTE -> PENDENTE
    for (const run of [sql, sqlDono]) {
      await expect(
        run(
          adminA,
          `UPDATE "GeracaoIa" SET "estado" = 'PREVIA' WHERE "id" = '${id}'`,
        ),
      ).rejects.toThrow(/transicao de estado invalida/);
      await expect(
        run(
          adminA,
          `UPDATE "GeracaoIa" SET "avisos" = ARRAY['X'] WHERE "id" = '${id}'`,
        ),
      ).rejects.toThrow(/transicao de estado invalida/);
    }
    await sql(adminA, SET_FALHOU(id));
  });

  it('PRONTO e final: nem o app nem o dono alteram', async () => {
    const id = await previa(psiA);
    const doc = await novaNota(psiA, pacienteDe.psiA, true);
    await sql(psiA, SET_PENDENTE(id));
    await sql(psiA, SET_PRONTO(id, doc));
    await expect(
      sql(
        psiA,
        `UPDATE "GeracaoIa" SET "avisos" = ARRAY['X'] WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/pronta e final/);
    await expect(
      sqlDono(
        psiA,
        `UPDATE "GeracaoIa" SET "avisos" = ARRAY['X'] WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/pronta e final/);
    await expect(
      sqlDono(
        psiA,
        `UPDATE "GeracaoIa" SET "estado" = 'FALHOU', "motivo" = 'REDE', "retentavel" = true WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/pronta e final/);
  });

  it('identidade imutavel para o dono (origem, tipo, abordagem, paciente, psicologo, expiracao)', async () => {
    const id = await previa(adminA);
    const novoPac = await novoPaciente(adminA);
    const outraNota = await novaNota(adminA, pacienteDe.adminA);
    for (const set of [
      `"tipoDocumento" = 'ANAMNESE'`,
      `"abordagem" = 'ACT'`,
      `"origemId" = '${outraNota}'`,
      `"pacienteId" = '${novoPac}'`,
      `"psicologoId" = '${psiA.psicologoId}'`,
      `"expiraEm" = now() + interval '1 day'`,
      `"criadoEm" = now() + interval '1 day'`,
    ]) {
      await expect(
        sqlDono(adminA, `UPDATE "GeracaoIa" SET ${set} WHERE "id" = '${id}'`),
      ).rejects.toThrow(/identidade e imutavel|violates|foreign key/i);
    }
    expect((await linha(adminA, id)).tipoDocumento).toBe('EVOLUCAO');
  });

  it('o texto enviado a IA nao muda fora do PRONTO (nem na confirmacao, nem no dono)', async () => {
    const id = await previa(adminA);
    await expect(
      sql(
        adminA,
        `UPDATE "GeracaoIa" SET "estado" = 'PENDENTE', "textoCifrado" = 'outro' WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/texto enviado a IA nao muda/);
    await expect(
      sqlDono(
        adminA,
        `UPDATE "GeracaoIa" SET "estado" = 'PENDENTE', "mapaCifrado" = 'outro' WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/texto enviado a IA nao muda/);
    expect((await linha(adminA, id)).textoCifrado).toBe('cifrado');
  });

  it('forma do PRONTO: sem documento, ou com cifrados nao zerados = CHECK barra', async () => {
    const id = await previa(adminA);
    await sql(adminA, SET_PENDENTE(id));
    await expect(
      sql(
        adminA,
        `UPDATE "GeracaoIa" SET "estado" = 'PRONTO', "finalizadoEm" = now(), "textoCifrado" = NULL, "mapaCifrado" = NULL WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/GeracaoIa_forma_check/);
    await expect(
      sql(
        adminA,
        `UPDATE "GeracaoIa" SET "estado" = 'PRONTO', "documentoId" = '${notaDe.adminA}', "finalizadoEm" = now() WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/GeracaoIa_forma_check/);
    await expect(
      sql(
        adminA,
        `UPDATE "GeracaoIa" SET "estado" = 'FALHOU', "motivo" = 'TEXTO LIVRE DA IA', "retentavel" = true, "finalizadoEm" = now() WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/GeracaoIa_motivo_check/);
    await sql(adminA, SET_FALHOU(id));
  });

  it('no maximo UMA geracao PENDENTE por psicologo (indice parcial), mas colegas nao se bloqueiam', async () => {
    const um = await previa(psiA);
    const dois = await previa(psiA);
    const doColega = await previa(adminA);
    await sql(psiA, SET_PENDENTE(um));
    await expect(sql(psiA, SET_PENDENTE(dois))).rejects.toThrow(
      /unique|duplicate/i,
    );
    await sql(adminA, SET_PENDENTE(doColega));
    await sql(psiA, SET_FALHOU(um));
    await sql(psiA, SET_PENDENTE(dois));
    await sql(psiA, SET_FALHOU(dois));
    await sql(adminA, SET_FALHOU(doColega));
  });
});

describe('Documento.geradoPorIa', () => {
  it('default false, grava true no INSERT, e e imutavel (app sem UPDATE; dono barrado pelo trigger)', async () => {
    const manual = await novaNota(psiA, pacienteDe.psiA);
    const gerado = await novaNota(psiA, pacienteDe.psiA, true);
    const ler = (id: string) =>
      tenant.runComoUsuario(psiA, (tx) =>
        tx.documento.findFirstOrThrow({
          where: { id },
          select: { geradoPorIa: true },
        }),
      );
    expect(await ler(manual)).toEqual({ geradoPorIa: false });
    expect(await ler(gerado)).toEqual({ geradoPorIa: true });
    await expect(
      sql(psiA, `UPDATE "Documento" SET "geradoPorIa" = true`),
    ).rejects.toThrow(/permission denied/);
    for (const [id, v] of [
      [manual, 'true'],
      [gerado, 'false'],
    ]) {
      await expect(
        sqlDono(
          psiA,
          `UPDATE "Documento" SET "geradoPorIa" = ${v} WHERE "id" = '${id}'`,
        ),
      ).rejects.toThrow(/identidade e imutavel/);
    }
  });
});
