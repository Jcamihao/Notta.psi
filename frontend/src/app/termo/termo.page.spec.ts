import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { authInterceptor } from '../core/auth.interceptor';
import { Eu, SessaoStore } from '../core/sessao.store';
import { TermoPage } from './termo.page';
import { TermoPublico } from './termo.service';

const PSICOLOGO_LOGADO: Eu = {
  psicologoId: 'p1',
  nome: 'Ana Souza',
  email: 'ana@clinica.com',
  papel: 'PSICOLOGO',
  abordagemPadrao: 'TCC',
  clinica: { id: 'c1', nome: 'Clinica Horizonte' },
  senhaProvisoria: false,
};

const TOKEN = 'tok3n-publico-0123456789abcdefghijklmnopqrstu';
const BASE = `/api/publico/consentimento/${TOKEN}`;
const TERMO: TermoPublico = {
  clinica: 'Clínica Demo',
  psicologo: 'Dra. Ana',
  termo: { versao: 'v1-rascunho', texto: 'Linha 1\nLinha 2\n\n<b>não é html</b>' },
  expiraEm: '2026-11-10T10:00:00.000Z',
};
const GENERICA = 'Este link não está mais disponível. Peça um novo link ao seu psicólogo.';

describe('TermoPage', () => {
  let fixture: ComponentFixture<TermoPage>;
  let ctrl: HttpTestingController;
  let tituloAntes: string;

  beforeEach(() => {
    sessionStorage.clear();
    tituloAntes = document.title;
    TestBed.configureTestingModule({
      imports: [TermoPage],
      providers: [
        // O interceptor real: a rota publica nao pode levar Authorization nem deslogar.
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ token: TOKEN }) } },
        },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TermoPage);
  });
  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const botao = (texto: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === texto) ??
    null;
  const texto = (sel: string) => el().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const flush = async (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    await fixture.whenStable();
  };
  const abrir = async (corpo: object = TERMO, status = 200) => {
    await fixture.whenStable();
    await flush(ctrl.expectOne(BASE), corpo, status);
  };
  const clicar = async (rotulo: string) => {
    botao(rotulo)!.click();
    await fixture.whenStable();
  };

  it('mostra "Carregando" e depois clinica, psicologo, termo e os dois botoes', async () => {
    await fixture.whenStable();
    expect(texto('[role="status"]')).toBe('Carregando o termo…');
    await flush(ctrl.expectOne(BASE), TERMO);
    expect(texto('h1')).toBe('Termo de consentimento');
    expect(texto('[data-teste="clinica"]')).toBe('Clínica Demo');
    expect(texto('[data-teste="psicologo"]')).toBe('Dra. Ana');
    expect(botao('Li e aceito')).not.toBeNull();
    expect(botao('Não aceito')).not.toBeNull();
    expect(texto('.termo-privacidade')).toBe('Esta página não mostra seus dados pessoais.');
  });

  it('texto do termo: quebras de linha preservadas e SEM innerHTML (tags viram texto)', async () => {
    await abrir();
    const bloco = el().querySelector<HTMLElement>('[data-teste="texto"]')!;
    expect(bloco.textContent).toBe(TERMO.termo.texto);
    expect(getComputedStyle(bloco).whiteSpace).toBe('pre-line');
    expect(bloco.querySelector('b')).toBeNull();
  });

  it('pagina sem dado do paciente e sem sessao: GET sem Authorization nem CSRF', async () => {
    TestBed.inject(SessaoStore).entrar(PSICOLOGO_LOGADO);
    await fixture.whenStable();
    const r = ctrl.expectOne(BASE);
    expect(r.request.method).toBe('GET');
    expect(r.request.headers.has('Authorization')).toBeFalse();
    expect(r.request.headers.has('X-CSRF-Token')).toBeFalse();
    await flush(r, TERMO);
  });

  describe('cabecalho', () => {
    it('noindex, sem referrer e titulo neutro; some ao sair', async () => {
      await abrir();
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
        'noindex',
      );
      expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe(
        'no-referrer',
      );
      expect(document.title).toBe('Termo de consentimento');
      fixture.destroy();
      expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
      expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
      expect(document.title).toBe(tituloAntes);
    });
  });

  describe('aceitar', () => {
    it('"Li e aceito": POST {aceito:true} sem Authorization, mostra o agradecimento e foca o titulo', async () => {
      await abrir();
      TestBed.inject(SessaoStore).entrar(PSICOLOGO_LOGADO);
      await clicar('Li e aceito');
      const r = ctrl.expectOne(`${BASE}/aceitar`);
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toEqual({ aceito: true });
      expect(r.request.headers.has('Authorization')).toBeFalse();
      expect(botao('Enviando…')!.disabled).toBeTrue();
      await flush(r, { ok: true });
      expect(texto('[data-teste="resultado-aceito"]')).toContain('Termo aceito');
      expect(texto('[data-teste="resultado-aceito"]')).toContain(
        'Você já pode fechar esta página.',
      );
      expect(el().querySelector('[data-teste="resultado-aceito"]')!.getAttribute('role')).toBe(
        'status',
      );
      expect(botao('Li e aceito')).toBeNull();
      expect(document.activeElement).toBe(el().querySelector('#termo-foco'));
    });

    it('sem duplo envio', async () => {
      await abrir();
      await clicar('Li e aceito');
      botao('Enviando…')!.click();
      await fixture.whenStable();
      await flush(ctrl.expectOne(`${BASE}/aceitar`), { ok: true });
    });

    it('404 ao aceitar (link usado em outra aba): tela generica', async () => {
      await abrir();
      await clicar('Li e aceito');
      await flush(ctrl.expectOne(`${BASE}/aceitar`), { message: 'Link invalido ou expirado' }, 404);
      expect(texto('[data-teste="resultado-invalido"]')).toContain(GENERICA);
    });

    it('429 e rede ao aceitar: mensagem amigavel, botoes liberados para tentar de novo', async () => {
      await abrir();
      await clicar('Li e aceito');
      await flush(ctrl.expectOne(`${BASE}/aceitar`), {}, 429);
      expect(texto('[data-teste="erro"]')).toContain('Muitas tentativas');
      expect(botao('Li e aceito')!.disabled).toBeFalse();
      await clicar('Li e aceito');
      ctrl.expectOne(`${BASE}/aceitar`).error(new ProgressEvent('error'));
      await fixture.whenStable();
      expect(texto('[data-teste="erro"]')).toContain('Confira sua conexão');
      expect(texto('[data-teste="erro"]')).not.toMatch(/HTTP|\b5\d\d\b|Unknown/);
      await clicar('Li e aceito');
      await flush(ctrl.expectOne(`${BASE}/aceitar`), { ok: true });
      expect(el().querySelector('[data-teste="resultado-aceito"]')).not.toBeNull();
    });
  });

  describe('recusar com confirmacao', () => {
    beforeEach(() => abrir());

    it('"Não aceito" NAO envia: abre a confirmacao e foca "Voltar"', async () => {
      await clicar('Não aceito');
      ctrl.expectNone(`${BASE}/recusar`);
      const c = el().querySelector('[data-teste="confirmacao"]')!;
      expect(c.textContent).toContain('Você não aceita este termo?');
      expect(c.getAttribute('aria-labelledby')).toBe('termo-confirma-titulo');
      expect(document.activeElement).toBe(botao('Voltar'));
      expect(botao('Li e aceito')).toBeNull();
    });

    it('Voltar fecha sem enviar e devolve o foco', async () => {
      await clicar('Não aceito');
      await clicar('Voltar');
      ctrl.expectNone(`${BASE}/recusar`);
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(document.activeElement).toBe(botao('Não aceito'));
    });

    it('Escape fecha a confirmacao sem enviar', async () => {
      await clicar('Não aceito');
      el()
        .querySelector('[data-teste="confirmacao"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      ctrl.expectNone(`${BASE}/recusar`);
    });

    it('"Sim, não aceito": POST /recusar, tela "psicologo sera avisado"', async () => {
      await clicar('Não aceito');
      await clicar('Sim, não aceito');
      const r = ctrl.expectOne(`${BASE}/recusar`);
      expect(r.request.method).toBe('POST');
      expect(r.request.headers.has('Authorization')).toBeFalse();
      await flush(r, { ok: true });
      const t = texto('[data-teste="resultado-recusado"]')!;
      expect(t).toContain('O seu psicólogo será avisado');
      expect(t).toContain('Você já pode fechar esta página.');
      expect(el().querySelector('[data-teste="resultado-aceito"]')).toBeNull();
    });

    it('erro ao recusar: mensagem e a confirmacao continua aberta', async () => {
      await clicar('Não aceito');
      await clicar('Sim, não aceito');
      await flush(ctrl.expectOne(`${BASE}/recusar`), {}, 503);
      expect(texto('[data-teste="erro"]')).toContain('Confira sua conexão');
      expect(el().querySelector('[data-teste="confirmacao"]')).not.toBeNull();
    });
  });

  describe('link que nao serve e falhas ao abrir', () => {
    it('404 vira a tela generica, sem tecnico e sem botoes de aceite', async () => {
      await abrir({ message: 'Link invalido ou expirado', statusCode: 404 }, 404);
      expect(texto('[data-teste="resultado-invalido"]')).toContain(GENERICA);
      expect(el().textContent).not.toMatch(/404|expirad[oa]\b.*motivo|Not Found/);
      expect(botao('Li e aceito')).toBeNull();
      expect(document.activeElement).toBe(el().querySelector('#termo-foco'));
    });

    it('404 sempre com o MESMO texto, qualquer corpo (sem distinguir o motivo)', async () => {
      await abrir({ message: 'qualquer outra coisa' }, 404);
      const a = el().querySelector('[data-teste="resultado-invalido"]')!.textContent;
      fixture.destroy();
      fixture = TestBed.createComponent(TermoPage);
      await abrir({ message: 'Link expirado' }, 404);
      expect(el().querySelector('[data-teste="resultado-invalido"]')!.textContent).toBe(a);
    });

    it('401 NAO desloga nem redireciona (nem aparece erro tecnico)', async () => {
      TestBed.inject(SessaoStore).entrar(PSICOLOGO_LOGADO);
      await abrir({}, 401);
      expect(TestBed.inject(SessaoStore).autenticado()).toBeTrue();
      expect(el().textContent).not.toMatch(/401|Unauthorized/);
    });

    it('429 ao abrir: mensagem amigavel e "Tentar de novo" refaz o GET', async () => {
      await abrir({}, 429);
      expect(texto('[data-teste="falha"]')).toContain('Muitas tentativas');
      await clicar('Tentar de novo');
      await flush(ctrl.expectOne(BASE), TERMO);
      expect(botao('Li e aceito')).not.toBeNull();
    });

    it('erro de rede ao abrir: mensagem amigavel e "Tentar de novo"', async () => {
      await fixture.whenStable();
      ctrl.expectOne(BASE).error(new ProgressEvent('error'));
      await fixture.whenStable();
      expect(texto('[data-teste="falha"]')).toContain('Confira sua conexão');
      expect(el().textContent).not.toMatch(/HTTP|Unknown|0 /);
      await clicar('Tentar de novo');
      await flush(ctrl.expectOne(BASE), TERMO);
      expect(botao('Li e aceito')).not.toBeNull();
    });
  });

  describe('privacidade do token', () => {
    it('nao vai para console, storage nem history.state em nenhum fluxo', async () => {
      const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        spyOn(console, m),
      );
      localStorage.clear();
      await abrir();
      await clicar('Li e aceito');
      await flush(ctrl.expectOne(`${BASE}/aceitar`), { ok: true });
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      expect(JSON.stringify(history.state)).not.toContain(TOKEN);
      expect(el().textContent).not.toContain(TOKEN);
      for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
    });
  });
});
