import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { SessaoStore } from './sessao.store';

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let sessao: SessaoStore;
  let navegar: jasmine.Spy;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    sessao = TestBed.inject(SessaoStore);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    sessao.entrar('tok');
  });

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  it('anexa Bearer em /api/', () => {
    http.get('/api/pacientes').subscribe();
    const r = ctrl.expectOne('/api/pacientes');
    expect(r.request.headers.get('Authorization')).toBe('Bearer tok');
    r.flush({});
  });

  it('nao anexa Bearer fora de /api/', () => {
    http.get('https://outro.site/api/x').subscribe();
    http.get('/apix/y').subscribe();
    expect(
      ctrl.expectOne('https://outro.site/api/x').request.headers.has('Authorization'),
    ).toBeFalse();
    expect(ctrl.expectOne('/apix/y').request.headers.has('Authorization')).toBeFalse();
  });

  it('nao anexa Bearer sem token', () => {
    sessao.sair();
    http.get('/api/x').subscribe();
    expect(ctrl.expectOne('/api/x').request.headers.has('Authorization')).toBeFalse();
  });

  it('401 limpa a sessao e navega para /login', () => {
    http.get('/api/pacientes').subscribe({ error: () => undefined });
    ctrl.expectOne('/api/pacientes').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(sessao.autenticado()).toBeFalse();
    expect(navegar).toHaveBeenCalledWith('/login');
  });

  it('401 de POST /api/auth/login NAO limpa nem navega', () => {
    http.post('/api/auth/login', {}).subscribe({ error: () => undefined });
    ctrl.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(sessao.autenticado()).toBeTrue();
    expect(navegar).not.toHaveBeenCalled();
  });

  it('erro nao 401 nao limpa a sessao', () => {
    http.get('/api/x').subscribe({ error: () => undefined });
    ctrl.expectOne('/api/x').flush({}, { status: 500, statusText: 'Erro' });
    expect(sessao.autenticado()).toBeTrue();
    expect(navegar).not.toHaveBeenCalled();
  });
});
