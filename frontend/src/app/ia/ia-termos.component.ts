import { Component, input, output, signal } from '@angular/core';
import { CircleAlert, LucideAngularModule, X } from 'lucide-angular';
import { ButtonComponent } from '../ui/button.component';
import { IconButtonComponent } from '../ui/icon-button.component';
import { LIMITE_TERMOS, TAMANHO_TERMO } from './ia.service';

// Termos extras que o psicologo quer esconder da IA (ex.: nome de um familiar). Os termos ficam
// so na memoria de quem usa o componente; aqui mora so o campo de digitar e a validacao.
@Component({
  selector: 'app-ia-termos',
  imports: [LucideAngularModule, ButtonComponent, IconButtonComponent],
  templateUrl: './ia-termos.component.html',
  styleUrl: './ia-termos.component.scss',
})
export class IaTermosComponent {
  readonly icones = { CircleAlert, X };
  readonly termos = input.required<string[]>();
  readonly podeRemover = input(true);
  readonly rotuloAdicionar = input('Adicionar termo');
  readonly desabilitado = input(false);
  readonly adicionou = output<string>();
  readonly removeu = output<number>();

  readonly limite = LIMITE_TERMOS;
  readonly tamanho = TAMANHO_TERMO;
  readonly erro = signal('');

  adicionar(campo: HTMLInputElement): void {
    const termo = campo.value.trim();
    this.erro.set('');
    if (!termo) {
      this.erro.set('Escreva o termo que deve ser escondido da IA.');
    } else if (termo.length > TAMANHO_TERMO) {
      this.erro.set(`Cada termo tem no máximo ${TAMANHO_TERMO} caracteres.`);
    } else if (this.termos().length >= LIMITE_TERMOS) {
      this.erro.set(`No máximo ${LIMITE_TERMOS} termos.`);
    } else if (this.termos().some((t) => t.toLowerCase() === termo.toLowerCase())) {
      this.erro.set('Este termo já foi adicionado.');
    }
    if (this.erro()) {
      campo.focus();
      return;
    }
    this.adicionou.emit(termo);
    campo.value = '';
    campo.focus();
  }
}
