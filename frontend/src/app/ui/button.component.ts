import { Component, booleanAttribute, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'disabled' | 'progress' | 'soft';

// Button do design system: pill de acao. Montado sobre o <button> nativo para manter type,
// disabled, form e foco do navegador. "progress" (rosa) e o estado de envio em andamento.
// "disabled" usa tinta sobre #A9A49B (7.4:1): o branco do original da 2.5:1.
@Component({
  selector: 'button[app-button], a[app-button]',
  template: '<ng-content />',
  host: { '[attr.data-variant]': 'variant()', '[class.full]': 'full()' },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-3);
      min-height: var(--size-icon-btn);
      padding: 0 var(--space-7);
      font: inherit;
      font-size: var(--fs-nav);
      font-weight: var(--fw-medium);
      color: var(--text-inverse);
      background: var(--btn-primary-bg);
      border: 0;
      border-radius: var(--radius-pill);
      cursor: pointer;
      text-decoration: none;
      transition: background-color 150ms ease;
    }
    :host(:hover) {
      background: var(--ink-700);
    }
    :host(.full) {
      width: 100%;
    }
    :host([data-variant='progress']) {
      color: var(--ink-900);
      background: var(--btn-progress-bg);
      cursor: progress;
    }
    :host([data-variant='disabled']) {
      color: var(--ink-900);
      background: var(--btn-disabled-bg);
      cursor: not-allowed;
    }
    :host([data-variant='soft']) {
      color: var(--ink-900);
      background: var(--surface-control);
    }
    :host([data-variant='soft']:hover) {
      background: var(--cream-300);
    }
  `,
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly full = input(false, { transform: booleanAttribute });
}
