import { HttpClient } from '@angular/common/http';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { Eu, SessaoStore, WEB_LOCKS } from './sessao.store';

const EU: Eu = {
  psicologoId: 'p1',
  nome: 'Ana Souza',
  email: 'ana@clinica.com',
  papel: 'PSICOLOGO',
  abordagemPadrao: 'TCC',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
  senhaProvisoria: false,
};
const NAO_AUTORIZADO = { status: 401, statusText: 'Unauthorized' };

const definirCsrf = (v: string) => (document.cookie = `praxis_csrf=${v}; path=/`);
const apagarCsrf = () =>
  (document.cookie = 'praxis_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT');
const tick = () => new Promise((r) => setTimeout(r));

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let sessao: SessaoStore;
  let navegar: jasmine.Spy;

  beforeEach(() => {
    apagarCsrf();
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: WEB_LOCKS, useValue: null },
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    sessao = TestBed.inject(SessaoStore);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    sessao.entrar(EU);
  });

  afterEach(() => {
    ctrl.verify();
    apagarCsrf();
    sessionStorage.clear();
  });

  // Dispara a chamada e guarda o resultado (valor ou erro) para conferir depois.
  const chamar = (metodo: string, url: string, corpo: unknown = {}) => {
    const r: { valor?: unknown; erro?: { status: number }; fim: boolean } = { fim: false };
    http.request(metodo, url, { body: corpo }).subscribe({
      next: (v) => (r.valor = v),
      error: (e) => ((r.erro = e), (r.fim = true)),
      complete: () => (r.fim = true),
    });
    return r;
  };
  const sondagem = () => ctrl.expectOne((r) => r.method === 'GET' && r.url === '/api/eu');
  const renovar = () => ctrl.expectOne('/api/auth/renovar');

  describe('CSRF e credenciais', () => {
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      it(`${metodo} em /api/ leva X-CSRF-Token com o valor do cookie praxis_csrf`, () => {
        definirCsrf('csrf-1');
        chamar(metodo, '/api/pacientes');
        const r = ctrl.expectOne('/api/pacientes');
        expect(r.request.headers.get('X-CSRF-Token')).toBe('csrf-1');
        r.flush({});
      });
    }

    it('GET nao leva X-CSRF-Token', () => {
      definirCsrf('csrf-1');
      chamar('GET', '/api/pacientes');
      const r = ctrl.expectOne('/api/pacientes');
      expect(r.request.headers.has('X-CSRF-Token')).toBeFalse();
      r.flush({});
    });

    it('le o cookie a cada chamada (valor novo vale na proxima)', () => {
      definirCsrf('um');
      chamar('POST', '/api/a');
      expect(ctrl.expectOne('/api/a').request.headers.get('X-CSRF-Token')).toBe('um');
      definirCsrf('dois');
      chamar('POST', '/api/b');
      expect(ctrl.expectOne('/api/b').request.headers.get('X-CSRF-Token')).toBe('dois');
    });

    it('sem cookie nao inventa header', () => {
      chamar('POST', '/api/pacientes');
      const r = ctrl.expectOne('/api/pacientes');
      expect(r.request.headers.has('X-CSRF-Token')).toBeFalse();
    });

    it('nunca manda Authorization nem o cabecalho de cliente api', () => {
      definirCsrf('csrf-1');
      chamar('POST', '/api/pacientes');
      chamar('GET', '/api/eu');
      for (const r of ctrl.match(() => true)) {
        expect(r.request.headers.has('Authorization')).toBeFalse();
        expect(r.request.headers.has('x-praxis-cliente')).toBeFalse();
      }
    });

    it('fora de /api/ nao anexa nada', () => {
      definirCsrf('csrf-1');
      chamar('POST', 'https://outro.site/api/x');
      chamar('POST', '/apix/y');
      expect(
        ctrl.expectOne('https://outro.site/api/x').request.headers.has('X-CSRF-Token'),
      ).toBeFalse();
      expect(ctrl.expectOne('/apix/y').request.headers.has('X-CSRF-Token')).toBeFalse();
    });

    for (const url of ['/api/auth/login', '/api/clinicas', '/api/auth/renovar']) {
      it(`POST ${url} (ainda sem sessao) nao leva CSRF`, () => {
        definirCsrf('csrf-1');
        chamar('POST', url);
        const r = ctrl.expectOne(url);
        expect(r.request.headers.has('X-CSRF-Token')).toBeFalse();
        r.flush({});
      });
    }
  });

  describe('rota publica do termo', () => {
    it('nao anexa CSRF mesmo com sessao e cookie', () => {
      definirCsrf('csrf-1');
      chamar('POST', '/api/publico/consentimento/abc/aceitar');
      const r = ctrl.expectOne('/api/publico/consentimento/abc/aceitar');
      expect(r.request.headers.has('X-CSRF-Token')).toBeFalse();
      expect(r.request.headers.has('Authorization')).toBeFalse();
      r.flush({});
    });

    it('401 e 403 de senha provisoria NAO renovam, deslogam nem redirecionam', async () => {
      definirCsrf('csrf-1');
      chamar('GET', '/api/publico/consentimento/abc');
      ctrl.expectOne('/api/publico/consentimento/abc').flush({}, NAO_AUTORIZADO);
      chamar('POST', '/api/publico/consentimento/abc/aceitar');
      ctrl
        .expectOne('/api/publico/consentimento/abc/aceitar')
        .flush({ message: 'Troca de senha obrigatoria' }, { status: 403, statusText: 'Forbidden' });
      await tick();
      ctrl.expectNone('/api/auth/renovar');
      ctrl.expectNone('/api/eu');
      expect(sessao.autenticado()).toBeTrue();
      expect(navegar).not.toHaveBeenCalled();
    });
  });

  describe('401: renovar uma vez e repetir', () => {
    it('renova e repete a chamada original, que entrega o resultado normalmente', async () => {
      definirCsrf('csrf-1');
      const c = chamar('POST', '/api/pacientes', { nome: 'X' });
      ctrl.expectOne('/api/pacientes').flush({}, NAO_AUTORIZADO);
      await tick();
      sondagem().flush({}, NAO_AUTORIZADO); // acesso vencido de verdade
      await tick();
      const r = renovar();
      expect(r.request.method).toBe('POST');
      r.flush({ ok: true });
      await tick();
      const repetida = ctrl.expectOne('/api/pacientes');
      expect(repetida.request.method).toBe('POST');
      expect(repetida.request.body).toEqual({ nome: 'X' });
      expect(repetida.request.headers.get('X-CSRF-Token')).toBe('csrf-1');
      repetida.flush({ id: 'novo' });
      expect(c.valor).toEqual({ id: 'novo' });
      expect(c.erro).toBeUndefined();
      expect(sessao.autenticado()).toBeTrue();
      expect(navegar).not.toHaveBeenCalled();
    });

    it('varias chamadas concorrentes em 401: UMA renovacao, todas repetidas', async () => {
      definirCsrf('csrf-1');
      const a = chamar('GET', '/api/a');
      const b = chamar('GET', '/api/b');
      const c = chamar('POST', '/api/c');
      for (const u of ['/api/a', '/api/b', '/api/c']) ctrl.expectOne(u).flush({}, NAO_AUTORIZADO);
      await tick();
      sondagem().flush({}, NAO_AUTORIZADO);
      await tick();
      renovar().flush({ ok: true });
      await tick();
      ctrl.expectOne('/api/a').flush('A');
      ctrl.expectOne('/api/b').flush('B');
      ctrl.expectOne('/api/c').flush('C');
      expect([a.valor, b.valor, c.valor]).toEqual(['A', 'B', 'C']);
      expect(sessao.autenticado()).toBeTrue();
    });

    it('outra aba ja renovou (a sondagem /eu passa): nao chama renovar, so repete', async () => {
      definirCsrf('csrf-1');
      const c = chamar('GET', '/api/pacientes');
      ctrl.expectOne('/api/pacientes').flush({}, NAO_AUTORIZADO);
      await tick();
      sondagem().flush(EU);
      await tick();
      ctrl.expectNone('/api/auth/renovar');
      ctrl.expectOne('/api/pacientes').flush(['p']);
      expect(c.valor).toEqual(['p']);
    });

    it('SEM LACO: se a repeticao tambem der 401, desloga sem renovar de novo', async () => {
      definirCsrf('csrf-1');
      const c = chamar('GET', '/api/pacientes');
      ctrl.expectOne('/api/pacientes').flush({}, NAO_AUTORIZADO);
      await tick();
      sondagem().flush({}, NAO_AUTORIZADO);
      await tick();
      renovar().flush({ ok: true });
      await tick();
      ctrl.expectOne('/api/pacientes').flush({}, NAO_AUTORIZADO);
      await tick();
      ctrl.expectNone('/api/auth/renovar');
      ctrl.expectNone('/api/pacientes');
      expect(c.erro?.status).toBe(401);
      expect(sessao.autenticado()).toBeFalse();
      expect(sessao.expirada()).toBeTrue();
      expect(navegar).toHaveBeenCalledOnceWith('/login');
    });

    it('renovar 401: limpa o estado, avisa "sessao expirou" e vai ao login', async () => {
      definirCsrf('csrf-1');
      const c = chamar('GET', '/api/pacientes');
      ctrl.expectOne('/api/pacientes').flush({}, NAO_AUTORIZADO);
      await tick();
      sondagem().flush({}, NAO_AUTORIZADO);
      await tick();
      renovar().flush({}, NAO_AUTORIZADO);
      await tick();
      ctrl.expectNone('/api/pacientes');
      expect(c.erro?.status).toBe(401);
      expect(sessao.autenticado()).toBeFalse();
      expect(sessao.expirada()).toBeTrue();
      expect(navegar).toHaveBeenCalledOnceWith('/login');
    });

    it('chamadas concorrentes com renovacao negada: um unico redirecionamento', async () => {
      definirCsrf('csrf-1');
      const a = chamar('GET', '/api/a');
      const b = chamar('GET', '/api/b');
      ctrl.expectOne('/api/a').flush({}, NAO_AUTORIZADO);
      ctrl.expectOne('/api/b').flush({}, NAO_AUTORIZADO);
      await tick();
      sondagem().flush({}, NAO_AUTORIZADO);
      await tick();
      renovar().flush({}, NAO_AUTORIZADO);
      await tick();
      expect([a.erro?.status, b.erro?.status]).toEqual([401, 401]);
      expect(navegar).toHaveBeenCalledOnceWith('/login');
    });

    it('sem cookie de sessao (sair em outra aba): nem tenta renovar, vai ao login', async () => {
      const c = chamar('GET', '/api/pacientes');
      ctrl.expectOne('/api/pacientes').flush({}, NAO_AUTORIZADO);
      await tick();
      ctrl.expectNone('/api/eu');
      ctrl.expectNone('/api/auth/renovar');
      expect(c.erro?.status).toBe(401);
      expect(sessao.autenticado()).toBeFalse();
      expect(sessao.expirada()).toBeTrue();
      expect(navegar).toHaveBeenCalledOnceWith('/login');
    });

    for (const status of [503, 429, 0]) {
      it(`renovar ${status}: NAO desloga e o erro original chega a quem chamou`, async () => {
        definirCsrf('csrf-1');
        const c = chamar('GET', '/api/pacientes');
        ctrl.expectOne('/api/pacientes').flush({}, NAO_AUTORIZADO);
        await tick();
        sondagem().flush({}, NAO_AUTORIZADO);
        await tick();
        const r = renovar();
        if (status === 0) r.error(new ProgressEvent('error'));
        else r.flush({}, { status, statusText: 'x' });
        await tick();
        expect(c.erro?.status).toBe(401);
        expect(sessao.autenticado()).toBeTrue();
        expect(sessao.expirada()).toBeFalse();
        expect(navegar).not.toHaveBeenCalled();
      });
    }

    it('visitante abrindo o app (sem sessao, sem cookie): 401 e silencioso', async () => {
      sessao.limpar();
      const c = chamar('GET', '/api/eu');
      ctrl.expectOne('/api/eu').flush({}, NAO_AUTORIZADO);
      await tick();
      expect(c.erro?.status).toBe(401);
      expect(sessao.expirada()).toBeFalse();
      expect(navegar).not.toHaveBeenCalled();
      ctrl.expectNone('/api/auth/renovar');
    });

    it('recarregar a pagina com acesso vencido e refresh valido: renova e o /eu responde', async () => {
      sessao.limpar();
      definirCsrf('csrf-1');
      const c = chamar('GET', '/api/eu');
      ctrl.expectOne('/api/eu').flush({}, NAO_AUTORIZADO);
      await tick();
      sondagem().flush({}, NAO_AUTORIZADO);
      await tick();
      renovar().flush({ ok: true });
      await tick();
      ctrl.expectOne('/api/eu').flush(EU);
      expect(c.valor).toEqual(EU);
      expect(navegar).not.toHaveBeenCalled();
    });

    it('visitante com cookie velho: renovacao negada nao mostra aviso nem redireciona', async () => {
      sessao.limpar();
      definirCsrf('csrf-velho');
      const c = chamar('GET', '/api/eu');
      ctrl.expectOne('/api/eu').flush({}, NAO_AUTORIZADO);
      await tick();
      sondagem().flush({}, NAO_AUTORIZADO);
      await tick();
      renovar().flush({}, NAO_AUTORIZADO);
      await tick();
      expect(c.erro?.status).toBe(401);
      expect(sessao.expirada()).toBeFalse();
      expect(navegar).not.toHaveBeenCalled();
    });
  });

  describe('o que nao renova nem desloga', () => {
    for (const url of ['/api/auth/login', '/api/clinicas', '/api/auth/renovar']) {
      it(`401 de POST ${url} so chega ao chamador`, async () => {
        definirCsrf('csrf-1');
        const c = chamar('POST', url);
        ctrl.expectOne(url).flush({}, NAO_AUTORIZADO);
        await tick();
        ctrl.expectNone('/api/auth/renovar');
        ctrl.expectNone('/api/eu');
        expect(c.erro?.status).toBe(401);
        expect(sessao.autenticado()).toBeTrue();
        expect(navegar).not.toHaveBeenCalled();
      });
    }

    it('401 do "sair" (sessao ja morta) nao mostra "sessao expirou"', async () => {
      definirCsrf('csrf-1');
      const p = sessao.sair();
      ctrl.expectOne('/api/auth/sair').flush({}, NAO_AUTORIZADO);
      await p;
      ctrl.expectNone('/api/auth/renovar');
      expect(sessao.autenticado()).toBeFalse();
      expect(sessao.expirada()).toBeFalse();
      expect(navegar).not.toHaveBeenCalled();
    });

    it('"sair" leva o CSRF', async () => {
      definirCsrf('csrf-1');
      const p = sessao.sair();
      const r = ctrl.expectOne('/api/auth/sair');
      expect(r.request.headers.get('X-CSRF-Token')).toBe('csrf-1');
      r.flush({ ok: true });
      await p;
    });

    it('erro nao 401 nao limpa a sessao', () => {
      const c = chamar('GET', '/api/x');
      ctrl.expectOne('/api/x').flush({}, { status: 500, statusText: 'Erro' });
      expect(c.erro?.status).toBe(500);
      expect(sessao.autenticado()).toBeTrue();
      expect(navegar).not.toHaveBeenCalled();
    });

    for (const status of [503, 429]) {
      it(`${status} numa chamada normal nao renova nem desloga`, async () => {
        definirCsrf('csrf-1');
        chamar('GET', '/api/x');
        ctrl.expectOne('/api/x').flush({}, { status, statusText: 'x' });
        await tick();
        ctrl.expectNone('/api/auth/renovar');
        expect(sessao.autenticado()).toBeTrue();
        expect(navegar).not.toHaveBeenCalled();
      });
    }

    it('403 "Troca de senha obrigatoria" recarrega o /eu e vai para /trocar-senha', async () => {
      chamar('GET', '/api/pacientes');
      ctrl
        .expectOne('/api/pacientes')
        .flush(
          { statusCode: 403, message: 'Troca de senha obrigatoria', error: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' },
        );
      await tick();
      ctrl.expectOne('/api/eu').flush({ ...EU, senhaProvisoria: true });
      await tick();
      expect(navegar).toHaveBeenCalledWith('/trocar-senha');
      expect(sessao.senhaProvisoria()).toBeTrue();
      expect(sessao.autenticado()).toBeTrue();
    });

    it('outro 403 (CSRF, papel) nao redireciona, nao recarrega e nao desloga', async () => {
      chamar('GET', '/api/psicologos');
      ctrl
        .expectOne('/api/psicologos')
        .flush(
          { statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' },
        );
      await tick();
      ctrl.expectNone('/api/eu');
      ctrl.expectNone('/api/auth/renovar');
      expect(navegar).not.toHaveBeenCalled();
      expect(sessao.autenticado()).toBeTrue();
    });
  });
});
