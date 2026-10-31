import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

// Integracao com Postgres real: sem as URLs falha alto, nunca pula.
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: teste de RLS exige o papel notta_owner (ver backend/README.md)',
  );
}

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
const emailA = `a-${sufixo}@teste.local`;
const emailB = `b-${sufixo}@teste.local`;
const emailVazio = ''; // linha armadilha: prova que runLogin('') nao casa e-mail vazio

function psicologo(clinicaId: string, email: string) {
  return {
    clinicaId,
    email,
    nome: 'Teste',
    senhaHash: 'x',
    abordagemPadrao: 'TCC' as const,
  };
}

async function setting(
  db: Prisma.TransactionClient | PrismaClient,
  nome: string,
) {
  const [r] = await db.$queryRaw<
    { v: string | null }[]
  >`SELECT current_setting(${nome}, true) AS v`;
  return r.v;
}

beforeAll(async () => {
  await tenant.run(A, async (tx) => {
    await tx.clinica.create({ data: { id: A, nome: `A-${sufixo}` } });
    await tx.psicologo.create({ data: psicologo(A, emailA) });
    await tx.psicologo.create({ data: psicologo(A, emailVazio) });
  });
  await tenant.run(B, async (tx) => {
    await tx.clinica.create({ data: { id: B, nome: `B-${sufixo}` } });
    await tx.psicologo.create({ data: psicologo(B, emailB) });
  });
});

afterAll(async () => {
  // Limpeza sempre DENTRO de contexto (owner tambem esta sujeito ao FORCE).
  for (const id of [A, B]) {
    await tenant.run(id, async (tx) => {
      await tx.psicologo.deleteMany({ where: { clinicaId: id } });
      await tx.clinica.deleteMany({ where: { id } });
    });
  }
  await app.$disconnect();
  await owner.$disconnect();
});

describe('RLS por clinica', () => {
  it('sem contexto: Clinica e Psicologo devolvem zero linhas (sem erro)', async () => {
    expect(await app.clinica.findMany()).toEqual([]);
    expect(await app.psicologo.findMany()).toEqual([]);
  });

  it('contexto A ve so A, contexto B ve so B', async () => {
    const vistoA = await tenant.run(A, async (tx) => ({
      clinicas: await tx.clinica.findMany(),
      psicologos: await tx.psicologo.findMany(),
    }));
    expect(vistoA.clinicas.map((c) => c.id)).toEqual([A]);
    expect(vistoA.psicologos.map((p) => p.email).sort()).toEqual(
      [emailVazio, emailA].sort(),
    );

    const vistoB = await tenant.run(B, (tx) => tx.psicologo.findMany());
    expect(vistoB.map((p) => p.email)).toEqual([emailB]);
  });

  it('WITH CHECK: insert de Psicologo com clinicaId de B sob contexto A falha', async () => {
    // createMany nao usa RETURNING: so o WITH CHECK pode barrar.
    await expect(
      tenant.run(A, (tx) =>
        tx.psicologo.createMany({
          data: [psicologo(B, `x-${sufixo}@teste.local`)],
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('WITH CHECK: insert de Clinica com id diferente do contexto falha', async () => {
    await expect(
      tenant.run(A, (tx) =>
        tx.clinica.createMany({
          data: [{ id: randomUUID(), nome: 'intrusa' }],
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('WITH CHECK: mover Psicologo de A para B sob contexto A falha', async () => {
    // App: clinicaId e coluna imutavel para o notta_app.
    await expect(
      tenant.run(A, (tx) =>
        tx.psicologo.updateMany({
          where: { email: emailA },
          data: { clinicaId: B },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    // Owner tem a coluna, mas a policy de UPDATE barra a linha nova, mesmo a propria.
    const { id } = await tenant.run(A, (tx) =>
      tx.psicologo.findFirstOrThrow({ where: { email: emailA } }),
    );
    const comoOwner = new TenantPrismaService(
      owner as unknown as PrismaService,
    );
    await expect(
      comoOwner.run(
        A,
        (tx) =>
          tx.psicologo.updateMany({ where: { id }, data: { clinicaId: B } }),
        { psicologoId: id },
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('UPDATE e DELETE sob contexto A em linhas de B afetam 0 linhas', async () => {
    const r = await tenant.run(A, async (tx) => ({
      upd: await tx.psicologo.updateMany({
        where: { clinicaId: B },
        data: { nome: 'hack' },
      }),
      updClinica: await tx.clinica.updateMany({
        where: { id: B },
        data: { nome: 'hack' },
      }),
      del: await tx.psicologo.deleteMany({ where: { clinicaId: B } }),
      delClinica: await tx.clinica.deleteMany({ where: { id: B } }),
    }));
    expect(r).toEqual({
      upd: { count: 0 },
      updClinica: { count: 0 },
      del: { count: 0 },
      delClinica: { count: 0 },
    });
    const b = await tenant.run(B, (tx) => tx.psicologo.findMany());
    expect(b.map((p) => p.nome)).toEqual(['Teste']);
  });

  it('contexto nao vaza na conexao do pool depois do run', async () => {
    await tenant.run(A, (tx) => tx.psicologo.findMany());
    expect(await app.psicologo.findMany()).toEqual([]);
    expect(await app.clinica.findMany()).toEqual([]);
    expect(['', null]).toContain(await setting(app, 'app.current_clinica_id'));
  });

  it('psicologoId entra em app.current_psicologo_id e some depois', async () => {
    const pid = randomUUID();
    const dentro = await tenant.run(
      A,
      (tx) => setting(tx, 'app.current_psicologo_id'),
      {
        psicologoId: pid,
      },
    );
    expect(dentro).toBe(pid);
    expect(['', null]).toContain(
      await setting(app, 'app.current_psicologo_id'),
    );
  });

  describe('login_lookup', () => {
    it('runLogin(email) ve so a linha desse e-mail, de qualquer clinica', async () => {
      const a = await tenant.runLogin(emailA, (tx) => tx.psicologo.findMany());
      expect(a.map((p) => [p.email, p.clinicaId])).toEqual([[emailA, A]]);
      const b = await tenant.runLogin(emailB, (tx) => tx.psicologo.findMany());
      expect(b.map((p) => [p.email, p.clinicaId])).toEqual([[emailB, B]]);
    });

    it('runLogin nao abre Clinica', async () => {
      expect(
        await tenant.runLogin(emailA, (tx) => tx.clinica.findMany()),
      ).toEqual([]);
    });

    it('e-mail inexistente = 0, sem runLogin = 0, runLogin("") = 0', async () => {
      expect(
        await tenant.runLogin(`nada-${sufixo}@teste.local`, (tx) =>
          tx.psicologo.findMany(),
        ),
      ).toEqual([]);
      expect(
        await app.psicologo.findMany({ where: { email: emailA } }),
      ).toEqual([]);
      expect(
        await tenant.runLogin('', (tx) => tx.psicologo.findMany()),
      ).toEqual([]);
    });

    it('runLogin so le: nao atualiza a linha encontrada', async () => {
      const r = await tenant.runLogin(emailA, (tx) =>
        tx.psicologo.updateMany({
          where: { email: emailA },
          data: { nome: 'hack' },
        }),
      );
      expect(r.count).toBe(0);
    });
  });

  describe('rollback', () => {
    it('run desfaz o que fez quando fn lanca e o contexto nao persiste', async () => {
      const email = `rb-${sufixo}@teste.local`;
      await expect(
        tenant.run(A, async (tx) => {
          await tx.psicologo.create({ data: psicologo(A, email) });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(
        await tenant.run(A, (tx) => tx.psicologo.count({ where: { email } })),
      ).toBe(0);
      expect(['', null]).toContain(
        await setting(app, 'app.current_clinica_id'),
      );
    });

    it('runLogin propaga o erro e o contexto de login nao persiste', async () => {
      await expect(
        tenant.runLogin(emailA, () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
      expect(['', null]).toContain(await setting(app, 'app.login_email'));
      expect(await app.psicologo.findMany()).toEqual([]);
    });
  });

  describe('papeis', () => {
    it('FORCE: notta_owner sem contexto tambem ve zero linhas', async () => {
      expect(await owner.psicologo.count()).toBe(0);
      expect(await owner.clinica.count()).toBe(0);
    });

    it('notta_app nao e dono: nao desliga RLS nem faz TRUNCATE', async () => {
      await expect(
        app.$executeRawUnsafe(
          'ALTER TABLE "Psicologo" DISABLE ROW LEVEL SECURITY',
        ),
      ).rejects.toThrow(/must be owner/);
      await expect(
        app.$executeRawUnsafe('TRUNCATE "Psicologo"'),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
