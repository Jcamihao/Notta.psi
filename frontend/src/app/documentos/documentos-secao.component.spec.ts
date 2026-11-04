import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EstadoConsentimento } from '../pacientes/consentimento.service';
import { DocumentosSecaoComponent } from './documentos-secao.component';
import { DocumentoResumo } from './documentos.service';

const PID = '11111111-1111-4111-8111-111111111111';
const URL = `/api/pacientes/${PID}/documentos`;
const BLOQUEIO = 'Registre o consentimento para criar documentos.';

const LISTA: DocumentoResumo[] = [
  {
    id: 'a1',
    tipo: 'EVOLUCAO',
    dataSessao: '2026-11-02',
    status: 'RASCUNHO',
    criadoEm: '2026-11-03T13:00:00.000Z',
  },
  {
    id: 'a2',
    tipo: 'NOTA_BRUTA',
    dataSessao: null,
    status: 'APROVADO',
    criadoEm: '2026-11-01T13:00:00.000Z',
  },
  {
    id: 'a3',
    tipo: 'ANAMNESE',
    dataSessao: '2026-10-31',
    status: 'RASCUNHO',
    criadoEm: '2026-10-31T13:00:00.000Z',
  },
];

describe('DocumentosSecaoComponent', () => {
  let fixture: ComponentFixture<DocumentosSecaoComponent>;
  let ctrl: HttpTestingController;

  const montar = async (estado: EstadoConsentimento) => {
    TestBed.configureTestingModule({
      imports: [DocumentosSecaoComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DocumentosSecaoComponent);
    fixture.componentRef.setInput('pacienteId', PID);
    fixture.componentRef.setInput('consentimento', estado);
    await fixture.whenStable();
  };
  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const texto = (sel: string) => el().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const novo = () =>
    Array.from(el().querySelectorAll('a, button')).find(
      (e) => e.textContent?.trim() === 'Novo documento',
    ) as HTMLElement;
  const flush = async (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    await fixture.whenStable();
  };
  const carregar = async (lista: DocumentoResumo[]) => flush(ctrl.expectOne(URL), lista);

  it('faz uma chamada so (GET da lista) e mostra carregando', async () => {
    await montar('CONCEDIDO');
    expect(el().querySelector('[role="status"]')?.textContent).toContain(
      'Carregando os documentos',
    );
    const r = ctrl.expectOne(URL);
    expect(r.request.method).toBe('GET');
    await flush(r, []);
  });

  it('vazio: mostra o texto e nenhum item', async () => {
    await montar('CONCEDIDO');
    await carregar([]);
    expect(texto('[data-teste="vazio"]')).toBe('Nenhum documento ainda.');
    expect(el().querySelector('ul')).toBeNull();
  });

  it('itens: tipo em portugues com acento, data da sessao, status com texto, criado em', async () => {
    await montar('CONCEDIDO');
    await carregar(LISTA);
    const itens = Array.from(el().querySelectorAll('li'));
    const t = (i: number) => itens[i].textContent?.replace(/\s+/g, ' ');
    expect(itens.length).toBe(3);
    expect(t(0)).toContain('Evolução da sessão de 02/11/2026');
    expect(itens[0].textContent).toContain('Rascunho');
    expect(itens[0].querySelector('app-pill')?.textContent?.trim()).toBe('Rascunho');
    expect(itens[0].textContent).toMatch(/Criado em 03\/11\/2026, \d{2}:\d{2}/);
    expect(t(1)).toContain('Nota bruta sem data de sessão');
    expect(itens[1].querySelector('app-pill')?.textContent?.trim()).toBe('Aprovado');
    expect(t(2)).toContain('Anamnese da sessão de 31/10/2026');
  });

  it('cada item e um link para a leitura do documento', async () => {
    await montar('CONCEDIDO');
    await carregar(LISTA);
    const hrefs = Array.from(el().querySelectorAll('li a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      `/pacientes/${PID}/documentos/a1`,
      `/pacientes/${PID}/documentos/a2`,
      `/pacientes/${PID}/documentos/a3`,
    ]);
  });

  it('consentimento CONCEDIDO: "Novo documento" e um link ativo e sem aviso de bloqueio', async () => {
    await montar('CONCEDIDO');
    await carregar([]);
    expect(novo().tagName).toBe('A');
    expect(novo().getAttribute('href')).toBe(`/pacientes/${PID}/documentos/novo`);
    expect(el().querySelector('[data-teste="bloqueio"]')).toBeNull();
  });

  for (const estado of ['NENHUM', 'REVOGADO'] as const) {
    it(`consentimento ${estado}: botao desabilitado com o motivo visivel e ligado ao botao`, async () => {
      await montar(estado);
      await carregar([]);
      const b = novo() as HTMLButtonElement;
      expect(b.tagName).toBe('BUTTON');
      expect(b.disabled).toBeTrue();
      expect(texto('[data-teste="bloqueio"]')).toBe(BLOQUEIO);
      expect(b.getAttribute('aria-describedby')).toBe('dc-bloqueio');
      expect(el().querySelector('#dc-bloqueio')).not.toBeNull();
    });
  }

  it('reflete a mudanca do consentimento sem recarregar a lista', async () => {
    await montar('NENHUM');
    await carregar(LISTA);
    expect((novo() as HTMLButtonElement).disabled).toBeTrue();
    fixture.componentRef.setInput('consentimento', 'CONCEDIDO');
    await fixture.whenStable();
    expect(novo().tagName).toBe('A');
    expect(el().querySelector('[data-teste="bloqueio"]')).toBeNull();
    fixture.componentRef.setInput('consentimento', 'REVOGADO');
    await fixture.whenStable();
    expect((novo() as HTMLButtonElement).disabled).toBeTrue();
    expect(el().querySelectorAll('li').length).toBe(3);
    ctrl.expectNone(URL);
  });

  it('lista continua visivel com consentimento revogado (leitura segue permitida)', async () => {
    await montar('REVOGADO');
    await carregar(LISTA);
    expect(el().querySelectorAll('li').length).toBe(3);
  });

  it('erro de rede/5xx: mostra alerta e "Tentar de novo" refaz a chamada', async () => {
    await montar('CONCEDIDO');
    await flush(ctrl.expectOne(URL), { statusCode: 503 }, 503);
    expect(texto('[role="alert"]')).toContain('Não foi possível carregar os documentos');
    (
      Array.from(el().querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Tentar de novo',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    await carregar([]);
    expect(el().querySelector('[role="alert"]')).toBeNull();
    expect(el().querySelector('[data-teste="vazio"]')).not.toBeNull();
  });

  it('tem titulo "Documentos" ligado a secao', async () => {
    await montar('CONCEDIDO');
    await carregar([]);
    expect(el().querySelector('section')?.getAttribute('aria-labelledby')).toBe('dc-titulo');
    expect(texto('#dc-titulo')).toBe('Documentos');
  });
});
