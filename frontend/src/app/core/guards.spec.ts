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
import { SessaoStore } from './sessao.store';
import { visitanteGuard } from './visitante.guard';

describe('guards', () => {
  let sessao: SessaoStore;
  let router: Router;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    sessao = TestBed.inject(SessaoStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => sessionStorage.clear());

  const rodar = (g: CanActivateFn) =>
    TestBed.runInInjectionContext(() => g({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
  const destino = (r: unknown) => router.serializeUrl(r as UrlTree);

  it('authGuard sem token vai para /login', () => {
    expect(destino(rodar(authGuard))).toBe('/login');
  });

  it('authGuard com token passa', () => {
    sessao.entrar('t');
    expect(rodar(authGuard)).toBeTrue();
  });

  it('visitanteGuard sem token passa', () => {
    expect(rodar(visitanteGuard)).toBeTrue();
  });

  it('visitanteGuard com token vai para /', () => {
    sessao.entrar('t');
    expect(destino(rodar(visitanteGuard))).toBe('/');
  });
});
