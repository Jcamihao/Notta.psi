import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';

// Valores fixos (a coluna e text, a validacao e aqui). Recurso novo = entrada nova + teste.
export const ACOES = ['CRIOU', 'LEU', 'LISTOU', 'EDITOU'] as const;
export const RECURSOS = ['Paciente'] as const;
export type AcaoAuditoria = (typeof ACOES)[number];
export type RecursoAuditado = (typeof RECURSOS)[number];

// Trilha: QUEM (psicologo do token) fez O QUE em QUE recurso. NUNCA recebe nem grava valor de
// campo, nome, texto clinico nem IP: so ids e constantes.
@Injectable()
export class AuditoriaService {
  // Grava DENTRO da transacao `tx` da acao auditada (falha fechada: se a trilha falhar, a acao
  // inteira desfaz). Sem fila, sem fire-and-forget. clinicaId/psicologoId sempre do `user`.
  async registrar(
    tx: Prisma.TransactionClient,
    user: Pick<UsuarioAutenticado, 'clinicaId' | 'psicologoId'>,
    acao: AcaoAuditoria,
    recurso: RecursoAuditado,
    recursoId?: string,
  ): Promise<void> {
    if (!ACOES.includes(acao) || !RECURSOS.includes(recurso)) {
      throw new Error('auditoria: acao ou recurso invalido');
    }
    await tx.auditoria.create({
      data: {
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
        acao,
        recurso,
        recursoId: recursoId ?? null,
      },
    });
  }
}
