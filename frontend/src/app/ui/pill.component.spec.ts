import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PillComponent } from './pill.component';

@Component({
  imports: [PillComponent],
  template: `<app-pill [tone]="tom()" [dashed]="tracejado()">TCC</app-pill>`,
})
class Host {
  tom = signal<'pink' | 'blue' | 'yellow'>('pink');
  tracejado = signal(false);
}

describe('PillComponent', () => {
  it('tag com texto em tinta sobre o tom pedido', async () => {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    const p = f.nativeElement.querySelector('app-pill') as HTMLElement;
    expect(p.textContent?.trim()).toBe('TCC');
    expect(getComputedStyle(p).color).toBe('rgb(20, 20, 20)');
    expect(getComputedStyle(p).backgroundColor).toBe('rgb(247, 205, 234)');
    f.componentInstance.tom.set('yellow');
    await f.whenStable();
    expect(getComputedStyle(p).backgroundColor).toBe('rgb(244, 213, 106)');
  });

  it('dashed vira chip tracejado sem fundo', async () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.tracejado.set(true);
    await f.whenStable();
    const s = getComputedStyle(f.nativeElement.querySelector('app-pill'));
    expect(s.borderStyle).toBe('dashed');
    expect(s.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });
});
