import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  CircleCheck,
  House,
  KeyRound,
  LogOut,
  LucideAngularModule,
  Menu,
  MonitorOff,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-angular';
import { filter, map } from 'rxjs';
import { SessaoStore } from '../core/sessao.store';
import { AvatarComponent } from '../ui/avatar.component';
import { IconButtonComponent } from '../ui/icon-button.component';
import { NavItemComponent } from '../ui/nav-item.component';

// Sidebar escura flutuante do design system (196px, raio 18). Abaixo de 832px vira barra
// superior com menu recolhivel (botao com aria-expanded). Com senha provisoria nao ha
// navegacao: sobra o logo e o Sair (o guard trava as rotas do mesmo jeito).
@Component({
  selector: 'app-shell',
  host: { '(document:keydown.escape)': 'escape()' },
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideAngularModule,
    AvatarComponent,
    IconButtonComponent,
    NavItemComponent,
  ],
  template: `
    <header class="lateral" [class.aberto]="menuAberto()" [class.sem-menu]="obrigatoria()">
      <div class="lateral-topo">
        @if (obrigatoria()) {
          <span class="marca">Notta.psi</span>
        } @else {
          <a class="marca" routerLink="/">Notta.psi</a>
          <button
            #alternar
            app-icon-button
            type="button"
            class="lateral-alternar"
            tone="accent"
            aria-label="Menu"
            aria-controls="lateral-corpo"
            [attr.aria-expanded]="menuAberto()"
            [icon]="menuAberto() ? icones.X : icones.Menu"
            (click)="menuAberto.set(!menuAberto())"
          ></button>
        }
      </div>
      <div class="lateral-corpo" id="lateral-corpo">
        @if (!obrigatoria()) {
          <nav aria-label="Principal">
            <a
              app-nav-item
              routerLink="/"
              routerLinkActive
              [routerLinkActiveOptions]="{ exact: true }"
              ariaCurrentWhenActive="page"
              [icon]="icones.House"
            >
              Início
            </a>
            <a
              app-nav-item
              routerLink="/pacientes"
              routerLinkActive
              ariaCurrentWhenActive="page"
              [icon]="icones.UserRound"
            >
              Pacientes
            </a>
            @if (ehAdmin()) {
              <a
                app-nav-item
                routerLink="/equipe"
                routerLinkActive
                ariaCurrentWhenActive="page"
                [icon]="icones.Users"
              >
                Equipe
              </a>
            }
            <a
              app-nav-item
              routerLink="/trocar-senha"
              routerLinkActive
              ariaCurrentWhenActive="page"
              [icon]="icones.KeyRound"
            >
              Trocar senha
            </a>
            <a
              app-nav-item
              routerLink="/seguranca"
              routerLinkActive
              ariaCurrentWhenActive="page"
              [icon]="icones.ShieldCheck"
            >
              Segurança
            </a>
          </nav>
        }
        <div class="lateral-rodape">
          @if (usuario(); as u) {
            <div class="quem">
              <app-avatar [name]="u.nome" [size]="32" />
              <div class="quem-texto">
                <span class="quem-nome">{{ u.nome }}</span>
                <span class="quem-clinica">{{ u.clinica.nome }}</span>
              </div>
            </div>
          }
          @if (confirmandoTodos()) {
            <div class="confirma" role="group" aria-labelledby="confirma-titulo">
              <p id="confirma-titulo">
                Sair de todos os aparelhos? Você precisará entrar de novo em cada um.
              </p>
              <p class="confirma-erro" role="alert" data-teste="erro-sair-todos">
                @if (erroTodos()) {
                  Não deu para sair agora. Tente de novo.
                }
              </p>
              <div class="confirma-acoes">
                <button
                  #cancelar
                  type="button"
                  class="acao acao-neutra"
                  data-teste="cancelar-sair-todos"
                  (click)="cancelarSairTodos()"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="acao"
                  data-teste="confirmar-sair-todos"
                  [disabled]="saindoTodos()"
                  (click)="sairDeTodos()"
                >
                  {{ saindoTodos() ? 'Saindo…' : 'Sair de todos' }}
                </button>
              </div>
            </div>
          } @else {
            <button
              #pedir
              app-nav-item
              type="button"
              data-teste="sair-todos"
              [icon]="icones.MonitorOff"
              (click)="pedirSairTodos()"
            >
              Sair de todos os aparelhos
            </button>
          }
          <button
            app-nav-item
            type="button"
            data-teste="sair"
            [icon]="icones.LogOut"
            (click)="sair()"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
    <main class="shell-conteudo">
      <div aria-live="polite">
        @if (senhaTrocada()) {
          <p class="aviso-ok" data-teste="senha-trocada">
            <lucide-icon [img]="icones.CircleCheck" [size]="18" [strokeWidth]="1.5" />
            Senha alterada. Use a nova senha no próximo acesso.
          </p>
        }
      </div>
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
      align-content: start;
      gap: 36px;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 22px 24px;
    }
    .lateral {
      position: sticky;
      top: 22px;
      align-self: start;
      display: flex;
      flex-direction: column;
      height: calc(100dvh - 44px);
      padding: 22px;
      color: var(--text-inverse);
      background: var(--bg-sidebar);
      border-radius: var(--radius-panel);
    }
    .lateral :focus-visible {
      outline-color: var(--pink-300);
    }
    .lateral-alternar {
      display: none;
    }
    .lateral-corpo {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-9);
      min-height: 0;
      margin-top: 40px;
    }
    nav {
      display: grid;
      gap: var(--space-3);
    }
    .lateral-rodape {
      display: grid;
      gap: var(--space-6);
      margin-top: auto;
    }
    .quem {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      min-width: 0;
    }
    .quem-texto {
      display: grid;
      min-width: 0;
    }
    .quem-nome {
      font-weight: var(--fw-medium);
      overflow-wrap: anywhere;
    }
    .quem-clinica {
      color: var(--text-sidebar-label);
      font-size: var(--fs-day);
      overflow-wrap: anywhere;
    }
    .confirma {
      display: grid;
      gap: var(--space-3);
      padding: var(--space-5);
      background: var(--ink-700);
      border-radius: var(--radius-card);
      font-size: var(--fs-day);
      line-height: var(--lh-body);
    }
    .confirma p {
      margin: 0;
    }
    .confirma-erro {
      color: var(--pink-200);
    }
    .confirma-erro:empty {
      display: none;
    }
    .confirma-acoes {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .acao {
      min-height: 32px;
      padding: 0 var(--space-6);
      font: inherit;
      font-size: var(--fs-day);
      font-weight: var(--fw-medium);
      color: var(--ink-900);
      background: var(--pink-300);
      border: 0;
      border-radius: var(--radius-pill);
      cursor: pointer;
    }
    .acao:hover:not(:disabled) {
      background: var(--pink-200);
    }
    .acao:disabled {
      cursor: progress;
    }
    .acao-neutra {
      background: var(--cream-200);
    }
    .acao-neutra:hover:not(:disabled) {
      background: var(--cream-50);
    }
    .shell-conteudo {
      min-width: 0;
      padding-top: var(--space-3);
    }
    @media (max-width: 831.98px) {
      :host {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-8);
        padding: var(--space-5);
      }
      .lateral {
        top: var(--space-5);
        z-index: 1;
        height: auto;
        max-height: calc(100dvh - 24px);
        padding: var(--space-5) var(--space-5) var(--space-5) var(--space-7);
        overflow-y: auto;
      }
      .lateral-topo {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-5);
        min-height: var(--size-icon-btn);
      }
      .marca {
        font-size: 26px;
      }
      .lateral-alternar {
        display: inline-grid;
      }
      .lateral-corpo {
        display: none;
        margin-top: var(--space-8);
        padding-bottom: var(--space-3);
      }
      .aberto .lateral-corpo,
      .sem-menu .lateral-corpo {
        display: flex;
      }
      .sem-menu .lateral-corpo {
        margin-top: var(--space-6);
      }
      .shell-conteudo {
        padding-top: 0;
      }
    }
  `,
})
export class ShellComponent {
  private readonly sessao = inject(SessaoStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly alternar = viewChild('alternar', { read: ElementRef });
  private readonly cancelar = viewChild('cancelar', { read: ElementRef });
  private readonly pedir = viewChild('pedir', { read: ElementRef });

  readonly icones = {
    CircleCheck,
    House,
    KeyRound,
    LogOut,
    Menu,
    MonitorOff,
    ShieldCheck,
    UserRound,
    Users,
    X,
  };
  readonly usuario = this.sessao.usuario;
  readonly ehAdmin = this.sessao.ehAdmin;
  readonly obrigatoria = this.sessao.senhaProvisoria;
  // "Sair de todos os aparelhos" pede confirmacao ali mesmo (foco em Cancelar, Esc cancela).
  readonly confirmandoTodos = signal(false);
  readonly saindoTodos = signal(false);
  readonly erroTodos = signal(false);
  // So conta na barra superior (abaixo de 832px); no desktop a sidebar fica sempre aberta.
  readonly menuAberto = signal(false);
  // Confirmacao leve da troca de senha: vem no state da navegacao e some na proxima.
  readonly senhaTrocada = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.lastSuccessfulNavigation?.extras.state?.['senhaTrocada'] === true),
    ),
    { initialValue: false },
  );

  constructor() {
    // Escolheu um destino no menu do celular: fecha.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuAberto.set(false));
  }

  // Esc cancela a confirmacao aberta; sem ela, fecha o menu do celular.
  escape(): void {
    if (this.confirmandoTodos()) this.cancelarSairTodos();
    else this.fecharMenu();
  }

  // Esc fecha o menu do celular e devolve o foco ao botao que o abriu.
  fecharMenu(): void {
    if (!this.menuAberto()) return;
    this.menuAberto.set(false);
    (this.alternar()?.nativeElement as HTMLElement | undefined)?.focus();
  }

  async sair(): Promise<void> {
    await this.sessao.sair();
    void this.router.navigateByUrl('/login');
  }

  pedirSairTodos(): void {
    this.erroTodos.set(false);
    this.confirmandoTodos.set(true);
    afterNextRender(() => (this.cancelar()?.nativeElement as HTMLElement | undefined)?.focus(), {
      injector: this.injector,
    });
  }

  cancelarSairTodos(): void {
    if (this.saindoTodos()) return;
    this.confirmandoTodos.set(false);
    afterNextRender(() => (this.pedir()?.nativeElement as HTMLElement | undefined)?.focus(), {
      injector: this.injector,
    });
  }

  async sairDeTodos(): Promise<void> {
    if (this.saindoTodos()) return;
    this.saindoTodos.set(true);
    this.erroTodos.set(false);
    try {
      await this.sessao.sairDeTodos();
      void this.router.navigateByUrl('/login');
    } catch {
      this.erroTodos.set(true);
    } finally {
      this.saindoTodos.set(false);
    }
  }
}
