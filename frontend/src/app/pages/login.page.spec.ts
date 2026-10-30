import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SessaoStore } from '../core/sessao.store';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  beforeEach(async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
  });

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const input = (id: string) => el().querySelector(`#${id}`) as HTMLInputElement;
  const digitar = (id: string, valor: string) => {
    const i = input(id);
    i.value = valor;
    i.dispatchEvent(new Event('input'));
    i.dispatchEvent(new Event('blur'));
  };
  const enviar = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const preencher = () => {
    digitar('login-email', ' Ana@Clinica.com ');
    digitar('login-senha', 'senha-forte-1');
  };
  const alerta = () => el().querySelector('[data-teste="erro-geral"]')?.textContent?.trim() ?? '';

  it('200 guarda o token e navega para /', async () => {
    preencher();
    await enviar();
    const r = ctrl.expectOne('/api/auth/login');
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ email: 'Ana@Clinica.com', senha: 'senha-forte-1' });
    r.flush({ token: 'jwt-1' });
    await fixture.whenStable();
    expect(TestBed.inject(SessaoStore).token()).toBe('jwt-1');
    expect(navegar).toHaveBeenCalledWith('/');
  });

  it('401 mostra mensagem unica e limpa a senha', async () => {
    preencher();
    await enviar();
    ctrl
      .expectOne('/api/auth/login')
      .flush(
        { statusCode: 401, message: 'Credenciais invalidas' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await fixture.whenStable();
    expect(alerta()).toBe('E-mail ou senha incorretos.');
    expect(input('login-senha').value).toBe('');
    expect(input('login-email').value).toBe('Ana@Clinica.com');
    expect(TestBed.inject(SessaoStore).autenticado()).toBeFalse();
    expect(navegar).not.toHaveBeenCalled();
  });

  it('429 com Retry-After mostra os segundos', async () => {
    preencher();
    await enviar();
    ctrl
      .expectOne('/api/auth/login')
      .flush(
        { statusCode: 429, message: 'ThrottlerException' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '42' } },
      );
    await fixture.whenStable();
    expect(alerta()).toBe('Muitas tentativas. Tente de novo em 42 segundos.');
  });

  it('formulario vazio nao envia, marca os campos e foca o primeiro erro', async () => {
    await enviar();
    ctrl.expectNone('/api/auth/login');
    const email = input('login-email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(email);
  });

  it('nao mostra erro antes do blur', async () => {
    const i = input('login-email');
    i.value = 'x';
    i.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(i.getAttribute('aria-invalid')).toBeNull();
    i.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(i.getAttribute('aria-invalid')).toBe('true');
  });

  it('senha usa type=password e autocomplete current-password; link para /cadastro', () => {
    expect(input('login-senha').type).toBe('password');
    expect(input('login-senha').autocomplete).toBe('current-password');
    expect(input('login-email').autocomplete).toBe('email');
    expect(el().querySelector('a[href="/cadastro"]')).not.toBeNull();
  });

  it('cada input tem label associado', () => {
    el()
      .querySelectorAll('input, select')
      .forEach((i) => {
        expect(el().querySelector(`label[for="${i.id}"]`))
          .withContext(i.id)
          .not.toBeNull();
      });
  });
});
