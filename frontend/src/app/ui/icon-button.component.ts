import { Component, input } from '@angular/core';
import { LucideAngularModule, LucideIconData } from 'lucide-angular';

// IconButton do design system: botao circular so com icone. Quem usa da o nome acessivel
// (aria-label) no proprio <button>.
@Component({
  selector: 'button[app-icon-button]',
  imports: [LucideAngularModule],
  template: `<lucide-icon [img]="icon()" [size]="20" [strokeWidth]="1.5" />`,
  host: {
    '[attr.data-tone]': 'tone()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
  styles: `
    :host {
      display: inline-grid;
      flex: none;
      place-items: center;
      padding: 0;
      font: inherit;
      color: var(--text-inverse);
      background: var(--btn-primary-bg);
      border: 0;
      border-radius: 50%;
      cursor: pointer;
      transition: background-color 150ms ease;
    }
    :host(:hover) {
      background: var(--ink-700);
    }
    :host([data-tone='soft']) {
      color: var(--ink-900);
      background: var(--surface-control);
    }
    :host([data-tone='soft']:hover) {
      background: var(--cream-300);
    }
    :host([data-tone='accent']) {
      color: var(--ink-900);
      background: var(--accent);
    }
    :host([data-tone='accent']:hover) {
      background: var(--accent-hover);
    }
  `,
})
export class IconButtonComponent {
  readonly icon = input.required<LucideIconData>();
  readonly tone = input<'dark' | 'soft' | 'accent'>('dark');
  readonly size = input(38);
}
