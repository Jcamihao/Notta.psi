import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { Observable } from 'rxjs';
import { senhaProvisoriaGuard } from './senha-provisoria.guard';
import { Eu } from './usuario.store';

const EU: Eu = {
  psicologoId: 'p1',
  nome: 'Bruno Lima',
  email: 'bruno@clinica.com',
  papel: 'PSICOLOGO',
  abordagemPadrao: 'TCC',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
  senhaProvisoria: true,
};

describe('senhaProvisoriaGuard', () => {
  let ctrl: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('notta.token', 'tok');
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  // Roda o guard para a rota filha `path` e devolve a decisao (undefined = ainda esperando).
  const rodar = (path: string) => {
    let decisao: unknown;
    const rota = { routeConfig: { path } } as ActivatedRouteSnapshot;
    const r = TestBed.runInInjectionContext(() =>
      senhaProvisoriaGuard(rota, {} as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;
    r.subscribe((v) => (decisao = v));
    TestBed.tick();
    return () => decisao;
  };
  const destino = (r: unknown) => router.serializeUrl(r as UrlTree);

  it('espera o /eu; senha provisoria leva qualquer rota para /trocar-senha', () => {
    const decisao = rodar('equipe');
    expect(decisao()).toBeUndefined();
    ctrl.expectOne('/api/eu').flush(EU);
    TestBed.tick();
    expect(destino(decisao())).toBe('/trocar-senha');
  });

  it('a propria /trocar-senha passa (sem laco)', () => {
    const decisao = rodar('trocar-senha');
    ctrl.expectOne('/api/eu').flush(EU);
    TestBed.tick();
    expect(decisao()).toBeTrue();
  });

  it('sem senha provisoria deixa passar', () => {
    const decisao = rodar('');
    ctrl.expectOne('/api/eu').flush({ ...EU, senhaProvisoria: false });
    TestBed.tick();
    expect(decisao()).toBeTrue();
  });

  it('/eu falhou (rede) deixa passar: o servidor bloqueia com 403', () => {
    const decisao = rodar('');
    ctrl.expectOne('/api/eu').error(new ProgressEvent('error'));
    TestBed.tick();
    expect(decisao()).toBeTrue();
  });
});
