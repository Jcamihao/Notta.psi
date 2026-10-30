import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
    await h.navigateByUrl('/');
    expect(h.routeNativeElement?.textContent).toContain('Inicio');
    expect(h.routeNativeElement?.querySelector('header')).not.toBeNull();
  });

  it('com sessao, /login e /cadastro voltam para /', async () => {
    sessionStorage.setItem('notta.token', 't');
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/login');
    expect(url()).toBe('/');
    await h.navigateByUrl('/cadastro');
    expect(url()).toBe('/');
  });

  it('rota desconhecida vai para /', async () => {
    sessionStorage.setItem('notta.token', 't');
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/nao-existe');
    expect(url()).toBe('/');
  });
});
