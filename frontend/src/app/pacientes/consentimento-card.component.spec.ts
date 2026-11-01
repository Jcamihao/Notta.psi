import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConsentimentoCardComponent } from './consentimento-card.component';
import { Consentimento } from './consentimento.service';

const ID = '11111111-1111-4111-8111-111111111111';
const URL = `/api/pacientes/${ID}/consentimento`;
const T1 = '2026-11-01T14:00:00.000Z';
const T2 = '2026-11-02T15:30:00.000Z';
const T3 = '2026-11-03T16:45:00.000Z';

const NENHUM: Consentimento = { estado: 'NENHUM', desde: null, historico: [] };
const CONCEDIDO: Consentimento = {
  estado: 'CONCEDIDO',
  desde: T1,
  historico: [{ seq: 1, evento: 'CONCEDIDO', termoVersao: 'provisorio-1', em: T1 }],
};
const REVOGADO: Consentimento = {
  estado: 'REVOGADO',
  desde: T2,
  historico: [
    { seq: 1, evento: 'CONCEDIDO', termoVersao: 'provisorio-1', em: T1 },
    { seq: 2, evento: 'REVOGADO', termoVersao: 'provisorio-1', em: T2 },
  ],
};
const TRES: Consentimento = {
  estado: 'CONCEDIDO',
  desde: T3,
  historico: [
    ...REVOGADO.historico,
    { seq: 3, evento: 'CONCEDIDO', termoVersao: 'provisorio-1', em: T3 },
  ],
};

describe('ConsentimentoCardComponent', () => {
  let fixture: ComponentFixture<ConsentimentoCardComponent>;
  let ctrl: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ConsentimentoCardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConsentimentoCardComponent);
    fixture.componentRef.setInput('pacienteId', ID);
    await fixture.whenStable();
  });
  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const botoes = () => Array.from(el().querySelectorAll('button'));
  const botao = (texto: string) => botoes().find((b) => b.textContent?.trim() === texto) ?? null;
  const texto = (sel: string) => el().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const flush = async (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    await fixture.whenStable();
  };
  const carregar = async (c: Consentimento) => {
    const r = ctrl.expectOne(URL);
    expect(r.request.method).toBe('GET');
    await flush(r, c);
  };
  const clicar = async (rotulo: string) => {
    botao(rotulo)!.click();
    await fixture.whenStable();
  };

  it('mostra carregando e depois o estado', async () => {
    expect(texto('[role="status"]')).toBe('Carregando o consentimento…');
    await carregar(NENHUM);
    expect(el().querySelector('[role="status"]')).toBeNull();
    expect(texto('[data-teste="estado"]')).toBe('Não registrado');
  });

  it('NENHUM: pill com texto, so "Registrar consentimento", sem historico', async () => {
    await carregar(NENHUM);
    expect(botao('Registrar consentimento')).not.toBeNull();
    expect(botao('Revogar consentimento')).toBeNull();
    expect(el().querySelector('.consentimento-historico')).toBeNull();
    expect(el().querySelector('time')).toBeNull();
  });

  it('CONCEDIDO: pill, desde, so "Revogar consentimento", historico com evento, data e termo', async () => {
    await carregar(CONCEDIDO);
    expect(texto('[data-teste="estado"]')).toContain('Concedido');
    expect(texto('[data-teste="estado"]')).toMatch(/desde \d{2}\/\d{2}\/\d{4}/);
    expect(botao('Revogar consentimento')).not.toBeNull();
    expect(botao('Registrar consentimento')).toBeNull();
    const itens = el().querySelectorAll('.consentimento-historico li');
    expect(itens.length).toBe(1);
    expect(itens[0].textContent).toContain('Concedido');
    expect(itens[0].textContent).toContain('Termo provisorio-1');
    expect(itens[0].querySelector('time')?.getAttribute('datetime')).toBe(T1);
    expect(itens[0].querySelector('time')?.textContent).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('REVOGADO: volta a oferecer "Registrar consentimento" e lista 2 eventos em ordem', async () => {
    await carregar(REVOGADO);
    expect(texto('[data-teste="estado"]')).toContain('Revogado');
    expect(botao('Registrar consentimento')).not.toBeNull();
    expect(botao('Revogar consentimento')).toBeNull();
    const itens = Array.from(el().querySelectorAll('.consentimento-historico li'));
    expect(itens.map((i) => i.querySelector('.consentimento-evento')?.textContent)).toEqual([
      'Concedido',
      'Revogado',
    ]);
  });

  it('mostra o aviso honesto do contrato', async () => {
    await carregar(NENHUM);
    expect(texto('.consentimento-aviso')).toBe(
      'Nesta versão o registro é feito por você. O termo assinado pelo paciente chega em uma próxima etapa.',
    );
  });

  it('registrar: POST CONCEDIDO, troca o estado, avisa e foca o estado', async () => {
    await carregar(NENHUM);
    await clicar('Registrar consentimento');
    const r = ctrl.expectOne(URL);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ evento: 'CONCEDIDO' });
    await flush(r, CONCEDIDO, 201);
    expect(texto('[data-teste="estado"]')).toContain('Concedido');
    expect(texto('[data-teste="aviso"]')).toBe('Consentimento registrado.');
    expect(botao('Revogar consentimento')).not.toBeNull();
    expect(document.activeElement).toBe(el().querySelector('[data-teste="estado"]'));
  });

  it('sem duplo envio: botao desabilitado enquanto envia', async () => {
    await carregar(NENHUM);
    await clicar('Registrar consentimento');
    expect(botao('Registrando…')!.disabled).toBeTrue();
    botao('Registrando…')!.click();
    await fixture.whenStable();
    await flush(ctrl.expectOne(URL), CONCEDIDO, 201);
  });

  describe('revogar com confirmacao', () => {
    beforeEach(() => carregar(CONCEDIDO));

    it('clicar em Revogar NAO envia: abre a confirmacao e foca "Cancelar"', async () => {
      await clicar('Revogar consentimento');
      ctrl.expectNone(URL);
      const c = el().querySelector('[data-teste="confirmacao"]')!;
      expect(c.textContent).toContain('Revogar o consentimento?');
      expect(c.textContent).toContain('Os documentos antigos continuam guardados');
      expect(c.getAttribute('aria-labelledby')).toBe('cs-confirma-titulo');
      expect(document.activeElement).toBe(botao('Cancelar'));
      expect(botao('Revogar consentimento')).toBeNull();
    });

    it('Cancelar fecha, nao envia e devolve o foco ao botao Revogar', async () => {
      await clicar('Revogar consentimento');
      await clicar('Cancelar');
      ctrl.expectNone(URL);
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(document.activeElement).toBe(botao('Revogar consentimento'));
    });

    it('Escape fecha a confirmacao sem enviar', async () => {
      await clicar('Revogar consentimento');
      el()
        .querySelector('[data-teste="confirmacao"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      ctrl.expectNone(URL);
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(document.activeElement).toBe(botao('Revogar consentimento'));
    });

    it('Confirmar: POST REVOGADO, fecha, atualiza o estado e avisa', async () => {
      await clicar('Revogar consentimento');
      await clicar('Confirmar revogação');
      const r = ctrl.expectOne(URL);
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toEqual({ evento: 'REVOGADO' });
      expect(botao('Revogando…')!.disabled).toBeTrue();
      await flush(r, REVOGADO, 201);
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(texto('[data-teste="estado"]')).toContain('Revogado');
      expect(texto('[data-teste="aviso"]')).toBe('Consentimento revogado.');
      expect(botao('Registrar consentimento')).not.toBeNull();
      expect(el().querySelectorAll('.consentimento-historico li').length).toBe(2);
    });
  });

  it('revogado e re-concedido: historico com 3 linhas', async () => {
    await carregar(REVOGADO);
    await clicar('Registrar consentimento');
    await flush(ctrl.expectOne(URL), TRES, 201);
    expect(el().querySelectorAll('.consentimento-historico li').length).toBe(3);
  });

  describe('erros', () => {
    it('409: recarrega o estado e avisa que mudou, sem perder o cartao', async () => {
      await carregar(NENHUM);
      await clicar('Registrar consentimento');
      await flush(ctrl.expectOne(URL), { message: 'Transicao invalida' }, 409);
      expect(texto('[data-teste="erro"]')).toBe('O estado mudou, confira e tente de novo.');
      // o estado real (ja concedido em outra aba) vem do GET de recarga
      const recarga = ctrl.expectOne(URL);
      expect(recarga.request.method).toBe('GET');
      await flush(recarga, CONCEDIDO);
      expect(texto('[data-teste="estado"]')).toContain('Concedido');
      expect(botao('Revogar consentimento')).not.toBeNull();
      expect(texto('[data-teste="erro"]')).toBe('O estado mudou, confira e tente de novo.');
    });

    it('409 durante a revogacao fecha a confirmacao e recarrega', async () => {
      await carregar(CONCEDIDO);
      await clicar('Revogar consentimento');
      await clicar('Confirmar revogação');
      await flush(ctrl.expectOne(URL), {}, 409);
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      await flush(ctrl.expectOne(URL), REVOGADO);
      expect(texto('[data-teste="estado"]')).toContain('Revogado');
    });

    it('404 ao registrar: mensagem, sem recarregar', async () => {
      await carregar(NENHUM);
      await clicar('Registrar consentimento');
      await flush(ctrl.expectOne(URL), {}, 404);
      expect(texto('[data-teste="erro"]')).toBe('Paciente não encontrado.');
      expect(botao('Registrar consentimento')!.disabled).toBeFalse();
    });

    it('503 e rede ao registrar: mensagem, botao liberado, estado preservado', async () => {
      await carregar(NENHUM);
      await clicar('Registrar consentimento');
      await flush(ctrl.expectOne(URL), {}, 503);
      expect(texto('[data-teste="erro"]')).toContain('Confira sua conexão');
      expect(botao('Registrar consentimento')!.disabled).toBeFalse();
      await clicar('Registrar consentimento');
      ctrl.expectOne(URL).error(new ProgressEvent('error'));
      await fixture.whenStable();
      expect(texto('[data-teste="erro"]')).toContain('Confira sua conexão');
      expect(texto('[data-teste="estado"]')).toContain('Não registrado');
    });

    it('401 ao registrar: sem mensagem de falha inventada alem da generica, sem quebrar', async () => {
      await carregar(NENHUM);
      await clicar('Registrar consentimento');
      await flush(ctrl.expectOne(URL), {}, 401);
      expect(el().querySelector('[data-teste="estado"]')).not.toBeNull();
    });

    it('erro ao carregar (503/404/rede) mostra "Tentar de novo", que refaz o GET', async () => {
      await flush(ctrl.expectOne(URL), {}, 503);
      expect(texto('[role="alert"]')).toContain('Não foi possível carregar o consentimento.');
      expect(botao('Registrar consentimento')).toBeNull();
      await clicar('Tentar de novo');
      await carregar(CONCEDIDO);
      expect(el().querySelector('[role="alert"]')).toBeNull();
      expect(texto('[data-teste="estado"]')).toContain('Concedido');
    });
  });

  it('nao guarda nada em localStorage nem sessionStorage', async () => {
    localStorage.clear();
    sessionStorage.clear();
    await carregar(NENHUM);
    await clicar('Registrar consentimento');
    await flush(ctrl.expectOne(URL), CONCEDIDO, 201);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
