import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

// Corpo das respostas de /pacientes/:id/documentos (contrato.md, item 12).
export type TipoDocumento = 'NOTA_BRUTA' | 'EVOLUCAO' | 'ANAMNESE';
export type StatusDocumento = 'RASCUNHO' | 'APROVADO';

// Lista: so metadados (o texto nunca vem na lista).
export interface DocumentoResumo {
  id: string;
  tipo: TipoDocumento;
  dataSessao: string | null;
  status: StatusDocumento;
  criadoEm: string;
}

export interface Documento extends DocumentoResumo {
  pacienteId: string;
  conteudo: string;
  atualizadoEm: string;
}

export interface NovoDocumento {
  tipo: TipoDocumento;
  dataSessao?: string;
  conteudo: string;
}

export const LIMITE_CONTEUDO = 20000;

export const ROTULO_TIPO: Record<TipoDocumento, string> = {
  NOTA_BRUTA: 'Nota bruta',
  EVOLUCAO: 'Evolução',
  ANAMNESE: 'Anamnese',
};
// Pill sempre leva texto: cor nunca e a unica pista.
export const ROTULO_STATUS: Record<StatusDocumento, string> = {
  RASCUNHO: 'Rascunho',
  APROVADO: 'Aprovado',
};
export const TOM_STATUS: Record<StatusDocumento, 'pink' | 'blue' | 'yellow'> = {
  RASCUNHO: 'yellow',
  APROVADO: 'blue',
};

@Injectable({ providedIn: 'root' })
export class DocumentosService {
  private readonly http = inject(HttpClient);

  private url(pacienteId: string): string {
    return `/api/pacientes/${pacienteId}/documentos`;
  }

  criar(pacienteId: string, corpo: NovoDocumento) {
    return this.http.post<Documento>(this.url(pacienteId), corpo);
  }

  listar(pacienteId: string) {
    return this.http.get<DocumentoResumo[]>(this.url(pacienteId));
  }

  obter(pacienteId: string, id: string) {
    return this.http.get<Documento>(`${this.url(pacienteId)}/${id}`);
  }
}
