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
  'EXCLUIU',
  'EXPORTOU',
  // Descarte automatico de rascunho vencido (comando `npm run descartar`, item 52A). Gravado pela
  // funcao descartar_rascunhos_vencidos no banco, na mesma transacao do DELETE.
  'DESCARTOU',
  // Transferencia de pacientes (item 67). ATOR: PEDIU/CANCELOU = ADMIN; ACEITOU/RECUSOU/TRANSFERIU/
  // TRANSFERIU_PACIENTES/RECEBEU_PACIENTES = o DESTINO (quem executa o lote).
  'PEDIU_TRANSFERENCIA',
  'CANCELOU_TRANSFERENCIA',
  'ACEITOU_TRANSFERENCIA',
  'RECUSOU_TRANSFERENCIA',
  'TRANSFERIU',
  'TRANSFERIU_PACIENTES',
  'RECEBEU_PACIENTES',
] as const;
export const RECURSOS = [
  'Paciente',
  'Consentimento',
  'Documento',
  'Psicologo',
  'GeracaoIa',
  'ConviteConsentimento',
  'Sessao',
  'PedidoTransferencia',
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
