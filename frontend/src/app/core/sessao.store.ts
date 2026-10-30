import { Injectable, computed, signal } from '@angular/core';

const CHAVE = 'notta.token';

// Token JWT em sessionStorage: some ao fechar a aba. Cookie httpOnly = decisao futura do dono.
// Nunca logar o token.
@Injectable({ providedIn: 'root' })
export class SessaoStore {
  private readonly _token = signal<string | null>(sessionStorage.getItem(CHAVE));

  readonly token = this._token.asReadonly();
  readonly autenticado = computed(() => this._token() !== null);

  entrar(token: string): void {
    sessionStorage.setItem(CHAVE, token);
    this._token.set(token);
  }

  sair(): void {
    sessionStorage.removeItem(CHAVE);
    this._token.set(null);
  }
}
