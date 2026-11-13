import { Component, input } from '@angular/core';
import { LucideAngularModule, LucideIconData } from 'lucide-angular';

// NavItem do design system: linha da sidebar escura (icone 19px branco + rotulo 14px projetado
// como conteudo, no lugar do prop label do original: o lint de a11y enxerga o texto). Vai no
// proprio <a> (com routerLink) ou num <button> (Sair). O estado ativo vem de aria-current="page"
// (routerLinkActive + ariaCurrentWhenActive): o que o leitor de tela ouve e o que se ve.
@Component({
  selector: 'a[app-nav-item], button[app-nav-item]',
  imports: [LucideAngularModule],
  template: `<lucide-icon [img]="icon()" [size]="19" [strokeWidth]="1.5" /><span
      ><ng-content
    /></span>`,
  styles: `
    :host {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--space-5);
      width: 100%;
      min-height: 32px;
      padding: 0 0 0 var(--space-5);
      font: inherit;
      font-size: var(--fs-nav);
      font-weight: var(--fw-regular);
      color: var(--text-inverse);
      text-align: left;
      text-decoration: none;
      background: none;
      border: 0;
      border-radius: var(--radius-chip);
      cursor: pointer;
      transition: color 150ms ease;
    }
    :host(:hover) {
      color: var(--pink-200);
    }
    :host([aria-current='page']) {
      color: var(--text-nav-active);
      font-weight: var(--fw-medium);
    }
    :host([aria-current='page'])::before {
      content: '';
      position: absolute;
      top: 6px;
      bottom: 6px;
      left: 0;
      width: 2px;
      border-radius: 1px;
      background: var(--text-nav-active);
    }
    :host(:focus-visible) {
      outline-color: var(--accent);
    }
  `,
})
export class NavItemComponent {
  readonly icon = input.required<LucideIconData>();
}
