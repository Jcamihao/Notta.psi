import { Papel, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

// So para teste: operacoes que o praxis_app NAO pode fazer (mudar papel, apagar
// Psicologo/Clinica). Vao como praxis_owner, que tambem passa pelo FORCE RLS: precisa
// da clinica (e, para UPDATE em Psicologo, do proprio id) no contexto.
export async function comoOwner<T>(
  clinicaId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opcoes?: { psicologoId?: string },
): Promise<T> {
  if (!process.env.DATABASE_URL_OWNER) {
    throw new Error(
      'DATABASE_URL_OWNER ausente: este teste usa o papel praxis_owner (ver backend/README.md)',
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

// Limpeza das suites: o praxis_app nao tem DELETE em Psicologo, Clinica, Paciente, Documento, Auditoria nem Consentimento.
export async function apagarClinicas(ids: string[]) {
  for (const id of ids) {
    // Pedidos de transferencia (item 67): FK RESTRICT para Psicologo e sem DELETE para o app. Saem antes
    // dos psicologos, com o desvio de limpeza da suite (trigger pedido_transferencia_barreira).
    // O RLS de SELECT vale para DELETE: o contexto e o do ADMIN (ele ve todos os pedidos da clinica).
    const admin = await comoOwner(id, (tx) =>
      tx.psicologo.findFirst({
        where: { clinicaId: id, papel: 'ADMIN' },
        select: { id: true },
      }),
    );
    if (admin) {
      await comoOwner(
        id,
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.limpeza_de_teste', '1', true)`;
          await tx.pedidoTransferencia.deleteMany({ where: { clinicaId: id } });
        },
        { psicologoId: admin.id },
      );
    }
    // Paciente (FK RESTRICT, sem DELETE para o app): o owner apaga sob a policy, que exige o
    // psicologo no contexto, entao um psicologo por vez.
    const psicologos = await comoOwner(id, (tx) =>
      tx.psicologo.findMany({ where: { clinicaId: id }, select: { id: true } }),
    );
    for (const { id: psicologoId } of psicologos) {
      await comoOwner(
        id,
        async (tx) => {
          // Auditoria e Consentimento sao somente-acrescentar: so o DONO apaga, e so com este
          // desvio EXPLICITO na transacao (triggers *_somente_acrescentar). O praxis_app nao tem
          // como. Consentimento (filha) antes de Paciente (FK RESTRICT).
          await tx.$executeRaw`SELECT set_config('app.limpeza_de_teste', '1', true)`;
          await tx.consentimento.deleteMany({ where: { psicologoId } });
          // Convite de consentimento (item 22): Consentimento aponta para ele (FK RESTRICT), entao
          // sai depois do Consentimento e antes de Paciente.
          await tx.conviteConsentimento.deleteMany({ where: { psicologoId } });
          // Documento (filha de Paciente, sem DELETE para o app): so o dono apaga, sob a policy. Aprovado
          // so sai com o desvio acima (trigger documento_imutavel).
          // GeracaoIa (pedido de IA) aponta para Documento (FK RESTRICT): sai antes.
          await tx.geracaoIa.deleteMany({ where: { psicologoId } });
          await tx.documento.deleteMany({ where: { psicologoId } });
          await tx.paciente.deleteMany({ where: { psicologoId } });
          // Sessao (item 46): FK RESTRICT para Psicologo, sem DELETE para o app.
          await tx.sessao.deleteMany({ where: { psicologoId } });
          await tx.auditoria.deleteMany({ where: { psicologoId } });
        },
        { psicologoId },
      );
    }
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
