import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConvitesConsentimentoComponent } from './convites-consentimento.component';
import { Convite } from './convite-consentimento.service';

const ID = '11111111-1111-4111-8111-111111111111';
const URL = `/api/pacientes/${ID}/convites-consentimento`;
const TOKEN = 'tok3n-secreto-do-link-unico-0123456789abcdefghij';
const LINK = `http://localhost:4200/termo/${TOKEN}`;
const T1 = '2026-11-01T14:00:00.000Z';
const T2 = '2026-11-08T14:00:00.000Z';

const convite = (id: string, estado: Convite['estado'], extra: Partial<Convite> = {}): Convite => ({
  id,
  estado,
  expirado: false,
  criadoEm: T1,
  expiraEm: T2,
  usadoEm: estado === 'PENDENTE' ? null : T1,
  termoVersao: 'v1-rascunho',
  ...extra,
});
const PENDENTE = convite('c-pend', 'PENDENTE');

describe('ConvitesConsentimentoComponent', () => {
  let fixture: ComponentFixture<ConvitesConsentimentoComponent>;
  let ctrl: HttpTestingController;
  let visivel: jasmine.Spy;
  let aceitos: number;

  beforeEach(async () => {
    jasmine.clock().install();
    visivel = spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');
    TestBed.configureTestingModule({
      imports: [ConvitesConsentimentoComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConvitesConsentimentoComponent);
    fixture.componentRef.setInput('pacienteId', ID);
    fixture.componentRef.setInput('podeEnviar', true);
    aceitos = 0;
    fixture.componentInstance.aceito.subscribe(() => aceitos++);
    await fixture.whenStable();
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    ctrl.verify();
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
  const carregar = async (lista: Convite[]) => {
    const r = ctrl.expectOne(URL);
    expect(r.request.method).toBe('GET');
    await flush(r, lista);
  };
  const clicar = async (rotulo: string) => {
    botao(rotulo)!.click();
    await fixture.whenStable();
  };
  const gerarLink = async (lista: Convite[] = [PENDENTE]) => {
    await carregar([]);
    await clicar('Enviar termo ao paciente');
    await flush(ctrl.expectOne(URL), { id: 'c-pend', link: LINK, expiraEm: T2 }, 201);
    await carregar(lista);
  };

  describe('lista de convites', () => {
    it('mostra o estado em pill de TEXTO e deriva "Expirado" de expirado', async () => {
      await carregar([
        convite('a', 'PENDENTE'),
        convite('b', 'PENDENTE', { expirado: true }),
        convite('c', 'ACEITO'),
        convite('d', 'RECUSADO'),
        convite('e', 'CANCELADO'),
      ]);
      const pills = Array.from(el().querySelectorAll('[data-teste="convite"] app-pill')).map((p) =>
        p.textContent?.trim(),
      );
      expect(pills).toEqual(['Pendente', 'Expirado', 'Aceito', 'Recusado', 'Cancelado']);
    });

    it('mostra datas (envio, validade e resposta)', async () => {
      await carregar([convite('a', 'PENDENTE'), convite('c', 'ACEITO')]);
      const itens = el().querySelectorAll('[data-teste="convite"]');
      expect(itens[0].textContent).toMatch(/Enviado em \d{2}\/\d{2}\/\d{4}/);
      expect(itens[0].textContent).toContain('vale até');
      expect(itens[1].textContent).toContain('aceito em');
    });

    it('"Cancelar" so nos pendentes ainda validos', async () => {
      await carregar([
        convite('a', 'PENDENTE'),
        convite('b', 'PENDENTE', { expirado: true }),
        convite('c', 'ACEITO'),
      ]);
      const botoes = Array.from(el().querySelectorAll('button')).filter(
        (b) => b.textContent?.trim() === 'Cancelar',
      );
      expect(botoes.length).toBe(1);
      expect(botoes[0].id).toBe('conv-cancelar-a');
    });

    it('lista vazia: sem <ul>', async () => {
      await carregar([]);
      expect(el().querySelector('ul')).toBeNull();
    });

    it('erro ao carregar: "Tentar de novo" refaz o GET', async () => {
      await flush(ctrl.expectOne(URL), {}, 503);
      expect(texto('[data-teste="convite-erro-lista"]')).toContain(
        'Não foi possível carregar os convites.',
      );
      await clicar('Tentar de novo');
      await carregar([PENDENTE]);
      expect(el().querySelector('[data-teste="convite-erro-lista"]')).toBeNull();
      expect(el().querySelectorAll('[data-teste="convite"]').length).toBe(1);
    });
  });

  describe('enviar termo', () => {
    it('botao so quando podeEnviar (NENHUM ou REVOGADO)', async () => {
      await carregar([]);
      expect(botao('Enviar termo ao paciente')).not.toBeNull();
      fixture.componentRef.setInput('podeEnviar', false);
      await fixture.whenStable();
      expect(botao('Enviar termo ao paciente')).toBeNull();
    });

    it('cria o convite, mostra o link UMA vez em campo somente leitura, com validade e aviso', async () => {
      await carregar([]);
      await clicar('Enviar termo ao paciente');
      const r = ctrl.expectOne(URL);
      expect(r.request.method).toBe('POST');
      expect(botao('Gerando o link…')!.disabled).toBeTrue();
      await flush(r, { id: 'c-pend', link: LINK, expiraEm: T2 }, 201);
      const campo = el().querySelector<HTMLInputElement>('#conv-link')!;
      expect(campo.value).toBe(LINK);
      expect(campo.readOnly).toBeTrue();
      expect(campo.getAttribute('aria-label')).toBe('Link do termo para o paciente');
      const bloco = texto('[data-teste="link-bloco"]')!;
      expect(bloco).toContain('vale por 7 dias');
      expect(bloco).toContain('envie por WhatsApp ou e-mail');
      expect(bloco).toContain('Este link só aparece agora. Se perder, gere outro.');
      expect(document.activeElement).toBe(el().querySelector('#conv-link-bloco'));
      // depois recarrega a lista (sem token)
      await carregar([PENDENTE]);
      expect(texto('[data-teste="convite"]')).toContain('Pendente');
      expect(el().textContent).toContain('Gerar outro link cancela o anterior.');
    });

    it('sem duplo envio enquanto cria', async () => {
      await carregar([]);
      await clicar('Enviar termo ao paciente');
      botao('Gerando o link…')!.click();
      await fixture.whenStable();
      await flush(ctrl.expectOne(URL), { id: 'x', link: LINK, expiraEm: T2 }, 201);
      await carregar([PENDENTE]);
    });

    it('409 (ja concedido): avisa e pede ao cartao para recarregar o estado', async () => {
      await carregar([]);
      await clicar('Enviar termo ao paciente');
      await flush(ctrl.expectOne(URL), { message: 'Consentimento ja concedido' }, 409);
      expect(texto('[data-teste="convite-erro"]')).toContain('já foi concedido');
      expect(aceitos).toBe(1);
      expect(el().querySelector('#conv-link')).toBeNull();
    });

    it('404, 429 e rede: mensagem e botao liberado, sem link', async () => {
      await carregar([]);
      await clicar('Enviar termo ao paciente');
      await flush(ctrl.expectOne(URL), {}, 404);
      expect(texto('[data-teste="convite-erro"]')).toBe('Paciente não encontrado.');
      await clicar('Enviar termo ao paciente');
      await flush(ctrl.expectOne(URL), {}, 429);
      expect(texto('[data-teste="convite-erro"]')).toContain('Muitas tentativas');
      await clicar('Enviar termo ao paciente');
      ctrl.expectOne(URL).error(new ProgressEvent('error'));
      await fixture.whenStable();
      expect(texto('[data-teste="convite-erro"]')).toContain('Confira sua conexão');
      expect(botao('Enviar termo ao paciente')!.disabled).toBeFalse();
      expect(el().querySelector('#conv-link')).toBeNull();
    });

    it('gerar outro troca o link mostrado (o anterior some)', async () => {
      await gerarLink();
      await clicar('Enviar termo ao paciente');
      await flush(ctrl.expectOne(URL), { id: 'c-2', link: `${LINK}-2`, expiraEm: T2 }, 201);
      await carregar([PENDENTE]);
      expect(el().querySelector<HTMLInputElement>('#conv-link')!.value).toBe(`${LINK}-2`);
    });
  });

  describe('copiar link', () => {
    it('copia e avisa "Link copiado" na regiao aria-live, sem pop-up', async () => {
      await gerarLink();
      const escrever = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      await clicar('Copiar link');
      await fixture.whenStable();
      expect(escrever).toHaveBeenCalledOnceWith(LINK);
      expect(texto('.aviso-regiao[aria-live="polite"] [data-teste="convite-aviso"]')).toBe(
        'Link copiado',
      );
    });

    it('area de transferencia bloqueada: seleciona o link e orienta Ctrl+C', async () => {
      await gerarLink();
      spyOn(navigator.clipboard, 'writeText').and.rejectWith(
        new DOMException('no', 'NotAllowedError'),
      );
      await clicar('Copiar link');
      await fixture.whenStable();
      expect(texto('[data-teste="convite-erro"]')).toContain('Ctrl+C');
      expect(el().querySelector('[data-teste="convite-aviso"]')).toBeNull();
      const campo = el().querySelector<HTMLInputElement>('#conv-link')!;
      expect(campo.selectionStart).toBe(0);
      expect(campo.selectionEnd).toBe(LINK.length);
    });
  });

  describe('o link so existe em memoria do componente', () => {
    it('nunca vai para storage, history.state nem console', async () => {
      const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        spyOn(console, m),
      );
      localStorage.clear();
      sessionStorage.clear();
      await gerarLink();
      await clicar('Copiar link');
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      expect(JSON.stringify(history.state)).not.toContain(TOKEN);
      expect(location.href).not.toContain(TOKEN);
      for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
    });

    it('a lista nunca mostra o token', async () => {
      await gerarLink();
      expect(texto('.convites-lista')).not.toContain(TOKEN);
    });

    it('limpo ao sair: some do componente e do DOM', async () => {
      await gerarLink();
      expect(fixture.componentInstance.criado()).not.toBeNull();
      fixture.destroy();
      expect(fixture.componentInstance.criado()).toBeNull();
      expect(document.body.textContent).not.toContain(TOKEN);
    });

    it('consentimento concedido (podeEnviar falso): o link some', async () => {
      await gerarLink();
      fixture.componentRef.setInput('podeEnviar', false);
      await fixture.whenStable();
      expect(el().querySelector('#conv-link')).toBeNull();
      expect(fixture.componentInstance.criado()).toBeNull();
    });
  });

  describe('cancelar com confirmacao inline', () => {
    beforeEach(() => carregar([PENDENTE]));

    it('clicar em Cancelar NAO envia: abre a confirmacao e foca "Manter convite"', async () => {
      await clicar('Cancelar');
      ctrl.expectNone(`${URL}/c-pend/cancelar`);
      const c = el().querySelector('[data-teste="convite-confirmacao"]')!;
      expect(c.textContent).toContain('Cancelar este convite?');
      expect(c.getAttribute('aria-labelledby')).toBe('conv-confirma-titulo');
      expect(document.activeElement).toBe(botao('Manter convite'));
    });

    it('Manter fecha sem enviar e devolve o foco ao Cancelar', async () => {
      await clicar('Cancelar');
      await clicar('Manter convite');
      ctrl.expectNone(`${URL}/c-pend/cancelar`);
      expect(el().querySelector('[data-teste="convite-confirmacao"]')).toBeNull();
      expect(document.activeElement).toBe(el().querySelector('#conv-cancelar-c-pend'));
    });

    it('Escape fecha a confirmacao sem enviar', async () => {
      await clicar('Cancelar');
      el()
        .querySelector('[data-teste="convite-confirmacao"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      expect(el().querySelector('[data-teste="convite-confirmacao"]')).toBeNull();
      ctrl.expectNone(`${URL}/c-pend/cancelar`);
    });

    it('Cancelar convite: POST, recarrega a lista e avisa', async () => {
      await clicar('Cancelar');
      await clicar('Cancelar convite');
      const r = ctrl.expectOne(`${URL}/c-pend/cancelar`);
      expect(r.request.method).toBe('POST');
      expect(botao('Cancelando…')!.disabled).toBeTrue();
      await flush(r, { id: 'c-pend', estado: 'CANCELADO' });
      expect(el().querySelector('[data-teste="convite-confirmacao"]')).toBeNull();
      expect(texto('[data-teste="convite-aviso"]')).toBe(
        'Convite cancelado. O link deixou de funcionar.',
      );
      await carregar([convite('c-pend', 'CANCELADO')]);
      expect(texto('[data-teste="convite"] app-pill')).toBe('Cancelado');
      expect(el().querySelector('#conv-cancelar-c-pend')).toBeNull();
    });

    it('409: avisa que nao estava pendente e mostra o estado real', async () => {
      await clicar('Cancelar');
      await clicar('Cancelar convite');
      await flush(ctrl.expectOne(`${URL}/c-pend/cancelar`), {}, 409);
      expect(texto('[data-teste="convite-erro"]')).toContain('já não estava pendente');
      await carregar([convite('c-pend', 'ACEITO')]);
      expect(texto('[data-teste="convite"] app-pill')).toBe('Aceito');
    });

    it('cancelar o convite do link mostrado faz o link sumir', async () => {
      await clicar('Enviar termo ao paciente');
      await flush(ctrl.expectOne(URL), { id: 'c-pend', link: LINK, expiraEm: T2 }, 201);
      await carregar([PENDENTE]);
      expect(el().querySelector('#conv-link')).not.toBeNull();
      await clicar('Cancelar');
      await clicar('Cancelar convite');
      await flush(ctrl.expectOne(`${URL}/c-pend/cancelar`), { id: 'c-pend', estado: 'CANCELADO' });
      expect(el().querySelector('#conv-link')).toBeNull();
      await carregar([convite('c-pend', 'CANCELADO')]);
    });
  });

  describe('consulta periodica enquanto ha convite pendente', () => {
    it('a cada 15 s, so apos a anterior voltar', async () => {
      await carregar([PENDENTE]);
      jasmine.clock().tick(14999);
      ctrl.expectNone(URL);
      jasmine.clock().tick(1);
      const r = ctrl.expectOne(URL);
      // enquanto a consulta esta em voo, o tempo passa e nao sai outra
      jasmine.clock().tick(60000);
      ctrl.expectNone(URL);
      await flush(r, [PENDENTE]);
      jasmine.clock().tick(15000);
      await flush(ctrl.expectOne(URL), [PENDENTE]);
    });

    it('sem convite pendente (so respondidos/expirados) nao consulta', async () => {
      await carregar([convite('a', 'ACEITO'), convite('b', 'PENDENTE', { expirado: true })]);
      jasmine.clock().tick(120000);
      ctrl.expectNone(URL);
    });

    it('pendente que expira na consulta para de consultar', async () => {
      await carregar([PENDENTE]);
      jasmine.clock().tick(15000);
      await flush(ctrl.expectOne(URL), [convite('c-pend', 'PENDENTE', { expirado: true })]);
      expect(texto('[data-teste="convite"] app-pill')).toBe('Expirado');
      jasmine.clock().tick(120000);
      ctrl.expectNone(URL);
    });

    it('aba escondida: nao consulta; ao voltar, consulta na hora e retoma o ritmo', async () => {
      await carregar([PENDENTE]);
      visivel.and.returnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      jasmine.clock().tick(120000);
      ctrl.expectNone(URL);
      visivel.and.returnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await flush(ctrl.expectOne(URL), [PENDENTE]);
      jasmine.clock().tick(15000);
      await flush(ctrl.expectOne(URL), [PENDENTE]);
    });

    it('voltar para a aba com consulta ja em voo: so 1 chamada, e refaz ao voltar', async () => {
      await carregar([PENDENTE]);
      jasmine.clock().tick(15000);
      const r1 = ctrl.expectOne(URL);
      document.dispatchEvent(new Event('visibilitychange'));
      ctrl.expectNone(URL);
      await flush(r1, [PENDENTE]);
      await flush(ctrl.expectOne(URL), [PENDENTE]);
    });

    it('para ao sair da tela', async () => {
      await carregar([PENDENTE]);
      fixture.destroy();
      jasmine.clock().tick(120000);
      ctrl.expectNone(URL);
      document.dispatchEvent(new Event('visibilitychange'));
      ctrl.expectNone(URL);
    });

    it('apos 5 falhas seguidas de rede para de insistir', async () => {
      await carregar([PENDENTE]);
      for (let i = 0; i < 5; i++) {
        jasmine.clock().tick(15000);
        await flush(ctrl.expectOne(URL), {}, 503);
      }
      jasmine.clock().tick(120000);
      ctrl.expectNone(URL);
      // a lista antiga continua na tela, sem alarme
      expect(el().querySelectorAll('[data-teste="convite"]').length).toBe(1);
      expect(el().querySelector('[data-teste="convite-erro-lista"]')).toBeNull();
    });

    it('paciente aceitou: avisa, pede ao cartao o estado novo e o link some', async () => {
      await gerarLink();
      jasmine.clock().tick(15000);
      await flush(ctrl.expectOne(URL), [convite('c-pend', 'ACEITO')]);
      expect(aceitos).toBe(1);
      expect(texto('[data-teste="convite-aviso"]')).toBe('O paciente aceitou o termo.');
      expect(texto('[data-teste="convite"] app-pill')).toBe('Aceito');
      expect(el().querySelector('#conv-link')).toBeNull();
      jasmine.clock().tick(120000);
      ctrl.expectNone(URL);
    });

    it('paciente recusou: avisa, nao muda o consentimento', async () => {
      await carregar([PENDENTE]);
      jasmine.clock().tick(15000);
      await flush(ctrl.expectOne(URL), [convite('c-pend', 'RECUSADO')]);
      expect(aceitos).toBe(0);
      expect(texto('[data-teste="convite-aviso"]')).toBe('O paciente não aceitou o termo.');
      expect(texto('[data-teste="convite"] app-pill')).toBe('Recusado');
    });
  });
});
