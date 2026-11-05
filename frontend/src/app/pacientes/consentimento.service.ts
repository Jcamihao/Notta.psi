import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

// Corpo das respostas de /pacientes/:id/consentimento (contrato.md, item 10).
export type EstadoConsentimento = 'NENHUM' | 'CONCEDIDO' | 'REVOGADO';
export type EventoConsentimento = 'CONCEDIDO' | 'REVOGADO';

// Quem gerou o evento: o paciente (aceite por link, item 22) ou o psicologo (registro manual).
export type OrigemConsentimento = 'PSICOLOGO' | 'PACIENTE';

export interface EventoHistorico {
  seq: number;
  evento: EventoConsentimento;
  termoVersao: string;
  origem: OrigemConsentimento;
  em: string;
}

export interface Consentimento {
  estado: EstadoConsentimento;
  desde: string | null;
  historico: EventoHistorico[];
}

// Texto e cor do estado (lista e cartao). A pill sempre leva texto: cor nunca e a unica pista.
export const ROTULO_CONSENTIMENTO: Record<EstadoConsentimento, string> = {
  NENHUM: 'Não registrado',
  CONCEDIDO: 'Concedido',
  REVOGADO: 'Revogado',
};
export const TOM_CONSENTIMENTO: Record<EstadoConsentimento, 'pink' | 'blue' | 'yellow'> = {
  NENHUM: 'yellow',
  CONCEDIDO: 'blue',
  REVOGADO: 'pink',
};

@Injectable({ providedIn: 'root' })
export class ConsentimentoService {
  private readonly http = inject(HttpClient);

  obter(pacienteId: string) {
    return this.http.get<Consentimento>(`/api/pacientes/${pacienteId}/consentimento`);
  }

  registrar(pacienteId: string, evento: EventoConsentimento) {
    return this.http.post<Consentimento>(`/api/pacientes/${pacienteId}/consentimento`, { evento });
  }
}
