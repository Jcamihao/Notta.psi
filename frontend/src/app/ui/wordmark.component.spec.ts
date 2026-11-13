import { TestBed } from '@angular/core/testing';
import { WordmarkComponent } from './wordmark.component';

describe('WordmarkComponent', () => {
  it('escreve praxis.psi com o ponto em azul da marca', () => {
    const f = TestBed.createComponent(WordmarkComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toBe('praxis.psi');
    const ponto = el.querySelector('.ponto') as HTMLElement;
    expect(ponto.textContent).toBe('.');
    expect(getComputedStyle(ponto).color).toBe('rgb(56, 182, 255)');
  });

  it('so o ponto e azul: o resto herda a cor de quem usa', () => {
    const f = TestBed.createComponent(WordmarkComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('span').length).toBe(1);
    expect(getComputedStyle(el).color).not.toBe('rgb(56, 182, 255)');
  });
});
