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
  // Navega com sessao (cookie valido no navegador): o primeiro guard consulta o /eu uma vez.
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

  // Sem sessao: o /eu responde 401 e e so isso (visitante, sem erro).
  const navegarSemSessao = async (h: RouterTestingHarness, destino: string) => {
    const nav = h.navigateByUrl(destino);
    await new Promise((r) => setTimeout(r));
    TestBed.tick();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/eu')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await nav;
  };

  it('sem sessao, / cai em /login (tela Entrar) e o /eu so e consultado uma vez', async () => {
    const h = await RouterTestingHarness.create();
    await navegarSemSessao(h, '/');
    await h.navigateByUrl('/cadastro');
    expect(url()).toBe('/cadastro');
    await h.navigateByUrl('/login');
    expect(url()).toBe('/login');
    expect(h.routeNativeElement?.querySelector('h1')?.textContent).toContain('Entrar');
  });

  it('sem sessao, /cadastro abre a tela de cadastro', async () => {
    const h = await RouterTestingHarness.create();
    await navegarSemSessao(h, '/cadastro');
    expect(url()).toBe('/cadastro');
    expect(h.routeNativeElement?.querySelector('form')).not.toBeNull();
  });

  it('a pagina publica do termo nao consulta o /eu', async () => {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/termo/abc');
    const ctrl = TestBed.inject(HttpTestingController);
    ctrl.expectNone('/api/eu');
    ctrl.expectOne('/api/publico/consentimento/abc').flush({}, { status: 404, statusText: 'x' });
    expect(url()).toBe('/termo/abc');
  });

  it('com sessao, / mostra o shell e a pagina Inicio', async () => {
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/');
    expect(url()).toBe('/');
    expect(h.routeNativeElement?.textContent).toContain('Início');
    expect(h.routeNativeElement?.querySelector('header')).not.toBeNull();
  });

  it('com sessao, /login e /cadastro voltam para /', async () => {
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/login');
    expect(url()).toBe('/');
    await h.navigateByUrl('/cadastro');
    expect(url()).toBe('/');
  });

  it('rota desconhecida vai para /', async () => {
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/nao-existe');
    expect(url()).toBe('/');
  });

  it('com senha provisoria, qualquer rota do shell vai para /trocar-senha', async () => {
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/equipe', true);
    expect(url()).toBe('/trocar-senha');
    expect(h.routeNativeElement?.querySelector('#ts-senhaAtual')).not.toBeNull();
    await h.navigateByUrl('/');
    expect(url()).toBe('/trocar-senha');
  });

  it('sem senha provisoria, /trocar-senha abre normalmente', async () => {
    const h = await RouterTestingHarness.create();
    await navegarComEu(h, '/trocar-senha');
    expect(url()).toBe('/trocar-senha');
  });
});
