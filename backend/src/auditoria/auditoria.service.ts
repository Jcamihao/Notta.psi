import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { UsuarioAutenticado } from '../auth/jwt-auth.guard';

// Valores fixos (a coluna e text, a validacao e aqui). Recurso novo = entrada nova + teste.
export const ACOES = [
  'CRIOU',
  'LEU',
  'LISTOU',
  'EDITOU',
  'APROVOU',
  'CONCEDEU',
  'REVOGOU',
  'DESATIVOU',
  'PREVIA_IA',
  'ENVIOU_IA',
  'CRIOU_CONVITE',
  'CANCELOU_CONVITE',
  'PACIENTE_ACEITOU_TERMO',
  'PACIENTE_RECUSOU_TERMO',
  'REFRESH_REUSADO',
  'SAIU_DE_TODOS',
] as const;
export const RECURSOS = [
  'Paciente',
  'Consentimento',
  'Documento',
  'Psicologo',
  'GeracaoIa',
  'ConviteConsentimento',
  'Sessao',
] as const;
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
