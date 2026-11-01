import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent, ButtonVariant } from './button.component';

@Component({
  imports: [ButtonComponent],
  template: `<button
    app-button
    type="submit"
    [variant]="variant()"
    [full]="full()"
    [disabled]="off()"
  >
    Entrar
  </button>`,
})
class Host {
  variant = signal<ButtonVariant>('primary');
  full = signal(false);
  off = signal(false);
}

@Component({
  imports: [ButtonComponent],
  template: `<a app-button href="/x">Ir</a>`,
})
class HostLink {}

describe('ButtonComponent', () => {
  it('serve tambem para link: pill preta, texto branco, sem sublinhado', async () => {
    const f = TestBed.createComponent(HostLink);
    await f.whenStable();
    const a = f.nativeElement.querySelector('a') as HTMLAnchorElement;
    const s = getComputedStyle(a);
    expect(s.backgroundColor).toBe('rgb(20, 20, 20)');
    expect(s.color).toBe('rgb(255, 255, 255)');
    expect(s.textDecorationLine).toBe('none');
  });

  const montar = async () => {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    return { f, botao: f.nativeElement.querySelector('button') as HTMLButtonElement };
  };

  it('fica no button nativo: type, texto e disabled continuam do navegador', async () => {
    const { f, botao } = await montar();
    expect(botao.type).toBe('submit');
    expect(botao.textContent?.trim()).toBe('Entrar');
    f.componentInstance.off.set(true);
    await f.whenStable();
    expect(botao.disabled).toBeTrue();
  });

  it('primary e pill preta com texto branco', async () => {
    const { botao } = await montar();
    const s = getComputedStyle(botao);
    expect(botao.dataset['variant']).toBe('primary');
    expect(s.backgroundColor).toBe('rgb(20, 20, 20)');
    expect(s.color).toBe('rgb(255, 255, 255)');
    expect(s.borderRadius).toBe('999px');
  });

  it('progress e rosa com texto em tinta; disabled usa tinta sobre cinza (AA)', async () => {
    const { f, botao } = await montar();
    f.componentInstance.variant.set('progress');
    await f.whenStable();
    expect(getComputedStyle(botao).backgroundColor).toBe('rgb(242, 179, 220)');
    expect(getComputedStyle(botao).color).toBe('rgb(20, 20, 20)');
    f.componentInstance.variant.set('disabled');
    await f.whenStable();
    expect(getComputedStyle(botao).backgroundColor).toBe('rgb(169, 164, 155)');
    expect(getComputedStyle(botao).color).toBe('rgb(20, 20, 20)');
  });

  it('full ocupa a largura toda', async () => {
    const { f, botao } = await montar();
    f.componentInstance.full.set(true);
    await f.whenStable();
    expect(botao.classList).toContain('full');
  });
});
