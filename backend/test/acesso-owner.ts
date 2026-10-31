import { Papel, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

// So para teste: operacoes que o notta_app NAO pode fazer (mudar papel, apagar
// Psicologo/Clinica). Vao como notta_owner, que tambem passa pelo FORCE RLS: precisa
// da clinica (e, para UPDATE em Psicologo, do proprio id) no contexto.
export async function comoOwner<T>(
  clinicaId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opcoes?: { psicologoId?: string },
): Promise<T> {
  if (!process.env.DATABASE_URL_OWNER) {
    throw new Error(
      'DATABASE_URL_OWNER ausente: este teste usa o papel notta_owner (ver backend/README.md)',
    );
  }
  const owner = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_OWNER } },
  });
  try {
    return await new TenantPrismaService(owner as unknown as PrismaService).run(
      clinicaId,
      fn,
      opcoes,
    );
  } finally {
    await owner.$disconnect();
  }
}

export async function mudarPapelComoOwner(
  clinicaId: string,
  psicologoId: string,
  papel: Papel,
) {
  const r = await comoOwner(
    clinicaId,
    (tx) =>
      tx.psicologo.updateMany({
        where: { id: psicologoId, clinicaId },
        data: { papel },
      }),
    { psicologoId },
  );
  if (r.count !== 1) throw new Error('papel nao mudou');
}

// Limpeza das suites: o notta_app nao tem DELETE em Psicologo nem em Clinica.
export async function apagarClinicas(ids: string[]) {
  for (const id of ids) {
    await comoOwner(id, async (tx) => {
      await tx.psicologo.deleteMany({ where: { clinicaId: id } });
      await tx.clinica.deleteMany({ where: { id } });
    });
  }
}

// DDL de teste (tabela com FK para Psicologo) com lock_timeout: se outra sessao segura
// Psicologo, falha em 3 s em vez de entrar na fila do lock e travar todo mundo atras.
export function ddl(owner: PrismaClient, sql: string) {
  return owner.$transaction([
    owner.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`),
    owner.$executeRawUnsafe(sql),
  ]);
}
