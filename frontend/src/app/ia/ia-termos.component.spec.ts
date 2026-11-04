import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IaTermosComponent } from './ia-termos.component';

@Component({
  imports: [IaTermosComponent],
  template: `<app-ia-termos
    [termos]="termos()"
    [podeRemover]="podeRemover()"
    (adicionou)="adicionar($event)"
    (removeu)="removidos.push($event)"
  />`,
})
class Hospedeiro {
  termos = signal<string[]>([]);
  podeRemover = signal(true);
  adicionados: string[] = [];
  adicionar(t: string) {
    this.adicionados.push(t);
    this.termos.set([...this.termos(), t]);
  }
  removidos: number[] = [];
}

describe('IaTermosComponent', () => {
  let fixture: ComponentFixture<Hospedeiro>;
  const el = () => fixture.nativeElement as HTMLElement;
  const campo = () => el().querySelector('#ia-termo') as HTMLInputElement;
  const adicionar = async (valor: string) => {
    campo().value = valor;
    (
      Array.from(el().querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Adicionar termo',
      ) as HTMLElement
    ).click();
    await fixture.whenStable();
  };
  const erro = () => el().querySelector('#ia-termo-erro')?.textContent?.trim();

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Hospedeiro] });
    fixture = TestBed.createComponent(Hospedeiro);
    await fixture.whenStable();
  });

  it('campo sem corretor ortografico nem autocompletar', () => {
    expect(campo().getAttribute('spellcheck')).toBe('false');
    expect(campo().getAttribute('autocomplete')).toBe('off');
  });

  it('adiciona o termo aparado, limpa o campo e devolve o foco a ele', async () => {
    await adicionar('  Joana  ');
    expect(fixture.componentInstance.adicionados).toEqual(['Joana']);
    expect(campo().value).toBe('');
    expect(document.activeElement).toBe(campo());
    expect(el().querySelector('[data-teste="termos"]')?.textContent).toContain('Joana');
  });

  it('Enter adiciona sem enviar formulario', async () => {
    campo().value = 'Escola Sol';
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    campo().dispatchEvent(ev);
    await fixture.whenStable();
    expect(ev.defaultPrevented).toBeTrue();
    expect(fixture.componentInstance.adicionados).toEqual(['Escola Sol']);
  });

  it('recusa vazio, so espacos, mais de 60 caracteres e repetido (sem caixa)', async () => {
    await adicionar('   ');
    expect(erro()).toBe('Escreva o termo que deve ser escondido da IA.');
    await adicionar('x'.repeat(61));
    expect(erro()).toBe('Cada termo tem no máximo 60 caracteres.');
    await adicionar('Joana');
    await adicionar('JOANA');
    expect(erro()).toBe('Este termo já foi adicionado.');
    expect(fixture.componentInstance.adicionados).toEqual(['Joana']);
    expect(document.activeElement).toBe(campo());
  });

  it('aceita 60 caracteres e limita em 20 termos', async () => {
    await adicionar('x'.repeat(60));
    expect(fixture.componentInstance.adicionados).toHaveSize(1);
    for (let i = 1; i < 20; i++) await adicionar(`termo${i}`);
    expect(fixture.componentInstance.adicionados).toHaveSize(20);
    await adicionar('mais um');
    expect(erro()).toBe('No máximo 20 termos.');
    expect(fixture.componentInstance.adicionados).toHaveSize(20);
  });

  it('remover: cada termo tem botao com nome proprio', async () => {
    fixture.componentInstance.termos.set(['Joana', 'Pedro']);
    await fixture.whenStable();
    const b = el().querySelector('[aria-label="Remover o termo Pedro"]') as HTMLElement;
    b.click();
    expect(fixture.componentInstance.removidos).toEqual([1]);
  });

  it('podeRemover=false: lista sem botoes de remover', async () => {
    fixture.componentInstance.termos.set(['Joana']);
    fixture.componentInstance.podeRemover.set(false);
    await fixture.whenStable();
    expect(el().querySelector('[aria-label^="Remover"]')).toBeNull();
    expect(el().querySelector('[data-teste="termos"]')?.textContent).toContain('Joana');
  });
});
