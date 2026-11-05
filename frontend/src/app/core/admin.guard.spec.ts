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
import { adminGuard } from './admin.guard';
import { Eu } from './sessao.store';

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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => ctrl.verify());

  // Roda o guard e devolve o que ele decidiu (undefined = ainda esperando).
  const rodar = () => {
    let decisao: unknown;
    void (
      TestBed.runInInjectionContext(() =>
        adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      ) as Promise<boolean | UrlTree>
    ).then((v) => (decisao = v));
    return () => decisao;
  };
  const destino = (r: unknown) => router.serializeUrl(r as UrlTree);
  const tick = () => new Promise((r) => setTimeout(r));
  const responder = async (corpo: object | null, status = 200) => {
    await tick();
    const r = ctrl.expectOne('/api/eu');
    if (status === 0) r.error(new ProgressEvent('error'));
    else r.flush(corpo, { status, statusText: 'x' });
    await tick();
  };

  it('espera o /eu e deixa ADMIN entrar', async () => {
    const decisao = rodar();
    await tick();
    expect(decisao()).toBeUndefined();
    await responder(EU);
    expect(decisao()).toBeTrue();
  });

  it('PSICOLOGO vai para /', async () => {
    const decisao = rodar();
    await responder({ ...EU, papel: 'PSICOLOGO' });
    expect(destino(decisao())).toBe('/');
  });

  it('sem sessao (401) vai para /login', async () => {
    const decisao = rodar();
    await responder({}, 401);
    expect(destino(decisao())).toBe('/login');
  });

  it('/eu falhou (rede) vai para /login: sem sessao confirmada nao ha tela de ADMIN', async () => {
    const decisao = rodar();
    await responder(null, 0);
    expect(destino(decisao())).toBe('/login');
  });
});
