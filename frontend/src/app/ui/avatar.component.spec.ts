import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AvatarComponent } from './avatar.component';

@Component({
  imports: [AvatarComponent],
  template: `<app-avatar [name]="nome()" [size]="28" />`,
})
class Host {
  nome = signal('Ana Maria Souza');
}

describe('AvatarComponent', () => {
  const montar = async (nome: string) => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.nome.set(nome);
    await f.whenStable();
    return f.nativeElement.querySelector('app-avatar') as HTMLElement;
  };

  it('iniciais do primeiro e do ultimo nome, decorativo para o leitor de tela', async () => {
    const a = await montar('Ana Maria Souza');
    expect(a.dataset['iniciais']).toBe('AS');
    expect(a.textContent).toBe('');
    expect(a.getAttribute('aria-hidden')).toBe('true');
    expect(a.style.width).toBe('28px');
  });

  it('nome de uma palavra so da uma inicial; espacos sobrando nao quebram', async () => {
    expect((await montar('  bruno  ')).dataset['iniciais']).toBe('B');
  });

  it('mesmo nome, mesma cor pastel', async () => {
    const a = (await montar('Carla Dias')).style.background;
    const b = (await montar('Carla Dias')).style.background;
    expect(a).toContain('var(--');
    expect(a).toBe(b);
  });
});
