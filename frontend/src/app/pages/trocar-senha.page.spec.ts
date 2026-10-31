import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SessaoStore } from '../core/sessao.store';
import { Eu } from '../core/usuario.store';
import { TrocarSenhaPage } from './trocar-senha.page';

const EU: Eu = {
  psicologoId: 'p2',
  nome: 'Bruno Lima',
  email: 'bruno@clinica.com',
  papel: 'PSICOLOGO',
  abordagemPadrao: 'TCC',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
  senhaProvisoria: false,
};

describe('TrocarSenhaPage', () => {
  let fixture: ComponentFixture<TrocarSenhaPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  const montar = async (senhaProvisoria = false) => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      imports: [TrocarSenhaPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    TestBed.inject(SessaoStore).entrar('tok');
    fixture = TestBed.createComponent(TrocarSenhaPage);
    await fixture.whenStable();
    ctrl.expectOne('/api/eu').flush({ ...EU, senhaProvisoria });
    await fixture.whenStable();
  };

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const campo = (id: string) => el().querySelector(`#${id}`) as HTMLInputElement;
  const digitar = (id: string, valor: string, sair = true) => {
    const i = campo(id);
    i.value = valor;
    i.dispatchEvent(new Event('input'));
    if (sair) i.dispatchEvent(new Event('blur'));
  };
  const preencher = (atual = 'provisoria-1', nova = 'so-minha-senha', confirmar = nova) => {
    digitar('ts-senhaAtual', atual);
    digitar('ts-novaSenha', nova);
    digitar('ts-confirmar', confirmar, false);
  };
  const enviar = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const post = () =>
    ctrl.expectOne((r) => r.method === 'POST' && r.url === '/api/auth/trocar-senha');
  const semPost = () =>
    ctrl.expectNone((r) => r.method === 'POST' && r.url === '/api/auth/trocar-senha');
  const falhar = async (status: number, headers: Record<string, string> = {}, message = 'x') => {
    post().flush({ statusCode: status, message }, { status, statusText: 'Erro', headers });
    await fixture.whenStable();
  };
  const alerta = () => el().querySelector('[data-teste="erro-geral"]')?.textContent?.trim() ?? '';
  const erroDo = (id: string) => {
    const ids = campo(id).getAttribute('aria-describedby') ?? '';
    const erroId = ids.split(' ').find((x) => /erro/.test(x));
    return erroId ? (document.getElementById(erroId)?.textContent?.trim() ?? '') : '';
  };
  const camposVazios = () =>
    ['ts-senhaAtual', 'ts-novaSenha', 'ts-confirmar'].every((id) => campo(id).value === '');

  describe('modo voluntario', () => {
    beforeEach(() => montar(false));

    it('titulo Trocar senha, sem o aviso de senha provisoria', () => {
      expect(el().querySelector('h1')?.textContent?.trim()).toBe('Trocar senha');
      expect(el().textContent).not.toContain('Defina uma senha só sua para continuar');
    });

    it('autocomplete certo nos tres campos, com rotulos', () => {
      expect(campo('ts-senhaAtual').getAttribute('autocomplete')).toBe('current-password');
      expect(campo('ts-novaSenha').getAttribute('autocomplete')).toBe('new-password');
      expect(campo('ts-confirmar').getAttribute('autocomplete')).toBe('new-password');
      for (const id of ['ts-senhaAtual', 'ts-novaSenha', 'ts-confirmar']) {
        expect(campo(id).type).toBe('password');
        expect(el().querySelector(`label[for="${id}"]`)).not.toBeNull();
      }
    });

    it('200 envia o corpo do contrato, troca o token, recarrega o /eu e vai para /', async () => {
      preencher();
      await enviar();
      const r = post();
      expect(r.request.body).toEqual({ senhaAtual: 'provisoria-1', novaSenha: 'so-minha-senha' });
      r.flush({ token: 'tok-novo' });
      await fixture.whenStable();
      expect(TestBed.inject(SessaoStore).token()).toBe('tok-novo');
      ctrl.expectOne('/api/eu').flush(EU);
      expect(navegar).toHaveBeenCalledWith('/', { state: { senhaTrocada: true } });
      expect(camposVazios()).toBeTrue();
    });

    it('422 marca o campo senha atual, foca nele e limpa os tres campos', async () => {
      preencher();
      await enviar();
      await falhar(422, {}, 'Senha atual incorreta');
      const atual = campo('ts-senhaAtual');
      expect(atual.getAttribute('aria-invalid')).toBe('true');
      expect(erroDo('ts-senhaAtual')).toContain('Senha atual incorreta');
      expect(document.activeElement).toBe(atual);
      expect(camposVazios()).toBeTrue();
      expect(alerta()).toBe('');
      expect(campo('ts-confirmar').getAttribute('aria-invalid')).toBeNull();
      expect(TestBed.inject(SessaoStore).token()).toBe('tok');
      expect(navegar).not.toHaveBeenCalled();
    });

    it('400 mostra mensagem generica e limpa os campos', async () => {
      preencher();
      await enviar();
      await falhar(400);
      expect(alerta()).toBe('Alguns campos estão inválidos. Revise e tente de novo.');
      expect(camposVazios()).toBeTrue();
    });

    it('429 com Retry-After mostra os segundos', async () => {
      preencher();
      await enviar();
      await falhar(429, { 'Retry-After': '30' });
      expect(alerta()).toBe('Muitas tentativas. Tente de novo em 30 segundos.');
      expect(camposVazios()).toBeTrue();
    });

    it('429 sem Retry-After mostra mensagem sem numero', async () => {
      preencher();
      await enviar();
      await falhar(429);
      expect(alerta()).toBe('Muitas tentativas. Aguarde um pouco e tente de novo.');
    });

    it('erro de rede mostra mensagem generica', async () => {
      preencher();
      await enviar();
      post().error(new ProgressEvent('error'));
      await fixture.whenStable();
      expect(alerta()).toContain('Não foi possível concluir agora.');
      expect(camposVazios()).toBeTrue();
    });

    it('confirmacao diferente bloqueia no cliente', async () => {
      preencher('provisoria-1', 'so-minha-senha', 'outra-senha-x');
      await enviar();
      semPost();
      expect(erroDo('ts-confirmar')).toContain('não conferem');
      expect(document.activeElement).toBe(campo('ts-confirmar'));
    });

    it('confirmacao volta a valer quando a nova senha muda depois', async () => {
      preencher('provisoria-1', 'so-minha-senha', 'so-minha-senhaX');
      digitar('ts-novaSenha', 'so-minha-senhaX');
      await enviar();
      post().flush({ token: 'tok-novo' });
      await fixture.whenStable();
      ctrl.expectOne('/api/eu').flush(EU);
    });

    it('nova senha igual a atual bloqueia no cliente', async () => {
      preencher('mesma-senha-1', 'mesma-senha-1');
      await enviar();
      semPost();
      expect(erroDo('ts-novaSenha')).toContain('diferente da atual');
    });

    it('nova igual a atual tambem bloqueia quando a atual muda depois', async () => {
      preencher('provisoria-1', 'mesma-senha-1');
      digitar('ts-senhaAtual', 'mesma-senha-1');
      await enviar();
      semPost();
      expect(erroDo('ts-novaSenha')).toContain('diferente da atual');
    });

    it('nova senha com mais de 72 bytes bloqueia (conta bytes, nao caracteres)', async () => {
      const longa = 'ç'.repeat(37); // 37 caracteres, 74 bytes
      preencher('provisoria-1', longa);
      await enviar();
      semPost();
      expect(erroDo('ts-novaSenha')).toContain('72 bytes');
    });

    it('nova senha curta e campos vazios bloqueiam e focam o primeiro erro', async () => {
      await enviar();
      semPost();
      expect(document.activeElement).toBe(campo('ts-senhaAtual'));
      preencher('provisoria-1', 'curta');
      await enviar();
      semPost();
      expect(erroDo('ts-novaSenha')).toContain('pelo menos 8');
    });

    it('sem duplo envio', async () => {
      preencher();
      await enviar();
      await enviar();
      const r = post();
      const botao = el().querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(botao.disabled).toBeTrue();
      r.flush({ token: 'tok-novo' });
      await fixture.whenStable();
      ctrl.expectOne('/api/eu').flush(EU);
    });
  });

  describe('modo obrigatorio (senha provisoria)', () => {
    beforeEach(() => montar(true));

    it('mostra o aviso para definir uma senha so sua', () => {
      expect(el().textContent).toContain('Defina uma senha só sua para continuar');
      expect(el().querySelector('h1')?.textContent?.trim()).not.toBe('Trocar senha');
    });

    it('200 tambem troca o token e vai para /', async () => {
      preencher();
      await enviar();
      post().flush({ token: 'tok-novo' });
      await fixture.whenStable();
      ctrl.expectOne('/api/eu').flush(EU);
      expect(TestBed.inject(SessaoStore).token()).toBe('tok-novo');
      expect(navegar).toHaveBeenCalledWith('/', { state: { senhaTrocada: true } });
    });
  });
});
