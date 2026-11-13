import { HttpClient, HttpContext, HttpContextToken, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

// Resposta de GET /eu e `usuario` do login (contrato.md). O papel vem fresco do banco a cada /eu.
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

// Requisicao que o interceptor nao tenta renovar nem trata como sessao expirada (a propria
// consulta de conferencia da renovacao, "sair").
export const SEM_RENOVAR = new HttpContextToken<boolean>(() => false);

// Web Locks: serializa a renovacao entre abas. Sem suporte (ou fora do navegador) = sem trava.
export const WEB_LOCKS = new InjectionToken<LockManager | null>('web-locks', {
  factory: () => (typeof navigator !== 'undefined' && navigator.locks) || null,
});

export type ResultadoRenovacao = 'ok' | 'expirou' | 'indisponivel';
const TRAVA = 'praxis-renovar-sessao';

// Estado da sessao = o que o servidor diz em GET /eu. A sessao em si vive em cookies httpOnly que o
// JS nao le: aqui nao ha token, nem em memoria nem em storage. `garantir()` consulta o /eu uma vez
// (401 = visitante, sem erro); guards esperam por ela.
@Injectable({ providedIn: 'root' })
export class SessaoStore {
  private readonly http = inject(HttpClient);
  private readonly locks = inject(WEB_LOCKS);
  private readonly _usuario = signal<Eu | null>(null);
  private readonly _expirada = signal(false);
  private consulta: Promise<void> | null = null;
  private renovacao: Promise<ResultadoRenovacao> | null = null;

  readonly usuario = this._usuario.asReadonly();
  readonly autenticado = computed(() => this._usuario() !== null);
  readonly ehAdmin = computed(() => this._usuario()?.papel === 'ADMIN');
  readonly senhaProvisoria = computed(() => this._usuario()?.senhaProvisoria === true);
  // A sessao caiu sozinha (acesso e renovacao falharam): o login avisa. Some ao entrar de novo.
  readonly expirada = this._expirada.asReadonly();

  // Primeira chamada consulta o /eu; as seguintes reaproveitam a resposta (ou a consulta em voo).
  garantir(): Promise<void> {
    return this.consulta ?? this.carregar();
  }

  // Refaz o /eu. 401 = sem sessao; outro erro (rede, 503) mantem o que ja se sabia.
  carregar(): Promise<void> {
    const consulta: Promise<void> = firstValueFrom(this.http.get<Eu>('/api/eu')).then(
      (eu) => {
        if (this.consulta === consulta) this._usuario.set(eu);
      },
      (e: HttpErrorResponse) => {
        if (this.consulta === consulta && e.status === 401) this._usuario.set(null);
      },
    );
    this.consulta = consulta;
    return consulta;
  }

  entrar(usuario: Eu): void {
    this.consulta = Promise.resolve();
    this._usuario.set(usuario);
    this._expirada.set(false);
  }

  // Trocou a senha provisoria: a sessao segue (o servidor reemite o acesso), so deixa de ser provisoria.
  senhaTrocada(): void {
    this._usuario.update((u) => (u ? { ...u, senhaProvisoria: false } : u));
  }

  limpar(): void {
    this.consulta = Promise.resolve();
    this._usuario.set(null);
  }

  expirou(): void {
    this.limpar();
    this._expirada.set(true);
  }

  // Sempre limpa o estado local, mesmo que o servidor nao responda: a pessoa pediu para sair.
  async sair(): Promise<void> {
    await firstValueFrom(
      this.http.post('/api/auth/sair', {}, { context: new HttpContext().set(SEM_RENOVAR, true) }),
    ).catch(() => undefined);
    this.limpar();
    this._expirada.set(false);
  }

  // Erro de verdade (rede, 5xx) sobe para a tela avisar: a sessao continua valendo no servidor.
  async sairDeTodos(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sair-de-todos', {}));
    this.limpar();
    this._expirada.set(false);
  }

  // Uma renovacao por vez: chamadas concorrentes da aba esperam a mesma; entre abas, o Web Lock.
  renovar(): Promise<ResultadoRenovacao> {
    if (this.renovacao) return this.renovacao;
    const locks = this.locks;
    const trabalho = async (): Promise<ResultadoRenovacao> =>
      locks ? await locks.request(TRAVA, () => this.renovarAgora()) : this.renovarAgora();
    const emVoo: Promise<ResultadoRenovacao> = trabalho().finally(() => {
      if (this.renovacao === emVoo) this.renovacao = null;
    });
    this.renovacao = emVoo;
    return emVoo;
  }

  private async renovarAgora(): Promise<ResultadoRenovacao> {
    // Outra aba pode ter renovado enquanto esperavamos a trava: se o acesso ja vale, nao rotaciona
    // de novo.
    const semRenovar = new HttpContext().set(SEM_RENOVAR, true);
    try {
      await firstValueFrom(this.http.get('/api/eu', { context: semRenovar }));
      return 'ok';
    } catch {
      // acesso vencido: renova de verdade
    }
    try {
      await firstValueFrom(this.http.post('/api/auth/renovar', null));
      return 'ok';
    } catch (e) {
      return (e as HttpErrorResponse).status === 401 ? 'expirou' : 'indisponivel';
    }
  }
}
