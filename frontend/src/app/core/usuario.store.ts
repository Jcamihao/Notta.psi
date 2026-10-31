import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { SessaoStore } from './sessao.store';

// Resposta de GET /eu (contrato.md). O papel vem fresco do banco a cada chamada.
export interface Eu {
  psicologoId: string;
  nome: string;
  email: string;
  papel: 'ADMIN' | 'PSICOLOGO';
  abordagemPadrao: string;
  clinica: { id: string; nome: string };
  // true so para quem foi criado pelo ADMIN e ainda nao trocou a senha (item 62).
  senhaProvisoria: boolean;
}

// Segue o token: entrou ou restaurou a sessao -> busca /eu; saiu -> limpa. Token novo (troca de
// senha) busca de novo. `recarregar()` refaz o /eu com o mesmo token (403 de senha provisoria).
// 401 no /eu derruba a sessao pelo interceptor, e o efeito limpa o usuario.
// `pronto`: o /eu do token atual ja respondeu (ok ou erro), ou nao ha sessao. Guards esperam por ele.
@Injectable({ providedIn: 'root' })
export class UsuarioStore {
  private readonly http = inject(HttpClient);
  private readonly sessao = inject(SessaoStore);
  // Zera quando o token muda (outra pessoa ou sessao nova); recarregar mantem o atual na tela.
  private readonly _usuario = linkedSignal<string | null, Eu | null>({
    source: this.sessao.token,
    computation: () => null,
  });
  private readonly respondido = signal<string | null>(null);
  private readonly recarga = signal(0);

  readonly usuario = this._usuario.asReadonly();
  readonly ehAdmin = computed(() => this._usuario()?.papel === 'ADMIN');
  readonly senhaProvisoria = computed(() => this._usuario()?.senhaProvisoria === true);
  readonly pronto = computed(() => {
    const token = this.sessao.token();
    return !token || this.respondido() === token;
  });

  constructor() {
    effect((onCleanup) => {
      const token = this.sessao.token();
      this.recarga();
      this.respondido.set(null);
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

  recarregar(): void {
    this.recarga.update((n) => n + 1);
  }

  sair(): void {
    this._usuario.set(null);
    this.sessao.sair();
  }
}
