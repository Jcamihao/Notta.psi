import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

// Corpo das respostas de /pacientes/:id/documentos (contrato.md, itens 12, 14, 15 e 16).
export type TipoDocumento = 'NOTA_BRUTA' | 'EVOLUCAO' | 'ANAMNESE';
export type StatusDocumento = 'RASCUNHO' | 'APROVADO';

// Lista: so metadados (o texto nunca vem na lista).
export interface DocumentoResumo {
  id: string;
  tipo: TipoDocumento;
  dataSessao: string | null;
  status: StatusDocumento;
  criadoEm: string;
  aprovadoEm: string | null;
  // Id do aprovado que este documento corrige (item 15); null se nao e correcao.
  substituiId: string | null;
  // Rascunho criado pela IA (itens 20 e 21): marca fixa, nunca muda.
  geradoPorIa: boolean;
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
  substituiId?: string;
}

// PATCH parcial (item 14): so o que mudou; dataSessao null apaga a data.
export interface AtualizacaoDocumento {
  conteudo?: string;
  dataSessao?: string | null;
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

  // Sempre com filtro: o detalhe do paciente mostra prontuario (APROVADO) e rascunhos separados.
  listar(pacienteId: string, status: StatusDocumento) {
    return this.http.get<DocumentoResumo[]>(this.url(pacienteId), { params: { status } });
  }

  obter(pacienteId: string, id: string) {
    return this.http.get<Documento>(`${this.url(pacienteId)}/${id}`);
  }

  atualizar(pacienteId: string, id: string, corpo: AtualizacaoDocumento) {
    return this.http.patch<Documento>(`${this.url(pacienteId)}/${id}`, corpo);
  }

  aprovar(pacienteId: string, id: string) {
    return this.http.post<Documento>(`${this.url(pacienteId)}/${id}/aprovar`, null);
  }
}
