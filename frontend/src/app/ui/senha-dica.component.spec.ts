import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SenhaDicaComponent } from './senha-dica.component';

describe('SenhaDicaComponent', () => {
  let fixture: ComponentFixture<SenhaDicaComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [SenhaDicaComponent] });
    fixture = TestBed.createComponent(SenhaDicaComponent);
    fixture.componentRef.setInput('email', 'ana@clinica.com');
    fixture.componentRef.setInput('nome', 'Ana Souza');
    await fixture.whenStable();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const definir = async (senha: string) => {
    fixture.componentRef.setInput('senha', senha);
    await fixture.whenStable();
  };
  const resumo = () => el().querySelector('[data-teste="resumo"]')!;
  const itens = () => Array.from(el().querySelectorAll('li'));
  const estados = () => itens().map((li) => li.getAttribute('data-estado'));
  const texto = (li: Element) => li.textContent!.replace(/\s+/g, ' ').trim();

  it('vazia: tres regras neutras ("Regra") e resumo vazio', () => {
    expect(itens().length).toBe(3);
    expect(estados()).toEqual(['pendente', 'pendente', 'pendente']);
    expect(texto(itens()[0])).toBe('Regra: 10 ou mais caracteres');
    expect(resumo().textContent?.trim()).toBe('');
  });

  it('o resumo e uma regiao aria-live polite', () => {
    expect(resumo().getAttribute('aria-live')).toBe('polite');
  });

  it('atualiza ao digitar: o estado de cada regra vai em TEXTO, nao so em cor', async () => {
    await definir('1234');
    expect(estados()).toEqual(['falta', 'falta', 'ok']);
    expect(texto(itens()[0])).toBe('Não atende: 10 ou mais caracteres');
    expect(texto(itens()[2])).toBe('Atende: Não contém seu nome nem seu e-mail');
    expect(resumo().textContent?.trim()).toBe('Senha fraca: faltam 2 regras.');
    // cada item tem icone de forma propria (alem do texto)
    expect(itens()[0].querySelector('lucide-icon')).not.toBeNull();
  });

  it('uma regra faltando usa o singular', async () => {
    await definir('tijolo-azul-lua-ana'); // contem "ana"
    expect(estados()).toEqual(['ok', 'ok', 'falta']);
    expect(resumo().textContent?.trim()).toBe('Senha fraca: falta 1 regra.');
  });

  it('tudo certo: "Senha boa nas regras abaixo."', async () => {
    await definir('tijolo-azul-lua-4821');
    expect(estados()).toEqual(['ok', 'ok', 'ok']);
    expect(resumo().textContent?.trim()).toBe('Senha boa nas regras abaixo.');
  });

  it('apagar tudo volta ao neutro', async () => {
    await definir('1234');
    await definir('');
    expect(estados()).toEqual(['pendente', 'pendente', 'pendente']);
    expect(resumo().textContent?.trim()).toBe('');
  });

  it('nao diz "comum": a lista e do servidor', async () => {
    await definir('Senha1234!');
    expect(el().textContent?.toLowerCase()).not.toContain('comum');
  });
});
