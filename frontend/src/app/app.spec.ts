import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

describe('rotas', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => sessionStorage.clear());

  const url = () => TestBed.inject(Router).url;
  const EU = {
    psicologoId: 'p1',
    nome: 'Ana Souza',
    email: 'ana@clinica.com',
    papel: 'ADMIN',
    abordagemPadrao: 'TCC',
    clinica: { id: 'c1', nome: 'Clinica Horizonte' },
    senhaProvisoria: false,
  };
  // Navega com sessao: as rotas do shell esperam o /eu responder.
  const navegarComEu = async (
    h: RouterTestingHarness,
    destino: string,
    senhaProvisoria = false,
  ) => {
    const nav = h.navigateByUrl(destino);
    await new Promise((r) => setTimeout(r));
    TestBed.tick();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/eu')
      .flush({ ...EU, senhaProvisoria });
    await nav;
  };

  it('sem sessao, / cai em /login (tela Entrar)', async () => {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/');
    expect(url()).toBe('/login');
    expect(h.routeNativeElement?.querySelector('h1')?.textContent).toContain('Entrar');
  });

  it('sem sessao, /cadastro abre a tela de cadastro', async () => {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/cadastro');
    expect(url()).toBe('/cadastro');
    expect(h.routeNativeElement?.querySelector('form')).not.toBeNull();
  });

  it('com sessao, / mostra o shell e a pagina Inicio', async () => {
    sessionStorage.setItem('notta.token', 't');
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/');
    expect(url()).toBe('/');
    expect(h.routeNativeElement?.textContent).toContain('Inicio');
    expect(h.routeNativeElement?.querySelector('header')).not.toBeNull();
  });

  it('com sessao, /login e /cadastro voltam para /', async () => {
    sessionStorage.setItem('notta.token', 't');
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/login');
    expect(url()).toBe('/');
    await h.navigateByUrl('/cadastro');
    expect(url()).toBe('/');
  });

  it('rota desconhecida vai para /', async () => {
    sessionStorage.setItem('notta.token', 't');
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/nao-existe');
    expect(url()).toBe('/');
  });

  it('com senha provisoria, qualquer rota do shell vai para /trocar-senha', async () => {
    sessionStorage.setItem('notta.token', 't');
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/equipe', true);
    expect(url()).toBe('/trocar-senha');
    expect(h.routeNativeElement?.querySelector('#ts-senhaAtual')).not.toBeNull();
    await h.navigateByUrl('/');
    expect(url()).toBe('/trocar-senha');
  });

  it('sem senha provisoria, /trocar-senha abre normalmente', async () => {
    sessionStorage.setItem('notta.token', 't');
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/trocar-senha');
    expect(url()).toBe('/trocar-senha');
  });
});
