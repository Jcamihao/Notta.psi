import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Menu } from 'lucide-angular';
import { IconButtonComponent } from './icon-button.component';

@Component({
  imports: [IconButtonComponent],
  template: `<button
    app-icon-button
    type="button"
    aria-label="Abrir menu"
    [icon]="icone"
    [tone]="tom()"
  ></button>`,
})
class Host {
  icone = Menu;
  tom = signal<'dark' | 'soft' | 'accent'>('dark');
}

describe('IconButtonComponent', () => {
  it('circulo de 38px com icone svg escondido do leitor de tela', async () => {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    const b = f.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(b.getAttribute('aria-label')).toBe('Abrir menu');
    expect(b.style.width).toBe('38px');
    expect(getComputedStyle(b).borderRadius).toBe('50%');
    expect(b.querySelector('lucide-icon')?.getAttribute('aria-hidden')).toBe('true');
    const svg = b.querySelector('svg')!;
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
  });

  it('tons: dark preto, accent rosa', async () => {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    const b = f.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(getComputedStyle(b).backgroundColor).toBe('rgb(20, 20, 20)');
    f.componentInstance.tom.set('accent');
    await f.whenStable();
    expect(getComputedStyle(b).backgroundColor).toBe('rgb(242, 179, 220)');
  });
});
