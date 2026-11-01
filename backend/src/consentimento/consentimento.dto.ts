import { IsIn } from 'class-validator';

export const EVENTOS = ['CONCEDIDO', 'REVOGADO'] as const;
export type Evento = (typeof EVENTOS)[number];

// So o evento. Termo, versao, seq, clinica e psicologo nunca vem do cliente (campo extra = 400).
export class RegistrarConsentimentoDto {
  @IsIn(EVENTOS)
  evento!: Evento;
}
