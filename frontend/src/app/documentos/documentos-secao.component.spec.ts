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
const URL_APROVADOS = `${URL}?status=APROVADO`;
const URL_RASCUNHOS = `${URL}?status=RASCUNHO`;
const BLOQUEIO = 'Registre o consentimento para criar documentos.';

const APROVADOS: DocumentoResumo[] = [
  {
    id: 'p1',
    tipo: 'EVOLUCAO',
    dataSessao: '2026-11-02',
    status: 'APROVADO',
    criadoEm: '2026-11-03T13:00:00.000Z',
    aprovadoEm: '2026-11-03T15:30:00.000Z',
    substituiId: null,
  },
  {
    id: 'p2',
    tipo: 'NOTA_BRUTA',
    dataSessao: null,
    status: 'APROVADO',
    criadoEm: '2026-11-01T13:00:00.000Z',
    aprovadoEm: '2026-11-01T14:00:00.000Z',
    substituiId: 'p9',
  },
];
const RASCUNHOS: DocumentoResumo[] = [
  {
    id: 'r1',
    tipo: 'ANAMNESE',
    dataSessao: '2026-10-31',
    status: 'RASCUNHO',
    criadoEm: '2026-10-31T13:00:00.000Z',
    aprovadoEm: null,
    substituiId: null,
  },
  {
    id: 'r2',
    tipo: 'EVOLUCAO',
    dataSessao: null,
    status: 'RASCUNHO',
    criadoEm: '2026-10-30T13:00:00.000Z',
    aprovadoEm: null,
    substituiId: null,
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
  const secao = (n: 0 | 1) => el().querySelectorAll('section')[n];
  const novo = () =>
    Array.from(el().querySelectorAll('a, button')).find(
      (e) => e.textContent?.trim() === 'Novo documento',
    ) as HTMLElement;
  const flush = async (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    await fixture.whenStable();
  };
  // Aprovados primeiro; so depois a requisicao dos rascunhos existe.
  const carregar = async (aprovados: DocumentoResumo[], rascunhos: DocumentoResumo[]) => {
    await flush(ctrl.expectOne(URL_APROVADOS), aprovados);
    await flush(ctrl.expectOne(URL_RASCUNHOS), rascunhos);
  };
  const tentarDeNovo = async (s: 0 | 1) => {
    (
      Array.from(secao(s).querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Tentar de novo',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
  };

  it('duas chamadas em sequencia: aprovados, e so depois rascunhos; mostra carregando nas duas', async () => {
    await montar('CONCEDIDO');
    expect(texto('#pr-titulo')).toBe('Prontuário');
    expect(secao(0).querySelector('[role="status"]')?.textContent).toContain(
      'Carregando o prontuário',
    );
    expect(secao(1).querySelector('[role="status"]')?.textContent).toContain(
      'Carregando os rascunhos',
    );
    const a = ctrl.expectOne(URL_APROVADOS);
    expect(a.request.method).toBe('GET');
    ctrl.expectNone(URL_RASCUNHOS);
    await flush(a, []);
    const r = ctrl.expectOne(URL_RASCUNHOS);
    expect(r.request.method).toBe('GET');
    await flush(r, []);
  });

  it('prontuario tem so aprovados (com "Aprovado em") e rascunhos ficam na secao propria', async () => {
    await montar('CONCEDIDO');
    await carregar(APROVADOS, RASCUNHOS);
    expect(texto('#pr-titulo')).toBe('Prontuário');
    expect(texto('#rs-titulo')).toBe('Rascunhos');
    const pr = Array.from(secao(0).querySelectorAll('li'));
    const rs = Array.from(secao(1).querySelectorAll('li'));
    const t = (li: Element) => li.textContent?.replace(/\s+/g, ' ');
    expect(pr.length).toBe(2);
    expect(t(pr[0])).toContain('Evolução da sessão de 02/11/2026');
    expect(pr[0].querySelector('app-pill')?.textContent?.trim()).toBe('Aprovado');
    expect(t(pr[0])).toMatch(/Aprovado em 03\/11\/2026, \d{2}:\d{2}/);
    expect(t(pr[1])).toContain('Nota bruta sem data de sessão');
    expect(rs.length).toBe(2);
    expect(t(rs[0])).toContain('Anamnese da sessão de 31/10/2026');
    expect(rs[0].querySelector('app-pill')?.textContent?.trim()).toBe('Rascunho');
    expect(t(rs[0])).toMatch(/Criado em 31\/10\/2026, \d{2}:\d{2}/);
    expect(secao(0).textContent).not.toContain('Rascunho');
    expect(secao(1).textContent).not.toContain('Aprovado');
  });

  it('cada item e um link para a leitura do documento', async () => {
    await montar('CONCEDIDO');
    await carregar(APROVADOS, RASCUNHOS);
    const hrefs = Array.from(el().querySelectorAll('li a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(
      ['p1', 'p2', 'r1', 'r2'].map((id) => `/pacientes/${PID}/documentos/${id}`),
    );
  });

  it('vazio de cada secao tem texto proprio', async () => {
    await montar('CONCEDIDO');
    await carregar([], []);
    expect(texto('[data-teste="vazio-prontuario"]')).toBe('Nenhum documento aprovado ainda.');
    expect(texto('[data-teste="vazio-rascunhos"]')).toBe('Nenhum rascunho.');
    expect(el().querySelector('ul')).toBeNull();
  });

  it('so rascunhos: prontuario vazio e rascunhos listados', async () => {
    await montar('CONCEDIDO');
    await carregar([], RASCUNHOS);
    expect(secao(0).querySelector('[data-teste="vazio-prontuario"]')).not.toBeNull();
    expect(secao(1).querySelectorAll('li').length).toBe(2);
  });

  it('consentimento CONCEDIDO: "Novo documento" e um link ativo na secao de rascunhos', async () => {
    await montar('CONCEDIDO');
    await carregar([], []);
    expect(novo().tagName).toBe('A');
    expect(novo().getAttribute('href')).toBe(`/pacientes/${PID}/documentos/novo`);
    expect(secao(1).contains(novo())).toBeTrue();
    expect(el().querySelector('[data-teste="bloqueio"]')).toBeNull();
  });

  for (const estado of ['NENHUM', 'REVOGADO'] as const) {
    it(`consentimento ${estado}: botao desabilitado com o motivo visivel e ligado ao botao`, async () => {
      await montar(estado);
      await carregar([], []);
      const b = novo() as HTMLButtonElement;
      expect(b.tagName).toBe('BUTTON');
      expect(b.disabled).toBeTrue();
      expect(texto('[data-teste="bloqueio"]')).toBe(BLOQUEIO);
      expect(b.getAttribute('aria-describedby')).toBe('dc-bloqueio');
      expect(el().querySelector('#dc-bloqueio')).not.toBeNull();
    });
  }

  it('reflete a mudanca do consentimento sem recarregar as listas', async () => {
    await montar('NENHUM');
    await carregar(APROVADOS, RASCUNHOS);
    expect((novo() as HTMLButtonElement).disabled).toBeTrue();
    fixture.componentRef.setInput('consentimento', 'CONCEDIDO');
    await fixture.whenStable();
    expect(novo().tagName).toBe('A');
    expect(el().querySelector('[data-teste="bloqueio"]')).toBeNull();
    fixture.componentRef.setInput('consentimento', 'REVOGADO');
    await fixture.whenStable();
    expect((novo() as HTMLButtonElement).disabled).toBeTrue();
    expect(el().querySelectorAll('li').length).toBe(4);
    ctrl.expectNone(URL_APROVADOS);
    ctrl.expectNone(URL_RASCUNHOS);
  });

  it('listas continuam visiveis com consentimento revogado (leitura segue permitida)', async () => {
    await montar('REVOGADO');
    await carregar(APROVADOS, RASCUNHOS);
    expect(el().querySelectorAll('li').length).toBe(4);
  });

  it('erro so no prontuario: rascunhos carregam; "Tentar de novo" refaz so os aprovados', async () => {
    await montar('CONCEDIDO');
    await flush(ctrl.expectOne(URL_APROVADOS), { statusCode: 503 }, 503);
    await flush(ctrl.expectOne(URL_RASCUNHOS), RASCUNHOS);
    expect(texto('[data-teste="erro-prontuario"]')).toContain(
      'Não foi possível carregar o prontuário',
    );
    expect(el().querySelector('[data-teste="erro-rascunhos"]')).toBeNull();
    expect(secao(1).querySelectorAll('li').length).toBe(2);
    await tentarDeNovo(0);
    await flush(ctrl.expectOne(URL_APROVADOS), APROVADOS);
    ctrl.expectNone(URL_RASCUNHOS);
    expect(el().querySelector('[role="alert"]')).toBeNull();
    expect(secao(0).querySelectorAll('li').length).toBe(2);
  });

  it('erro so nos rascunhos: prontuario fica; "Tentar de novo" refaz so os rascunhos', async () => {
    await montar('CONCEDIDO');
    await flush(ctrl.expectOne(URL_APROVADOS), APROVADOS);
    await flush(ctrl.expectOne(URL_RASCUNHOS), { statusCode: 503 }, 503);
    expect(texto('[data-teste="erro-rascunhos"]')).toContain(
      'Não foi possível carregar os rascunhos',
    );
    expect(secao(0).querySelectorAll('li').length).toBe(2);
    await tentarDeNovo(1);
    await flush(ctrl.expectOne(URL_RASCUNHOS), []);
    ctrl.expectNone(URL_APROVADOS);
    expect(el().querySelector('[data-teste="vazio-rascunhos"]')).not.toBeNull();
  });

  it('titulos ligados as secoes', async () => {
    await montar('CONCEDIDO');
    await carregar([], []);
    expect(secao(0).getAttribute('aria-labelledby')).toBe('pr-titulo');
    expect(secao(1).getAttribute('aria-labelledby')).toBe('rs-titulo');
  });
});
