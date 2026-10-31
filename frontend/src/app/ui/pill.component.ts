import { Component, booleanAttribute, input } from '@angular/core';

// Pill do design system: tag de categoria (raio 6px, fundo pastel, texto em tinta) ou chip
// tracejado de filtro. O original usa 9px; aqui 12px (--fs-body), porque a tag carrega
// informacao (papel, abordagem) e precisa ser lida.
@Component({
  selector: 'app-pill',
  template: '<ng-content />',
  host: { '[attr.data-tone]': 'tone()', '[class.dashed]': 'dashed()' },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      padding: var(--space-1) var(--space-3);
      color: var(--ink-900);
      font-size: var(--fs-body);
      font-weight: var(--fw-medium);
      line-height: var(--lh-tight);
      white-space: nowrap;
      border-radius: var(--radius-chip);
    }
    :host([data-tone='pink']) {
      background: var(--pink-200);
    }
    :host([data-tone='blue']) {
      background: var(--blue-300);
    }
    :host([data-tone='yellow']) {
      background: var(--yellow-300);
    }
    :host(.dashed) {
      color: var(--text-secondary);
      background: transparent;
      border: 1px dashed var(--ink-500);
      border-radius: var(--radius-pill);
    }
  `,
})
export class PillComponent {
  readonly tone = input<'pink' | 'blue' | 'yellow'>('pink');
  readonly dashed = input(false, { transform: booleanAttribute });
}
