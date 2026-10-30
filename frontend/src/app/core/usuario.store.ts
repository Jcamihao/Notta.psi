import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
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
// `pronto`: o /eu do token atual ja respondeu (ok ou erro), ou nao ha sessao. Guards esperam por ele.
@Injectable({ providedIn: 'root' })
export class UsuarioStore {
  private readonly http = inject(HttpClient);
  private readonly sessao = inject(SessaoStore);
  private readonly _usuario = signal<Eu | null>(null);
  private readonly respondido = signal<string | null>(null);

  readonly usuario = this._usuario.asReadonly();
  readonly ehAdmin = computed(() => this._usuario()?.papel === 'ADMIN');
  readonly pronto = computed(() => {
    const token = this.sessao.token();
    return !token || this.respondido() === token;
  });

  constructor() {
    effect((onCleanup) => {
      this._usuario.set(null);
      const token = this.sessao.token();
      if (!token) return;
      const sub = this.http.get<Eu>('/api/eu').subscribe({
        next: (eu) => {
          this._usuario.set(eu);
          this.respondido.set(token);
        },
        error: () => this.respondido.set(token),
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  sair(): void {
    this._usuario.set(null);
    this.sessao.sair();
  }
}
