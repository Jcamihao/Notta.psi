import { randomUUID } from 'node:crypto';
import { Papel, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas, comoOwner } from './acesso-owner';

// Recifragem pelo dono (item 25, parte B) no Postgres real: policies `TO notta_owner` que so
// abrem com app.recifrar = '1', e a excecao dos triggers (documento_imutavel e
// geracao_ia_barreira) que vale SO para o dono, com a flag, e SO para a coluna cifrada.
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: teste de recifragem exige o papel notta_owner (ver backend/README.md)',
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

// Cada teste de GeracaoIa usa um psicologo proprio: so pode haver UM PENDENTE por psicologo.
async function novoDono(nome: string, clinicaId = A) {
  const p = await tenant.run(clinicaId, (tx) =>
    tx.psicologo.create({
      data: {
        clinicaId,
        nome,
        papel: Papel.PSICOLOGO,
        email: `${nome}-${sufixo}@teste.local`,
        senhaHash: 'x',
        abordagemPadrao: 'TCC',
        // RLS: PSICOLOGO criado pelo app nasce com senha provisoria.
        senhaProvisoria: true,
      },
    }),
  );
  const u: U = { clinicaId, psicologoId: p.id };
  const pacienteId = randomUUID();
  const notaId = randomUUID();
  await tenant.runComoUsuario(u, async (tx) => {
    await tx.paciente.create({
      data: {
        id: pacienteId,
        clinicaId,
        psicologoId: u.psicologoId,
        nomeCifrado: 'x',
      },
    });
    await tx.documento.create({
      data: {
        id: notaId,
        clinicaId,
        psicologoId: u.psicologoId,
        pacienteId,
        tipo: 'NOTA_BRUTA',
        conteudoCifrado: 'x',
      },
    });
  });
  return { u, pacienteId, notaId };
}

// Como notta_app, no contexto do psicologo (o que o app faz).
const sqlComo = (u: U, texto: string) =>
  tenant.runComoUsuario(u, (tx) => tx.$executeRawUnsafe(texto));
// Como notta_owner, com a clinica e o psicologo no contexto e SEM a flag (o que o dono faz hoje).
const sqlDono = (u: U, texto: string) =>
  comoOwner(u.clinicaId, (tx) => tx.$executeRawUnsafe(texto), {
    psicologoId: u.psicologoId,
  });
// Como notta_owner COM a flag, sem contexto de clinica (o que o comando de recifragem faz).
const comRecifra = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.recifrar', '1', true)`;
    return fn(tx);
  });
// Como notta_app COM a flag: nao pode nada (teste obrigatorio).
const appComRecifra = (u: U, texto: string) =>
  tenant.runComoUsuario(u, async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.recifrar', '1', true)`;
    return tx.$executeRawUnsafe(texto);
  });
const appSemContextoComRecifra = (texto: string) =>
  app.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.recifrar', '1', true)`;
    return tx.$executeRawUnsafe(texto);
  });

const aprovar = (u: U, id: string) =>
  sqlComo(
    u,
    `UPDATE "Documento" SET "status" = 'APROVADO', "aprovadoEm" = now() WHERE "id" = '${id}'`,
  );
const lerDoc = (u: U, id: string) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.$queryRawUnsafe<
      {
        conteudoCifrado: string;
        status: string;
        aprovadoEm: Date | null;
        dataSessao: Date | null;
        atualizadoEm: Date;
      }[]
    >(
      `SELECT "conteudoCifrado", "status", "aprovadoEm", "dataSessao", "atualizadoEm" FROM "Documento" WHERE "id" = '${id}'`,
    ),
  );
const pendente = async (u: U, pacienteId: string, origemId: string) => {
  const id = randomUUID();
  await tenant.runComoUsuario(u, (tx) =>
    tx.geracaoIa.create({
      data: {
        id,
        clinicaId: u.clinicaId,
        psicologoId: u.psicologoId,
        pacienteId,
        origemId,
        tipoDocumento: 'EVOLUCAO',
        abordagem: 'TCC',
        estado: 'PREVIA',
        textoCifrado: 'cifrado',
        mapaCifrado: 'cifrado',
        expiraEm: new Date(Date.now() + 30 * 60_000),
      },
    }),
  );
  await sqlComo(
    u,
    `UPDATE "GeracaoIa" SET "estado" = 'PENDENTE' WHERE "id" = '${id}'`,
  );
  return id;
};
const lerGeracao = (u: U, id: string) =>
  tenant.runComoUsuario(u, (tx) =>
    tx.$queryRawUnsafe<
      {
        textoCifrado: string | null;
        mapaCifrado: string | null;
        estado: string;
      }[]
    >(
      `SELECT "textoCifrado", "mapaCifrado", "estado" FROM "GeracaoIa" WHERE "id" = '${id}'`,
    ),
  );

beforeAll(async () => {
  await tenant.run(A, (tx) =>
    tx.clinica.create({ data: { id: A, nome: `RA-${sufixo}` } }),
  );
  await tenant.run(B, (tx) =>
    tx.clinica.create({ data: { id: B, nome: `RB-${sufixo}` } }),
  );
});

afterAll(async () => {
  await apagarClinicas([A, B]);
  await app.$disconnect();
  await owner.$disconnect();
});

describe('Recifragem: policies novas so para notta_owner', () => {
  it('SELECT e UPDATE em Paciente, Documento e GeracaoIa, todas TO notta_owner', async () => {
    const p = await owner.$queryRaw<
      { tablename: string; policyname: string; cmd: string; roles: string }[]
    >`SELECT "tablename", "policyname", "cmd", array_to_string("roles", ',') AS roles
      FROM pg_policies WHERE "policyname" LIKE '%recifrar%'
      ORDER BY "tablename", "policyname"`;
    expect(p).toEqual([
      {
        tablename: 'Documento',
        policyname: 'documento_recifrar_select',
        cmd: 'SELECT',
        roles: 'notta_owner',
      },
      {
        tablename: 'Documento',
        policyname: 'documento_recifrar_update',
        cmd: 'UPDATE',
        roles: 'notta_owner',
      },
      {
        tablename: 'GeracaoIa',
        policyname: 'geracaoia_recifrar_select',
        cmd: 'SELECT',
        roles: 'notta_owner',
      },
      {
        tablename: 'GeracaoIa',
        policyname: 'geracaoia_recifrar_update',
        cmd: 'UPDATE',
        roles: 'notta_owner',
      },
      {
        tablename: 'Paciente',
        policyname: 'paciente_recifrar_select',
        cmd: 'SELECT',
        roles: 'notta_owner',
      },
      {
        tablename: 'Paciente',
        policyname: 'paciente_recifrar_update',
        cmd: 'UPDATE',
        roles: 'notta_owner',
      },
    ]);
  });
});

describe('Recifragem: Paciente', () => {
  it('dono sem a flag nao ve paciente sem contexto; com a flag ve e atualiza', async () => {
    const { u, pacienteId } = await novoDono('rec-pac-1');
    const semFlag = await owner.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "Paciente" WHERE "id" = '${pacienteId}'`,
    );
    expect(semFlag).toEqual([]);
    const comFlag = await comRecifra((tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "Paciente" WHERE "id" = '${pacienteId}'`,
      ),
    );
    expect(comFlag).toEqual([{ id: pacienteId }]);
    const n = await comRecifra((tx) =>
      tx.$executeRawUnsafe(
        `UPDATE "Paciente" SET "nomeCifrado" = 'v1.k2.recifrado' WHERE "id" = '${pacienteId}'`,
      ),
    );
    expect(n).toBe(1);
    const lido = await tenant.runComoUsuario(u, (tx) =>
      tx.paciente.findUniqueOrThrow({ where: { id: pacienteId } }),
    );
    expect(lido.nomeCifrado).toBe('v1.k2.recifrado');
  });

  it('notta_app com a flag, sem contexto de clinica: zero linhas, zero UPDATE', async () => {
    const { pacienteId } = await novoDono('rec-pac-2');
    const n = await appSemContextoComRecifra(
      `UPDATE "Paciente" SET "nomeCifrado" = 'hack' WHERE "id" = '${pacienteId}'`,
    );
    expect(n).toBe(0);
    const linhas = await appSemContextoComRecifra(
      `SELECT 1 FROM "Paciente" WHERE "id" = '${pacienteId}'`,
    );
    expect(linhas).toBe(0);
  });
});

describe('Recifragem: Documento aprovado', () => {
  it('notta_app com a flag nao atualiza documento aprovado (com contexto nem sem)', async () => {
    const { u, notaId } = await novoDono('rec-doc-app');
    await aprovar(u, notaId);
    await expect(
      appComRecifra(
        u,
        `UPDATE "Documento" SET "conteudoCifrado" = 'hack' WHERE "id" = '${notaId}'`,
      ),
    ).rejects.toThrow(/UPDATE barrado/);
    const n = await appSemContextoComRecifra(
      `UPDATE "Documento" SET "conteudoCifrado" = 'hack' WHERE "id" = '${notaId}'`,
    );
    expect(n).toBe(0);
    expect((await lerDoc(u, notaId))[0].conteudoCifrado).toBe('x');
  });

  it('dono SEM a flag continua barrado pelo trigger', async () => {
    const { u, notaId } = await novoDono('rec-doc-semflag');
    await aprovar(u, notaId);
    await expect(
      sqlDono(
        u,
        `UPDATE "Documento" SET "conteudoCifrado" = 'novo' WHERE "id" = '${notaId}'`,
      ),
    ).rejects.toThrow(/imutavel \(UPDATE barrado\)/);
  });

  it('dono COM a flag troca SO a coluna cifrada; status, aprovadoEm e atualizadoEm ficam', async () => {
    const { u, notaId } = await novoDono('rec-doc-ok');
    await aprovar(u, notaId);
    const antes = (await lerDoc(u, notaId))[0];
    const n = await comRecifra((tx) =>
      tx.$executeRawUnsafe(
        `UPDATE "Documento" SET "conteudoCifrado" = 'v1.k2.novo' WHERE "id" = '${notaId}'`,
      ),
    );
    expect(n).toBe(1);
    const depois = (await lerDoc(u, notaId))[0];
    expect(depois.conteudoCifrado).toBe('v1.k2.novo');
    expect(depois.status).toBe('APROVADO');
    expect(depois.aprovadoEm).toEqual(antes.aprovadoEm);
    expect(depois.atualizadoEm).toEqual(antes.atualizadoEm);
  });

  it('dono COM a flag falha se mudar tambem outra coluna, e nada muda', async () => {
    const { u, notaId } = await novoDono('rec-doc-extra');
    await aprovar(u, notaId);
    const antes = (await lerDoc(u, notaId))[0];
    const extras = [
      `"dataSessao" = '2026-01-01'`,
      `"atualizadoEm" = now()`,
      `"aprovadoEm" = now()`,
      `"status" = 'RASCUNHO', "aprovadoEm" = NULL`,
    ];
    for (const extra of extras) {
      await expect(
        comRecifra((tx) =>
          tx.$executeRawUnsafe(
            `UPDATE "Documento" SET "conteudoCifrado" = 'novo', ${extra} WHERE "id" = '${notaId}'`,
          ),
        ),
      ).rejects.toThrow(/UPDATE barrado/);
    }
    const depois = (await lerDoc(u, notaId))[0];
    expect(depois).toEqual(antes);
  });
});

describe('Recifragem: GeracaoIa', () => {
  it('dono COM a flag troca textoCifrado ou mapaCifrado (uma coluna por vez) em PENDENTE', async () => {
    const { u, pacienteId, notaId } = await novoDono('rec-ger-ok');
    const id = await pendente(u, pacienteId, notaId);
    const n1 = await comRecifra((tx) =>
      tx.$executeRawUnsafe(
        `UPDATE "GeracaoIa" SET "textoCifrado" = 'v1.k2.t' WHERE "id" = '${id}'`,
      ),
    );
    const n2 = await comRecifra((tx) =>
      tx.$executeRawUnsafe(
        `UPDATE "GeracaoIa" SET "mapaCifrado" = 'v1.k2.m' WHERE "id" = '${id}'`,
      ),
    );
    expect([n1, n2]).toEqual([1, 1]);
    expect(await lerGeracao(u, id)).toEqual([
      { textoCifrado: 'v1.k2.t', mapaCifrado: 'v1.k2.m', estado: 'PENDENTE' },
    ]);
  });

  it('dono COM a flag falha se trocar as duas cifradas na mesma instrucao', async () => {
    const { u, pacienteId, notaId } = await novoDono('rec-ger-duas');
    const id = await pendente(u, pacienteId, notaId);
    await expect(
      comRecifra((tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "GeracaoIa" SET "textoCifrado" = 'v1.k2.t', "mapaCifrado" = 'v1.k2.m' WHERE "id" = '${id}'`,
        ),
      ),
    ).rejects.toThrow(/UPDATE barrado/);
  });

  it('dono COM a flag falha se mudar tambem o estado ou o atualizadoEm', async () => {
    const { u, pacienteId, notaId } = await novoDono('rec-ger-extra');
    const id = await pendente(u, pacienteId, notaId);
    const antes = await lerGeracao(u, id);
    await expect(
      comRecifra((tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "GeracaoIa" SET "textoCifrado" = 'v1.k2.t', "estado" = 'FALHOU', "motivo" = 'REDE', "retentavel" = true, "finalizadoEm" = now() WHERE "id" = '${id}'`,
        ),
      ),
    ).rejects.toThrow(/UPDATE barrado/);
    await expect(
      comRecifra((tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "GeracaoIa" SET "textoCifrado" = 'v1.k2.t', "atualizadoEm" = now() WHERE "id" = '${id}'`,
        ),
      ),
    ).rejects.toThrow(/UPDATE barrado/);
    expect(await lerGeracao(u, id)).toEqual(antes);
  });

  it('dono SEM a flag continua barrado: texto enviado a IA nao muda', async () => {
    const { u, pacienteId, notaId } = await novoDono('rec-ger-semflag');
    const id = await pendente(u, pacienteId, notaId);
    await expect(
      sqlDono(
        u,
        `UPDATE "GeracaoIa" SET "textoCifrado" = 'novo' WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/UPDATE barrado/);
  });

  it('notta_app com a flag nao muda o texto (com contexto nem sem)', async () => {
    const { u, pacienteId, notaId } = await novoDono('rec-ger-app');
    const id = await pendente(u, pacienteId, notaId);
    await expect(
      appComRecifra(
        u,
        `UPDATE "GeracaoIa" SET "textoCifrado" = 'hack' WHERE "id" = '${id}'`,
      ),
    ).rejects.toThrow(/UPDATE barrado/);
    const n = await appSemContextoComRecifra(
      `UPDATE "GeracaoIa" SET "textoCifrado" = 'hack' WHERE "id" = '${id}'`,
    );
    expect(n).toBe(0);
    expect((await lerGeracao(u, id))[0].textoCifrado).toBe('cifrado');
  });
});
