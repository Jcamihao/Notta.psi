import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Eu, SessaoStore } from '../core/sessao.store';
import { CadastroPage } from './cadastro.page';

const EU: Eu = {
  psicologoId: 'p1',
  nome: 'Ana Souza',
  email: 'ana@clinica.com',
  papel: 'ADMIN',
  abordagemPadrao: 'SISTEMICA',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
  senhaProvisoria: false,
};

describe('CadastroPage', () => {
  let fixture: ComponentFixture<CadastroPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  beforeEach(async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      imports: [CadastroPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(CadastroPage);
    await fixture.whenStable();
  });

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const campo = (id: string) => el().querySelector(`#${id}`) as HTMLInputElement;
  const digitar = (id: string, valor: string) => {
    const i = campo(id);
    i.value = valor;
    i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input'));
    i.dispatchEvent(new Event('blur'));
  };
  const enviar = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const preencher = (senha = 'senha-forte-1') => {
    digitar('cad-clinica', '  Clinica Horizonte ');
    digitar('cad-nome', 'Ana Souza');
    digitar('cad-email', 'ana@clinica.com');
    digitar('cad-senha', senha);
    digitar('cad-abordagem', 'SISTEMICA');
  };
  const alerta = () => el().querySelector('[data-teste="erro-geral"]')?.textContent?.trim() ?? '';
  const botao = () => el().querySelector('button[type="submit"]') as HTMLButtonElement;
  const falhar = (url: string, status: number, headers: Record<string, string> = {}) =>
    ctrl.expectOne(url).flush(
      { statusCode: status, message: ['x'] },
      {
        status,
        statusText: 'Erro',
        headers,
      },
    );

  it('201 encadeia o login com o mesmo e-mail/senha, entra e navega para /', async () => {
    preencher();
    await enviar();
    const c = ctrl.expectOne('/api/clinicas');
    expect(c.request.method).toBe('POST');
    expect(c.request.body).toEqual({
      nomeClinica: 'Clinica Horizonte',
      nomePsicologo: 'Ana Souza',
      email: 'ana@clinica.com',
      senha: 'senha-forte-1',
      abordagemPadrao: 'SISTEMICA',
    });
    c.flush({ clinicaId: 'c1', psicologoId: 'p1' }, { status: 201, statusText: 'Created' });
    const l = ctrl.expectOne('/api/auth/login');
    expect(l.request.body).toEqual({ email: 'ana@clinica.com', senha: 'senha-forte-1' });
    l.flush({ usuario: EU });
    await fixture.whenStable();
    expect(TestBed.inject(SessaoStore).usuario()).toEqual(EU);
    expect(sessionStorage.length).toBe(0);
    expect(navegar).toHaveBeenCalledWith('/');
  });

  it('409 mostra o erro no campo e-mail', async () => {
    preencher();
    await enviar();
    falhar('/api/clinicas', 409);
    await fixture.whenStable();
    const email = campo('cad-email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    const erroId = email
      .getAttribute('aria-describedby')!
      .split(' ')
      .find((id) => /erro/.test(id))!;
    expect(document.getElementById(erroId)?.textContent).toContain('Este e-mail já tem cadastro');
    expect(document.activeElement).toBe(email);
    expect(navegar).not.toHaveBeenCalled();
  });

  it('422 COM motivo mostra o erro no campo da senha, mantem o texto e nao tenta entrar', async () => {
    const casos: [string, string][] = [
      ['COMUM', 'muito comum'],
      ['PESSOAL', 'nome nem o e-mail'],
      ['REPETIDA', 'repetições e sequências'],
      ['CURTA', 'pelo menos 10'],
      ['OUTRO', 'fraca demais'],
    ];
    for (const [motivo, trecho] of casos) {
      preencher('Senha1234!');
      await enviar();
      ctrl
        .expectOne('/api/clinicas')
        .flush(
          { statusCode: 422, message: 'Senha fraca: x', motivo },
          { status: 422, statusText: 'Unprocessable Entity' },
        );
      await fixture.whenStable();
      const senha = campo('cad-senha');
      expect(senha.getAttribute('aria-invalid')).withContext(motivo).toBe('true');
      const erroId = senha
        .getAttribute('aria-describedby')!
        .split(' ')
        .find((id) => /erro/.test(id))!;
      expect(document.getElementById(erroId)?.textContent).withContext(motivo).toContain(trecho);
      expect(document.activeElement).withContext(motivo).toBe(senha);
      expect(senha.value).toBe('Senha1234!');
      expect(alerta()).toBe('');
      ctrl.expectNone('/api/auth/login');
      expect(navegar).not.toHaveBeenCalled();
    }
  });

  it('a dica atualiza ao digitar (texto + aria-live polite) e some a falta quando a senha melhora', async () => {
    const dica = el().querySelector('app-senha-dica')!;
    expect(campo('cad-senha').getAttribute('aria-describedby')).toContain('cad-senha-dica');
    expect(dica.id).toBe('cad-senha-dica');
    expect(dica.querySelector('[aria-live="polite"]')).not.toBeNull();
    digitar('cad-nome', 'Ana Souza');
    digitar('cad-email', 'ana@clinica.com');
    digitar('cad-senha', '1111');
    await fixture.whenStable();
    expect(dica.textContent).toContain('Senha fraca: faltam 2 regras.');
    expect(dica.textContent).toContain('Não atende: 10 ou mais caracteres');
    digitar('cad-senha', 'x-ana-souza-4821');
    await fixture.whenStable();
    expect(dica.textContent).toContain('Não atende: Não contém seu nome nem seu e-mail');
    digitar('cad-senha', 'tijolo-azul-lua-4821');
    await fixture.whenStable();
    expect(dica.textContent).toContain('Senha boa nas regras abaixo.');
  });

  it('senha com menos de 10 caracteres e bloqueada no cliente (mesmo com 10+ bytes)', async () => {
    preencher('çãõéíóúâê'); // 9 caracteres, 18 bytes
    await enviar();
    ctrl.expectNone('/api/clinicas');
    expect(campo('cad-senha').getAttribute('aria-invalid')).toBe('true');
    const erroId = campo('cad-senha')
      .getAttribute('aria-describedby')!
      .split(' ')
      .find((id) => /erro/.test(id))!;
    expect(document.getElementById(erroId)?.textContent).toContain('pelo menos 10');
  });

  it('400 mostra mensagem generica sem despejar o array do servidor', async () => {
    preencher();
    await enviar();
    falhar('/api/clinicas', 400);
    await fixture.whenStable();
    expect(alerta()).toBe('Alguns campos estão inválidos. Revise e tente de novo.');
  });

  it('429 com Retry-After mostra os segundos', async () => {
    preencher();
    await enviar();
    falhar('/api/clinicas', 429, { 'Retry-After': '120' });
    await fixture.whenStable();
    expect(alerta()).toBe('Muitas tentativas. Tente de novo em 120 segundos.');
  });

  it('429 sem Retry-After mostra mensagem sem numero', async () => {
    preencher();
    await enviar();
    falhar('/api/clinicas', 429);
    await fixture.whenStable();
    expect(alerta()).toBe('Muitas tentativas. Aguarde um pouco e tente de novo.');
  });

  it('erro de rede mostra mensagem generica', async () => {
    preencher();
    await enviar();
    ctrl.expectOne('/api/clinicas').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(alerta()).toBe('Não foi possível concluir agora. Confira sua conexão e tente de novo.');
  });

  it('5xx mostra mensagem generica', async () => {
    preencher();
    await enviar();
    falhar('/api/clinicas', 503);
    await fixture.whenStable();
    expect(alerta()).toBe('Não foi possível concluir agora. Confira sua conexão e tente de novo.');
  });

  it('durante o envio o botao fica desabilitado com "Criando..." e nao envia duas vezes', async () => {
    preencher();
    await enviar();
    await enviar();
    expect(botao().disabled).toBeTrue();
    expect(botao().textContent?.trim()).toBe('Criando…');
    const c = ctrl.expectOne('/api/clinicas');
    c.flush({ statusCode: 500 }, { status: 500, statusText: 'Erro' });
    await fixture.whenStable();
    expect(botao().disabled).toBeFalse();
  });

  it('senha acima de 72 bytes (40 emojis) e bloqueada no cliente', async () => {
    preencher('🙂'.repeat(40));
    await enviar();
    ctrl.expectNone('/api/clinicas');
    const senha = campo('cad-senha');
    expect(senha.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(senha);
  });

  it('conta bytes, nao caracteres: 20 emojis (80 bytes, 40 unidades UTF-16) e bloqueada', async () => {
    preencher('🙂'.repeat(20));
    await enviar();
    ctrl.expectNone('/api/clinicas');
  });

  it('senha com 72 bytes passa no cliente', async () => {
    preencher('a'.repeat(72));
    await enviar();
    ctrl.expectOne('/api/clinicas');
  });

  it('formulario vazio foca o primeiro campo com erro', async () => {
    await enviar();
    ctrl.expectNone('/api/clinicas');
    expect(document.activeElement).toBe(campo('cad-clinica'));
  });

  it('autocomplete e tipos corretos; link para /login', () => {
    expect(campo('cad-clinica').autocomplete).toBe('organization');
    expect(campo('cad-nome').autocomplete).toBe('name');
    expect(campo('cad-email').autocomplete).toBe('email');
    expect(campo('cad-senha').autocomplete).toBe('new-password');
    expect(campo('cad-senha').type).toBe('password');
    expect(el().querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('abordagem tem os rotulos humanos e os valores do enum', () => {
    const opcoes = Array.from(campo('cad-abordagem').querySelectorAll('option'))
      .filter((o) => o.value)
      .map((o) => [o.value, o.textContent?.trim()]);
    expect(opcoes).toEqual([
      ['SISTEMICA', 'Sistêmica'],
      ['TCC', 'TCC'],
      ['PSICANALISE', 'Psicanálise'],
      ['ACT', 'ACT'],
      ['HUMANISTA', 'Humanista'],
      ['OUTRA', 'Outra'],
    ]);
  });

  it('cada campo tem label; erro tem aria-invalid e aria-describedby valido', async () => {
    const campos = el().querySelectorAll('input, select');
    expect(campos.length).toBe(5);
    campos.forEach((i) =>
      expect(el().querySelector(`label[for="${i.id}"]`))
        .withContext(i.id)
        .not.toBeNull(),
    );
    await enviar();
    campos.forEach((i) => {
      expect(i.getAttribute('aria-invalid')).withContext(i.id).toBe('true');
      const ids = i.getAttribute('aria-describedby')!.split(' ');
      ids.forEach((id) =>
        expect(document.getElementById(id)?.textContent?.trim())
          .withContext(`${i.id} -> ${id}`)
          .toBeTruthy(),
      );
    });
  });

  it('tem link "Como protegemos os dados" para /seguranca', () => {
    const a = (fixture.nativeElement as HTMLElement).querySelector('a[href="/seguranca"]');
    expect(a?.textContent?.trim()).toBe('Como protegemos os dados');
  });
});
