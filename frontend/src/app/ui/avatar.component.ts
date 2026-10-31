import { Component, computed, input } from '@angular/core';

// Cores pastel dos avatares do design system (tinta sobre elas: 9.0:1 ou mais).
const CORES = ['--avatar-ty', '--avatar-ab', '--avatar-nr', '--avatar-ss', '--pink-200'];

// Avatar de iniciais do design system. Decorativo: o nome sempre aparece ao lado, por isso
// aria-hidden e iniciais em ::before (fora do textContent da linha ou celula onde ele entra).
// A cor sai do nome, entao a mesma pessoa tem sempre a mesma cor.
@Component({
  selector: 'app-avatar',
  template: '',
  host: {
    'aria-hidden': 'true',
    '[attr.data-iniciais]': 'iniciais()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'size() * 0.4',
    '[style.background]': 'cor()',
  },
  styles: `
    :host {
      display: inline-grid;
      flex: none;
      place-items: center;
      color: var(--ink-900);
      font-weight: var(--fw-medium);
      line-height: 1;
      border-radius: 50%;
      user-select: none;
    }
    :host::before {
      content: attr(data-iniciais);
    }
  `,
})
export class AvatarComponent {
  readonly name = input.required<string>();
  readonly size = input(22);

  readonly iniciais = computed(() => {
    const partes = this.name().trim().split(/\s+/).filter(Boolean);
    const primeira = partes[0]?.[0] ?? '';
    const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (primeira + ultima).toUpperCase();
  });

  readonly cor = computed(() => {
    let soma = 0;
    for (const c of this.name()) soma = (soma * 31 + c.charCodeAt(0)) >>> 0;
    return `var(${CORES[soma % CORES.length]})`;
  });
}
