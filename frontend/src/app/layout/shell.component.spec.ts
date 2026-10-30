import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SessaoStore } from '../core/sessao.store';
import { UsuarioStore } from '../core/usuario.store';
import { ShellComponent } from './shell.component';

describe('ShellComponent', () => {
  let fixture: ComponentFixture<ShellComponent>;
  let sessao: SessaoStore;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    sessao = TestBed.inject(SessaoStore);
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    sessao.entrar('t');
    fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();
    ctrl.expectOne('/api/eu').flush({
      psicologoId: 'p1',
      nome: 'Ana Souza',
      email: 'ana@clinica.com',
      papel: 'PSICOLOGO',
      abordagemPadrao: 'TCC',
      clinica: { id: 'c1', nome: 'Clinica Horizonte' },
    });
    await fixture.whenStable();
  });

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('tem landmarks header e main e o nome do app', () => {
    expect(el().querySelector('header')?.textContent).toContain('Notta.psi');
    expect(el().querySelector('main router-outlet')).not.toBeNull();
  });

  it('mostra o nome da clinica e do psicologo no cabecalho', () => {
    const topo = el().querySelector('header')!.textContent!;
    expect(topo).toContain('Clinica Horizonte');
    expect(topo).toContain('Ana Souza');
  });

  it('botao Sair limpa sessao e usuario e navega para /login', () => {
    const botao = el().querySelector('header button') as HTMLButtonElement;
    expect(botao.textContent?.trim()).toBe('Sair');
    botao.click();
    expect(sessao.autenticado()).toBeFalse();
    expect(TestBed.inject(UsuarioStore).usuario()).toBeNull();
    expect(navegar).toHaveBeenCalledWith('/login');
  });
});
