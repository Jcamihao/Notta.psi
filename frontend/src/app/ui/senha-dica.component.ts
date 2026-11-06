import { Component, computed, input } from '@angular/core';
import { Check, Circle, LucideAngularModule, X } from 'lucide-angular';
import { regrasSenha } from '../core/senha-regras';

// Dica de senha que atualiza enquanto a pessoa digita (item 45). O estado de cada regra vai em
// TEXTO (so-leitor "Atende"/"Falta") e em forma de icone, nunca so em cor; o resumo e uma regiao
// aria-live="polite" que so muda quando o numero de regras que faltam muda (nao a cada tecla).
// A senha nao sai daqui: so e comparada no proprio navegador.
@Component({
  selector: 'app-senha-dica',
  imports: [LucideAngularModule],
  template: `
    <p class="resumo" aria-live="polite" data-teste="resumo">{{ resumo() }}</p>
    <ul class="regras">
      @for (r of regras(); track r.id) {
        <li [attr.data-estado]="r.estado">
          <lucide-icon [img]="r.icone" [size]="14" [strokeWidth]="1.5" aria-hidden="true" />
          <span class="so-leitor">{{ r.rotulo }}: </span>{{ r.texto }}
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-2);
      color: var(--text-secondary);
      font-size: var(--fs-day);
    }
    p,
    ul {
      margin: 0;
    }
    ul {
      display: grid;
      gap: var(--space-1);
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
    }
    li lucide-icon {
      flex: none;
      margin-top: 2px;
    }
    li[data-estado='ok'] {
      color: var(--text-primary);
    }
    .resumo {
      min-height: 1.25rem;
      color: var(--text-primary);
      font-weight: var(--fw-medium);
    }
  `,
})
export class SenhaDicaComponent {
  readonly senha = input('');
  readonly email = input('');
  readonly nome = input('');

  readonly regras = computed(() => {
    const vazia = this.senha() === '';
    return regrasSenha(this.senha(), { email: this.email(), nome: this.nome() }).map((r) =>
      vazia
        ? { ...r, estado: 'pendente', icone: Circle, rotulo: 'Regra' }
        : r.ok
          ? { ...r, estado: 'ok', icone: Check, rotulo: 'Atende' }
          : { ...r, estado: 'falta', icone: X, rotulo: 'Não atende' },
    );
  });

  readonly resumo = computed(() => {
    if (this.senha() === '') return '';
    const faltam = this.regras().filter((r) => r.estado === 'falta').length;
    if (faltam === 0) return 'Senha boa nas regras abaixo.';
    return `Senha fraca: ${faltam === 1 ? 'falta 1 regra' : `faltam ${faltam} regras`}.`;
  });
}
