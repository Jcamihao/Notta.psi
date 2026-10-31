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

  it('PSICOLOGO nao ve o link Equipe', () => {
    expect(el().querySelector('a[href="/equipe"]')).toBeNull();
  });
});

describe('ShellComponent (ADMIN)', () => {
  let ctrl: HttpTestingController;

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  it('ADMIN ve o link Equipe com aria-current na rota ativa', async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([{ path: 'equipe', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    ctrl = TestBed.inject(HttpTestingController);
    TestBed.inject(SessaoStore).entrar('t');
    const fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();
    ctrl.expectOne('/api/eu').flush({
      psicologoId: 'p1',
      nome: 'Ana Souza',
      email: 'ana@clinica.com',
      papel: 'ADMIN',
      abordagemPadrao: 'TCC',
      clinica: { id: 'c1', nome: 'Clinica Horizonte' },
    });
    await fixture.whenStable();
    const link = () =>
      (fixture.nativeElement as HTMLElement).querySelector('header a[href="/equipe"]');
    expect(link()?.textContent?.trim()).toBe('Equipe');
    expect(link()?.getAttribute('aria-current')).toBeNull();
    await TestBed.inject(Router).navigateByUrl('/equipe');
    await fixture.whenStable();
    expect(link()?.getAttribute('aria-current')).toBe('page');
  });
});

describe('ShellComponent (troca de senha)', () => {
  let ctrl: HttpTestingController;
  let fixture: ComponentFixture<ShellComponent>;

  const montar = async (senhaProvisoria: boolean, papel = 'ADMIN') => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([{ path: 'trocar-senha', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    ctrl = TestBed.inject(HttpTestingController);
    TestBed.inject(SessaoStore).entrar('t');
    fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();
    ctrl.expectOne('/api/eu').flush({
      psicologoId: 'p1',
      nome: 'Ana Souza',
      email: 'ana@clinica.com',
      papel,
      abordagemPadrao: 'TCC',
      clinica: { id: 'c1', nome: 'Clinica Horizonte' },
      senhaProvisoria,
    });
    await fixture.whenStable();
  };
  const el = () => fixture.nativeElement as HTMLElement;

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  it('modo voluntario mostra o link Trocar senha', async () => {
    await montar(false, 'PSICOLOGO');
    expect(el().querySelector('header a[href="/trocar-senha"]')?.textContent?.trim()).toBe(
      'Trocar senha',
    );
  });

  it('modo obrigatorio esconde a navegacao: sobra so o botao Sair', async () => {
    await montar(true);
    const topo = el().querySelector('header')!;
    expect(topo.querySelectorAll('a').length).toBe(0);
    expect(topo.querySelector('nav')).toBeNull();
    const botoes = Array.from(topo.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(botoes).toEqual(['Sair']);
    expect(topo.textContent).toContain('Notta.psi');
  });

  it('depois da troca mostra uma confirmacao leve, que some na proxima navegacao', async () => {
    await montar(false);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/', { state: { senhaTrocada: true } });
    await fixture.whenStable();
    const aviso = () => el().querySelector('[data-teste="senha-trocada"]');
    expect(aviso()?.textContent).toContain('Senha alterada');
    expect(aviso()?.closest('[aria-live]')).not.toBeNull();
    await router.navigateByUrl('/trocar-senha');
    await fixture.whenStable();
    expect(aviso()).toBeNull();
  });
});
