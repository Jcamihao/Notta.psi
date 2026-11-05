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
import { senhaProvisoriaGuard } from './senha-provisoria.guard';
import { Eu, SessaoStore } from './sessao.store';

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
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => ctrl.verify());

  // Roda o guard para a rota filha `path` e devolve a decisao (undefined = ainda esperando).
  const rodar = (path: string) => {
    let decisao: unknown;
    const rota = { routeConfig: { path } } as ActivatedRouteSnapshot;
    void (
      TestBed.runInInjectionContext(() =>
        senhaProvisoriaGuard(rota, {} as RouterStateSnapshot),
      ) as Promise<boolean | UrlTree>
    ).then((v) => (decisao = v));
    return () => decisao;
  };
  const destino = (r: unknown) => router.serializeUrl(r as UrlTree);
  const tick = () => new Promise((r) => setTimeout(r));
  const responder = async (corpo: object | null, erro = false) => {
    await tick();
    const r = ctrl.expectOne('/api/eu');
    if (erro) r.error(new ProgressEvent('error'));
    else r.flush(corpo);
    await tick();
  };

  it('espera o /eu; senha provisoria leva qualquer rota para /trocar-senha', async () => {
    const decisao = rodar('equipe');
    await tick();
    expect(decisao()).toBeUndefined();
    await responder(EU);
    expect(destino(decisao())).toBe('/trocar-senha');
  });

  it('a propria /trocar-senha passa (sem laco)', async () => {
    const decisao = rodar('trocar-senha');
    await responder(EU);
    expect(decisao()).toBeTrue();
  });

  it('sem senha provisoria deixa passar', async () => {
    const decisao = rodar('');
    await responder({ ...EU, senhaProvisoria: false });
    expect(decisao()).toBeTrue();
  });

  it('/eu falhou (rede) deixa passar: o servidor bloqueia com 403', async () => {
    const decisao = rodar('');
    await responder(null, true);
    expect(decisao()).toBeTrue();
  });

  it('depois de trocar a senha o guard ja libera as rotas', async () => {
    const sessao = TestBed.inject(SessaoStore);
    sessao.entrar(EU);
    sessao.senhaTrocada();
    const decisao = rodar('');
    await tick();
    expect(decisao()).toBeTrue();
  });
});
