import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SessaoStore } from '../core/sessao.store';
import { ShellComponent } from './shell.component';

describe('ShellComponent', () => {
  let fixture: ComponentFixture<ShellComponent>;
  let sessao: SessaoStore;
  let navegar: jasmine.Spy;

  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    sessao = TestBed.inject(SessaoStore);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();
  });

  afterEach(() => sessionStorage.clear());

  const el = () => fixture.nativeElement as HTMLElement;

  it('tem landmarks header e main e o nome do app', () => {
    expect(el().querySelector('header')?.textContent).toContain('Notta.psi');
    expect(el().querySelector('main router-outlet')).not.toBeNull();
  });

  it('botao Sair limpa a sessao e navega para /login', () => {
    sessao.entrar('t');
    const botao = el().querySelector('button') as HTMLButtonElement;
    expect(botao.textContent?.trim()).toBe('Sair');
    botao.click();
    expect(sessao.autenticado()).toBeFalse();
    expect(navegar).toHaveBeenCalledWith('/login');
  });
});
