import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SessaoStore } from './sessao.store';
import { Eu, UsuarioStore } from './usuario.store';

const EU: Eu = {
  psicologoId: 'p1',
  nome: 'Ana Souza',
  email: 'ana@clinica.com',
  papel: 'ADMIN',
  abordagemPadrao: 'TCC',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
};

describe('UsuarioStore', () => {
  let ctrl: HttpTestingController;

  const configurar = () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
  };

  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  it('sem sessao nao chama /eu e fica vazio', () => {
    configurar();
    const u = TestBed.inject(UsuarioStore);
    TestBed.tick();
    ctrl.expectNone('/api/eu');
    expect(u.usuario()).toBeNull();
  });

  it('ao entrar carrega GET /api/eu e guarda o usuario', () => {
    configurar();
    const u = TestBed.inject(UsuarioStore);
    TestBed.inject(SessaoStore).entrar('tok');
    TestBed.tick();
    const r = ctrl.expectOne('/api/eu');
    expect(r.request.method).toBe('GET');
    r.flush(EU);
    expect(u.usuario()?.nome).toBe('Ana Souza');
    expect(u.usuario()?.clinica.nome).toBe('Clinica Horizonte');
    expect(u.usuario()?.papel).toBe('ADMIN');
  });

  it('ao restaurar sessao no boot carrega /eu', () => {
    sessionStorage.setItem('notta.token', 'guardado');
    configurar();
    const u = TestBed.inject(UsuarioStore);
    TestBed.tick();
    ctrl.expectOne('/api/eu').flush(EU);
    expect(u.usuario()?.nome).toBe('Ana Souza');
  });

  it('sair limpa o usuario e a sessao', () => {
    configurar();
    const u = TestBed.inject(UsuarioStore);
    const sessao = TestBed.inject(SessaoStore);
    sessao.entrar('tok');
    TestBed.tick();
    ctrl.expectOne('/api/eu').flush(EU);
    u.sair();
    expect(u.usuario()).toBeNull();
    expect(sessao.autenticado()).toBeFalse();
  });

  it('sessao derrubada por fora (ex.: 401) tambem limpa o usuario', () => {
    configurar();
    const u = TestBed.inject(UsuarioStore);
    const sessao = TestBed.inject(SessaoStore);
    sessao.entrar('tok');
    TestBed.tick();
    ctrl.expectOne('/api/eu').flush(EU);
    sessao.sair();
    TestBed.tick();
    expect(u.usuario()).toBeNull();
  });
});
