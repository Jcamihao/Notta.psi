import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { authGuard } from './auth.guard';
import { Eu, SessaoStore } from './sessao.store';
import { visitanteGuard } from './visitante.guard';

const EU: Eu = {
  psicologoId: 'p1',
  nome: 'Ana Souza',
  email: 'ana@clinica.com',
  papel: 'PSICOLOGO',
  abordagemPadrao: 'TCC',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
  senhaProvisoria: false,
};

describe('guards', () => {
  let ctrl: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => ctrl.verify());

  const rodar = (g: CanActivateFn) =>
    TestBed.runInInjectionContext(() =>
      g({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
  const destino = (r: unknown) => router.serializeUrl(r as UrlTree);
  const tick = () => new Promise((r) => setTimeout(r));

  it('authGuard espera o /eu; sem sessao (401) vai para /login', async () => {
    const d = rodar(authGuard);
    await tick();
    ctrl.expectOne('/api/eu').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(destino(await d)).toBe('/login');
  });

  it('authGuard com sessao no /eu passa', async () => {
    const d = rodar(authGuard);
    await tick();
    ctrl.expectOne('/api/eu').flush(EU);
    expect(await d).toBeTrue();
  });

  it('authGuard nao consulta o /eu de novo se a sessao ja e conhecida', async () => {
    TestBed.inject(SessaoStore).entrar(EU);
    expect(await rodar(authGuard)).toBeTrue();
    ctrl.expectNone('/api/eu');
  });

  it('visitanteGuard sem sessao passa (401 no /eu e silencioso)', async () => {
    const d = rodar(visitanteGuard);
    await tick();
    ctrl.expectOne('/api/eu').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(await d).toBeTrue();
  });

  it('visitanteGuard com sessao vai para /', async () => {
    const d = rodar(visitanteGuard);
    await tick();
    ctrl.expectOne('/api/eu').flush(EU);
    expect(destino(await d)).toBe('/');
  });

  it('a consulta do /eu e uma so para os dois guards', async () => {
    const a = rodar(authGuard);
    const b = rodar(visitanteGuard);
    await tick();
    ctrl.expectOne('/api/eu').flush(EU);
    expect(await a).toBeTrue();
    expect(destino(await b)).toBe('/');
  });
});
