import { Component } from '@angular/core';

// Nome do produto como logo: "praxis" + ponto azul + "psi". O ponto azul e o elemento central da marca
// praxis (manual de marca v1: o ponto fecha a frase). A fonte, o peso e o tamanho vem de quem usa
// (classe `.marca` em styles.scss). Wordmark provisorio ate o dono decidir logo e icone. O texto
// continua sendo "praxis.psi" para leitor de tela e para copiar.
@Component({
  selector: 'app-wordmark',
  template: `praxis<span class="ponto">.</span>psi`,
  styles: `
    .ponto {
      color: var(--accent);
    }
  `,
})
export class WordmarkComponent {}
