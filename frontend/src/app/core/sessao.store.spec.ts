import { TestBed } from '@angular/core/testing';
import { SessaoStore } from './sessao.store';

describe('SessaoStore', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  const criar = () => TestBed.inject(SessaoStore);

  it('comeca sem token e nao autenticado', () => {
    const s = criar();
    expect(s.token()).toBeNull();
    expect(s.autenticado()).toBeFalse();
  });

  it('entrar guarda o token, persiste e torna autenticado reativo', () => {
    const s = criar();
    s.entrar('abc');
    expect(s.token()).toBe('abc');
    expect(s.autenticado()).toBeTrue();
    expect(sessionStorage.getItem('notta.token')).toBe('abc');
  });

  it('sair limpa signal e sessionStorage', () => {
    const s = criar();
    s.entrar('abc');
    s.sair();
    expect(s.token()).toBeNull();
    expect(s.autenticado()).toBeFalse();
    expect(sessionStorage.getItem('notta.token')).toBeNull();
  });

  it('restaura o token do sessionStorage ao recriar', () => {
    sessionStorage.setItem('notta.token', 'guardado');
    const s = criar();
    expect(s.token()).toBe('guardado');
    expect(s.autenticado()).toBeTrue();
  });
});
