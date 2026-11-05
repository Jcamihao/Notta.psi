// UNICO lugar do codigo com set_config. Contexto de tenant = transacao interativa com
// set_config LOCAL (is_local = true): some no COMMIT/ROLLBACK e nao vaza para a proxima
// requisicao que pegar a mesma conexao do pool.
// Dentro de `fn`: so banco via `tx`. Sem I/O de rede (segura a conexao e estoura o timeout
// de 5 s) e sem `run`/`runLogin` aninhado (abriria outra transacao, sem o contexto).
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from './prisma.service';

type Fn<T> = (tx: Prisma.TransactionClient) => Promise<T>;

const OPCOES_TX = { timeout: 5000, maxWait: 2000 };

@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(
    clinicaId: string,
    fn: Fn<T>,
    opcoes?: { psicologoId?: string },
  ): Promise<T> {
    // Valida antes de tocar o banco. A mensagem nao ecoa o valor.
    if (!isUUID(clinicaId))
      return Promise.reject(new Error('clinicaId invalido'));
    const psicologoId = opcoes?.psicologoId;
    if (psicologoId !== undefined && !isUUID(psicologoId)) {
      return Promise.reject(new Error('psicologoId invalido'));
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.current_clinica_id', ${clinicaId}, true)`;
      if (psicologoId !== undefined) {
        await tx.$queryRaw`SELECT set_config('app.current_psicologo_id', ${psicologoId}, true)`;
      }
      return fn(tx);
    }, OPCOES_TX);
  }

  // Atalho para dado clinico com dono (policy psicologo_proprio, docs/ACESSO.md):
  // clinica E psicologo do usuario logado no contexto.
  runComoUsuario<T>(
    user: { clinicaId: string; psicologoId: string },
    fn: Fn<T>,
  ): Promise<T> {
    return this.run(user.clinicaId, fn, { psicologoId: user.psicologoId });
  }

  // Fluxo PUBLICO do convite de consentimento (item 22): o paciente nao tem login. A transacao
  // abre a policy `convite_por_token` com o SHA-256 do token (so a linha desse hash). Para gravar
  // o evento e a trilha em nome do dono, `fn` chama `assumirDono` com a clinica e o psicologo LIDOS
  // DO CONVITE (nunca do cliente): so entao valem as policies de clinica/psicologo. Mesmas regras
  // de `run`: so banco dentro de `fn`, sem rede e sem transacao aninhada.
  runConvite<T>(
    tokenHash: string,
    fn: (
      tx: Prisma.TransactionClient,
      assumirDono: (dono: {
        clinicaId: string;
        psicologoId: string;
      }) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    if (!/^[0-9a-f]{64}$/.test(tokenHash)) {
      return Promise.reject(new Error('tokenHash invalido'));
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.convite_hash', ${tokenHash}, true)`;
      const assumirDono = async (dono: {
        clinicaId: string;
        psicologoId: string;
      }) => {
        if (!isUUID(dono.clinicaId) || !isUUID(dono.psicologoId)) {
          throw new Error('dono do convite invalido');
        }
        await tx.$queryRaw`SELECT set_config('app.current_clinica_id', ${dono.clinicaId}, true)`;
        await tx.$queryRaw`SELECT set_config('app.current_psicologo_id', ${dono.psicologoId}, true)`;
      };
      return fn(tx, assumirDono);
    }, OPCOES_TX);
  }

  // So para o login: abre a policy login_lookup (SELECT em Psicologo pelo e-mail).
  // O e-mail ja chega normalizado (trim + lowercase) por quem chama.
  runLogin<T>(email: string, fn: Fn<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.login_email', ${email}, true)`;
      return fn(tx);
    }, OPCOES_TX);
  }
}
