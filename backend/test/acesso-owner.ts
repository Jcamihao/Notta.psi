import { Papel, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

// So para teste: muda o papel direto no banco. O notta_app nao pode (papel e
// coluna imutavel para ele), entao vai como notta_owner, que tambem passa pelo
// FORCE RLS: precisa da clinica e do proprio id no contexto.
export async function mudarPapelComoOwner(
  clinicaId: string,
  psicologoId: string,
  papel: Papel,
) {
  if (!process.env.DATABASE_URL_OWNER) {
    throw new Error(
      'DATABASE_URL_OWNER ausente: este teste muda papel como notta_owner (ver backend/README.md)',
    );
  }
  const owner = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_OWNER } },
  });
  try {
    const r = await new TenantPrismaService(
      owner as unknown as PrismaService,
    ).run(
      clinicaId,
      (tx) =>
        tx.psicologo.updateMany({
          where: { id: psicologoId, clinicaId },
          data: { papel },
        }),
      { psicologoId },
    );
    if (r.count !== 1) throw new Error('papel nao mudou');
  } finally {
    await owner.$disconnect();
  }
}
