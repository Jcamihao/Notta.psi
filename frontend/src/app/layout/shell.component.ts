import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SessaoStore } from '../core/sessao.store';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet],
  template: `
    <header class="shell-topo">
      <span class="shell-marca">Notta.psi</span>
      <button type="button" class="shell-sair" (click)="sair()">Sair</button>
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
      align-items: center;
      justify-content: space-between;
      padding: var(--espaco-3) var(--espaco-5);
      background: var(--cor-superficie);
      border-bottom: 1px solid var(--cor-borda);
    }
    .shell-marca {
      font-weight: 600;
      font-size: var(--texto-lg);
    }
    .shell-sair {
      font: inherit;
      padding: var(--espaco-2) var(--espaco-4);
      color: var(--cor-texto);
      background: transparent;
      border: 1px solid var(--cor-borda-forte);
      border-radius: var(--raio);
      cursor: pointer;
    }
    .shell-sair:hover {
      background: var(--cor-fundo);
    }
    .shell-conteudo {
      padding: var(--espaco-5);
    }
  `,
})
export class ShellComponent {
  private readonly sessao = inject(SessaoStore);
  private readonly router = inject(Router);

  sair(): void {
    this.sessao.sair();
    void this.router.navigateByUrl('/login');
  }
}
