import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { SessaoStore } from './sessao.store';

// Resposta de GET /eu (contrato.md). O papel vem fresco do banco a cada chamada.
export interface Eu {
  psicologoId: string;
  nome: string;
  email: string;
  papel: 'ADMIN' | 'PSICOLOGO';
  abordagemPadrao: string;
  clinica: { id: string; nome: string };
}

// Segue o token: entrou ou restaurou a sessao -> busca /eu; saiu -> limpa.
// 401 no /eu derruba a sessao pelo interceptor, e o efeito limpa o usuario.
@Injectable({ providedIn: 'root' })
export class UsuarioStore {
  private readonly http = inject(HttpClient);
  private readonly sessao = inject(SessaoStore);
  private readonly _usuario = signal<Eu | null>(null);

  readonly usuario = this._usuario.asReadonly();

  constructor() {
    effect((onCleanup) => {
      this._usuario.set(null);
      if (!this.sessao.token()) return;
      const sub = this.http.get<Eu>('/api/eu').subscribe({
        next: (eu) => this._usuario.set(eu),
        error: () => undefined,
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  sair(): void {
    this._usuario.set(null);
    this.sessao.sair();
  }
}
