import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UsuarioStore } from '../core/usuario.store';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="shell-topo">
      <div class="shell-onde">
        <a class="marca" routerLink="/">Notta<span class="marca-psi">.psi</span></a>
        @if (usuario(); as u) {
          <span class="shell-clinica">{{ u.clinica.nome }}</span>
        }
        @if (ehAdmin()) {
          <nav aria-label="Principal">
            <a
              class="shell-link"
              routerLink="/equipe"
              routerLinkActive="shell-link-ativo"
              ariaCurrentWhenActive="page"
              >Equipe</a
            >
          </nav>
        }
      </div>
      <div class="shell-quem">
        @if (usuario(); as u) {
          <span class="shell-nome">{{ u.nome }}</span>
        }
        <button type="button" class="botao-discreto" (click)="sair()">Sair</button>
      </div>
    </header>
    <main class="shell-conteudo">
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }
    .shell-topo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--espaco-2) var(--espaco-4);
      padding: var(--espaco-3) var(--espaco-5);
      background: var(--cor-superficie);
      border-bottom: 1px solid var(--cor-borda);
    }
    .shell-onde,
    .shell-quem {
      display: flex;
      align-items: center;
      gap: var(--espaco-3);
      min-width: 0;
    }
    .shell-quem {
      margin-left: auto;
    }
    .shell-clinica {
      padding-left: var(--espaco-3);
      border-left: 1px solid var(--cor-borda);
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    a.marca {
      color: inherit;
      text-decoration: none;
    }
    .shell-link {
      display: inline-flex;
      align-items: center;
      min-height: 2.25rem;
      padding: 0 var(--espaco-3);
      color: var(--cor-texto-suave);
      font-size: var(--texto-sm);
      text-decoration: none;
      border-radius: var(--raio);
      transition:
        background-color var(--transicao),
        color var(--transicao);
    }
    .shell-link:hover {
      color: var(--cor-texto);
      background: var(--cor-fundo);
    }
    .shell-link-ativo,
    .shell-link-ativo:hover {
      color: var(--cor-acao-forte);
      background: var(--cor-acao-suave);
      font-weight: 600;
    }
    .shell-nome {
      color: var(--cor-texto-suave);
      font-size: var(--texto-sm);
      overflow-wrap: anywhere;
    }
    .shell-conteudo {
      padding: var(--espaco-5);
    }
  `,
})
export class ShellComponent {
  private readonly usuarios = inject(UsuarioStore);
  private readonly router = inject(Router);

  readonly usuario = this.usuarios.usuario;
  readonly ehAdmin = this.usuarios.ehAdmin;

  sair(): void {
    this.usuarios.sair();
    void this.router.navigateByUrl('/login');
  }
}
