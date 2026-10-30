import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

describe('rotas', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  afterEach(() => sessionStorage.clear());

  it('sem sessao, / cai em /login (placeholder Login)', async () => {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/');
    expect(TestBed.inject(Router).url).toBe('/login');
    expect(h.routeNativeElement?.textContent).toContain('Login');
  });

  it('com sessao, / mostra o shell e a pagina Inicio', async () => {
    sessionStorage.setItem('notta.token', 't');
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/');
    expect(h.routeNativeElement?.textContent).toContain('Inicio');
    expect(h.routeNativeElement?.querySelector('header')).not.toBeNull();
  });

  it('rota desconhecida vai para /', async () => {
    sessionStorage.setItem('notta.token', 't');
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/nao-existe');
    expect(TestBed.inject(Router).url).toBe('/');
  });
});
