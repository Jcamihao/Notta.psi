import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { UsuarioStore } from '../core/usuario.store';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet],
  template: `
    <header class="shell-topo">
      <div class="shell-onde">
        <span class="marca">Notta<span class="marca-psi">.psi</span></span>
        @if (usuario(); as u) {
          <span class="shell-clinica">{{ u.clinica.nome }}</span>
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

  sair(): void {
    this.usuarios.sair();
    void this.router.navigateByUrl('/login');
  }
}
