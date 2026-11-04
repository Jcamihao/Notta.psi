import { Component, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { TipoDado } from '../core/dados-identificaveis';
import { ButtonComponent } from '../ui/button.component';

// Aviso do item 13: mostra so o TIPO do dado achado (nunca o trecho), nao bloqueia nada e pode
// ser dispensado. A regiao polite fica sempre no DOM para o leitor de tela anunciar a mudanca.
// Dispensar vale para os tipos que estao na tela agora; tipo novo avisa de novo.
@Component({
  selector: 'app-aviso-identificacao',
  imports: [LucideAngularModule, ButtonComponent],
  template: `
    <div class="regiao" aria-live="polite">
      @if (visiveis().length) {
        <div class="aviso" data-teste="aviso-identificacao">
          <lucide-icon [img]="icones.TriangleAlert" [size]="18" [strokeWidth]="1.5" />
          <p>
            Este texto parece ter dado que identifica o paciente ({{ lista() }}). Considere remover.
          </p>
          <button app-button type="button" variant="soft" (click)="dispensar()">Dispensar</button>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .aviso {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3) var(--space-5);
      padding: var(--space-4) var(--space-5);
      background: var(--yellow-300);
      border-radius: var(--radius-card);
      line-height: var(--lh-body);
    }
    lucide-icon {
      flex: none;
    }
    p {
      flex: 1 1 14rem;
      margin: 0;
    }
  `,
})
export class AvisoIdentificacaoComponent {
  readonly tipos = input.required<readonly TipoDado[]>();
  // Avisa a pagina: o botao some ao dispensar, entao ela devolve o foco ao campo.
  readonly dispensado = output<void>();
  readonly icones = { TriangleAlert };
  private readonly dispensados = signal<readonly TipoDado[]>([]);
  readonly visiveis = computed(() => this.tipos().filter((t) => !this.dispensados().includes(t)));
  readonly lista = computed(() => this.visiveis().join(', '));

  dispensar(): void {
    this.dispensados.set([...this.dispensados(), ...this.visiveis()]);
    this.dispensado.emit();
  }
}
