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
import { adminGuard } from './admin.guard';
import { Eu } from './usuario.store';

const EU: Eu = {
  psicologoId: 'p1',
  nome: 'Ana Souza',
  email: 'ana@clinica.com',
  papel: 'ADMIN',
  abordagemPadrao: 'TCC',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
  senhaProvisoria: false,
};

describe('adminGuard', () => {
  let ctrl: HttpTestingController;
  let router: Router;

  const configurar = (token: string | null) => {
    sessionStorage.clear();
    if (token) sessionStorage.setItem('notta.token', token);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  };

  // Roda o guard e devolve o que ele decidiu (undefined = ainda esperando).
  const rodar = () => {
    let decisao: unknown;
    const r = TestBed.runInInjectionContext(() =>
      adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;
    r.subscribe((v) => (decisao = v));
    TestBed.tick();
    return () => decisao;
  };
  const destino = (r: unknown) => router.serializeUrl(r as UrlTree);

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  it('espera o /eu e deixa ADMIN entrar', () => {
    configurar('tok');
    const decisao = rodar();
    expect(decisao()).toBeUndefined();
    ctrl.expectOne('/api/eu').flush(EU);
    TestBed.tick();
    expect(decisao()).toBeTrue();
  });

  it('PSICOLOGO vai para /', () => {
    configurar('tok');
    const decisao = rodar();
    ctrl.expectOne('/api/eu').flush({ ...EU, papel: 'PSICOLOGO' });
    TestBed.tick();
    expect(destino(decisao())).toBe('/');
  });

  it('sem sessao vai para /login', () => {
    configurar(null);
    const decisao = rodar();
    expect(destino(decisao())).toBe('/login');
  });

  it('/eu falhou (rede) vai para /', () => {
    configurar('tok');
    const decisao = rodar();
    ctrl.expectOne('/api/eu').error(new ProgressEvent('error'));
    TestBed.tick();
    expect(destino(decisao())).toBe('/');
  });
});
