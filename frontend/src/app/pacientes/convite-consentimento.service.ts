import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

// Corpo das rotas /pacientes/:id/convites-consentimento (contrato.md, item 22).
export type EstadoConvite = 'PENDENTE' | 'ACEITO' | 'RECUSADO' | 'CANCELADO';

export interface Convite {
  id: string;
  estado: EstadoConvite;
  // Derivado no servidor: PENDENTE com a validade no passado.
  expirado: boolean;
  criadoEm: string;
  expiraEm: string;
  usadoEm: string | null;
  termoVersao: string;
}

// O link vem so nesta resposta, uma vez: a lista nunca traz token.
export interface ConviteCriado {
  id: string;
  link: string;
  expiraEm: string;
}

export type RotuloConvite = 'Pendente' | 'Aceito' | 'Recusado' | 'Cancelado' | 'Expirado';

// "Expirado" nao e estado do banco: sai de PENDENTE + expirado. A pill sempre leva texto.
export function rotuloConvite(c: Pick<Convite, 'estado' | 'expirado'>): RotuloConvite {
  if (c.estado === 'PENDENTE') return c.expirado ? 'Expirado' : 'Pendente';
  if (c.estado === 'ACEITO') return 'Aceito';
  if (c.estado === 'RECUSADO') return 'Recusado';
  return 'Cancelado';
}

export const TOM_CONVITE: Record<RotuloConvite, 'pink' | 'blue' | 'yellow'> = {
  Pendente: 'yellow',
  Aceito: 'blue',
  Recusado: 'pink',
  Cancelado: 'yellow',
  Expirado: 'yellow',
};

// So um convite pendente e ainda valido mantem a consulta periodica e o botao "Cancelar".
export const convitePendenteVivo = (c: Pick<Convite, 'estado' | 'expirado'>): boolean =>
  c.estado === 'PENDENTE' && !c.expirado;

@Injectable({ providedIn: 'root' })
export class ConviteConsentimentoService {
  private readonly http = inject(HttpClient);

  private url(pacienteId: string): string {
    return `/api/pacientes/${pacienteId}/convites-consentimento`;
  }

  criar(pacienteId: string) {
    return this.http.post<ConviteCriado>(this.url(pacienteId), {});
  }

  listar(pacienteId: string) {
    return this.http.get<Convite[]>(this.url(pacienteId));
  }

  cancelar(pacienteId: string, id: string) {
    return this.http.post<{ id: string; estado: 'CANCELADO' }>(
      `${this.url(pacienteId)}/${id}/cancelar`,
      {},
    );
  }
}
