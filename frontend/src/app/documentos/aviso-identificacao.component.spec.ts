import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TipoDado } from '../core/dados-identificaveis';
import { AvisoIdentificacaoComponent } from './aviso-identificacao.component';

@Component({
  imports: [AvisoIdentificacaoComponent],
  template: `<app-aviso-identificacao
    [tipos]="tipos()"
    (dispensado)="dispensados = dispensados + 1"
  />`,
})
class Host {
  tipos = signal<TipoDado[]>([]);
  dispensados = 0;
}

describe('AvisoIdentificacaoComponent', () => {
  const montar = async () => {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    return f;
  };
  const el = (f: { nativeElement: HTMLElement }) => f.nativeElement;
  const aviso = (f: { nativeElement: HTMLElement }) =>
    el(f).querySelector('[data-teste="aviso-identificacao"]');

  it('sem tipos: nada na tela, mas a regiao polite ja existe', async () => {
    const f = await montar();
    expect(aviso(f)).toBeNull();
    expect(el(f).querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('com tipos: frase com o tipo e nunca o trecho; avisa dentro da regiao polite', async () => {
    const f = await montar();
    f.componentInstance.tipos.set(['CPF', 'telefone']);
    await f.whenStable();
    const a = aviso(f)!;
    expect(a.textContent?.replace(/\s+/g, ' ')).toContain(
      'Este texto parece ter dado que identifica o paciente (CPF, telefone). Considere remover.',
    );
    expect(a.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('dispensar esconde, avisa a pagina e nao volta enquanto os tipos forem os mesmos', async () => {
    const f = await montar();
    f.componentInstance.tipos.set(['CPF']);
    await f.whenStable();
    (el(f).querySelector('button') as HTMLButtonElement).click();
    await f.whenStable();
    expect(aviso(f)).toBeNull();
    expect(f.componentInstance.dispensados).toBe(1);
    f.componentInstance.tipos.set(['CPF']);
    await f.whenStable();
    expect(aviso(f)).toBeNull();
  });

  it('tipo novo depois de dispensar avisa de novo, so com o tipo novo', async () => {
    const f = await montar();
    f.componentInstance.tipos.set(['CPF']);
    await f.whenStable();
    (el(f).querySelector('button') as HTMLButtonElement).click();
    await f.whenStable();
    f.componentInstance.tipos.set(['CPF', 'e-mail']);
    await f.whenStable();
    const t = aviso(f)!.textContent!;
    expect(t).toContain('(e-mail)');
    expect(t).not.toContain('CPF');
  });

  it('nao tem campo, nao escreve no console nem em storage', async () => {
    const antes = [localStorage.length, sessionStorage.length];
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      spyOn(console, m),
    );
    const f = await montar();
    f.componentInstance.tipos.set(['nome do paciente']);
    await f.whenStable();
    expect(el(f).querySelector('input, textarea')).toBeNull();
    expect([localStorage.length, sessionStorage.length]).toEqual(antes);
    for (const e of espioes) expect(e).not.toHaveBeenCalled();
  });
});
