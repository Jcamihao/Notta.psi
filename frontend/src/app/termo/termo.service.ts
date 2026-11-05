import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

// Rotas PUBLICAS do termo (contrato.md, item 22): sem sessao, o token do link e a credencial.
// Nunca devolvem dado do paciente. O token so passa por aqui para o caminho da requisicao.
export interface TermoPublico {
  clinica: string;
  psicologo: string;
  termo: { versao: string; texto: string };
  expiraEm: string;
}

@Injectable({ providedIn: 'root' })
export class TermoService {
  private readonly http = inject(HttpClient);

  private url(token: string): string {
    return `/api/publico/consentimento/${encodeURIComponent(token)}`;
  }

  abrir(token: string) {
    return this.http.get<TermoPublico>(this.url(token));
  }

  aceitar(token: string) {
    return this.http.post<{ ok: true }>(`${this.url(token)}/aceitar`, { aceito: true });
  }

  recusar(token: string) {
    return this.http.post<{ ok: true }>(`${this.url(token)}/recusar`, {});
  }
}
