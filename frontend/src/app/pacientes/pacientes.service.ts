import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

// Corpo das respostas de /pacientes (contrato.md, item 9).
export interface Paciente {
  id: string;
  nome: string;
  nascimento: string | null;
  telefone: string | null;
  email: string | null;
  criadoEm: string;
}

export interface NovoPaciente {
  nome: string;
  nascimento?: string;
  telefone?: string;
  email?: string;
}

// No PATCH, null limpa o campo opcional.
export interface AtualizacaoPaciente {
  nome: string;
  nascimento: string | null;
  telefone: string | null;
  email: string | null;
}

@Injectable({ providedIn: 'root' })
export class PacientesService {
  private readonly http = inject(HttpClient);

  listar() {
    return this.http.get<Paciente[]>('/api/pacientes');
  }

  obter(id: string) {
    return this.http.get<Paciente>(`/api/pacientes/${id}`);
  }

  criar(corpo: NovoPaciente) {
    return this.http.post<Paciente>('/api/pacientes', corpo);
  }

  atualizar(id: string, corpo: AtualizacaoPaciente) {
    return this.http.patch<Paciente>(`/api/pacientes/${id}`, corpo);
  }
}
