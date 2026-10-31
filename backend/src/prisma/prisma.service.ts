import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { validarEnv } from '../env';

type PapelRuntime = { superuser: boolean; bypassrls: boolean; dono: boolean };

// Superuser, BYPASSRLS ou dono (ou membro do dono) das tabelas desliga o isolamento por
// clinica sem aviso nenhum. Falha fechada no boot. Mensagem sem a URL nem o nome do papel.
export function conferirPapelRuntime(linha: PapelRuntime | undefined): void {
  const problemas = !linha
    ? ['nao foi encontrado em pg_roles']
    : [
        linha.superuser && 'e superuser',
        linha.bypassrls && 'tem BYPASSRLS',
        linha.dono && 'e dono (ou membro do dono) de Clinica/Psicologo',
      ].filter(Boolean);
  if (problemas.length) {
    throw new Error(
      `DATABASE_URL insegura: o papel de runtime ${problemas.join(', ')}. ` +
        'Use notta_app (sem superuser, sem BYPASSRLS, nao dono das tabelas).',
    );
  }
}

// Conecta como notta_app (DATABASE_URL): sem superuser, sujeito a RLS. Conferido no boot.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    validarEnv();
    super();
  }

  async onModuleInit() {
    await this.$connect();
    const [linha] = await this.$queryRaw<PapelRuntime[]>`
      SELECT r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
        EXISTS (
          SELECT 1 FROM pg_tables t
          WHERE t.schemaname = current_schema()
            AND t.tablename IN ('Clinica', 'Psicologo')
            AND pg_has_role(current_user, t.tableowner, 'MEMBER')
        ) AS dono
      FROM pg_roles r WHERE r.rolname = current_user`;
    try {
      conferirPapelRuntime(linha);
    } catch (e) {
      await this.$disconnect();
      throw e;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
