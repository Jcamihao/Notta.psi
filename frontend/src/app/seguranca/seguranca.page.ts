import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { PillComponent } from '../ui/pill.component';
import { WordmarkComponent } from '../ui/wordmark.component';
import { CONTEUDO_SEGURANCA } from './seguranca.conteudo';

const TITULO = 'Segurança e privacidade';

// Pagina publica /seguranca (fora do shell, sem guard, sem noindex de proposito). So dado
// estatico: sem requisicao, sem innerHTML, sem link externo. O conteudo fica em seguranca.conteudo.ts.
@Component({
  selector: 'app-seguranca-page',
  imports: [PillComponent, WordmarkComponent],
  templateUrl: './seguranca.page.html',
  styleUrl: './seguranca.page.scss',
})
export class SegurancaPage {
  readonly conteudo = CONTEUDO_SEGURANCA;
  readonly atualizadoEm = CONTEUDO_SEGURANCA.atualizadoEm.split('-').reverse().join('/');

  constructor() {
    inject(Title).setTitle(TITULO);
  }
}
