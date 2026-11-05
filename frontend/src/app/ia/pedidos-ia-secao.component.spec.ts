import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Geracao } from './ia.service';
import { PedidosIaSecaoComponent } from './pedidos-ia-secao.component';

const PID = '11111111-1111-4111-8111-111111111111';
const OID = '33333333-3333-4333-8333-333333333333';
const DOC = '66666666-6666-4666-8666-666666666666';
const URL = `/api/pacientes/${PID}/geracoes-ia`;

const g = (id: string, parcial: Partial<Geracao>): Geracao => ({
  id,
  estado: 'PENDENTE',
  tipoDocumento: 'EVOLUCAO',
  origemId: OID,
  documentoId: null,
  motivo: null,
  retentavel: null,
  avisos: [],
  criadoEm: '2026-11-05T10:00:00.000Z',
  finalizadoEm: null,
  ...parcial,
});

describe('PedidosIaSecaoComponent', () => {
  let fixture: ComponentFixture<PedidosIaSecaoComponent>;
  let ctrl: HttpTestingController;

  const montar = async () => {
    TestBed.configureTestingModule({
      imports: [PedidosIaSecaoComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PedidosIaSecaoComponent);
    fixture.componentRef.setInput('pacienteId', PID);
    await fixture.whenStable();
  };
  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const flush = async (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    await fixture.whenStable();
  };
  const linhas = () =>
    Array.from(el().querySelectorAll('li')).map((li) => ({
      link: li.querySelector('a')?.textContent?.trim(),
      href: li.querySelector('a')?.getAttribute('href'),
      pill: li.querySelector('app-pill')?.textContent?.trim(),
    }));

  it('uma chamada so ao abrir (GET da lista do paciente)', async () => {
    await montar();
    const r = ctrl.expectOne(URL);
    expect(r.request.method).toBe('GET');
    await flush(r, []);
  });

  it('sem pedidos: a secao nem aparece', async () => {
    await montar();
    await flush(ctrl.expectOne(URL), []);
    expect(el().querySelector('section')).toBeNull();
  });

  it('PENDENTE e FALHOU levam ao acompanhamento; PRONTO abre o documento; pill sempre com texto', async () => {
    await montar();
    await flush(ctrl.expectOne(URL), [
      g('g1', { estado: 'PENDENTE' }),
      g('g2', { estado: 'FALHOU', motivo: 'TIMEOUT', retentavel: true, tipoDocumento: 'ANAMNESE' }),
      g('g3', { estado: 'PRONTO', documentoId: DOC }),
    ]);
    expect(el().querySelector('h2')?.textContent).toBe('Pedidos de IA');
    expect(linhas()).toEqual([
      {
        link: 'Acompanhar Evolução',
        href: `/pacientes/${PID}/documentos/${OID}/ia?geracao=g1`,
        pill: 'Gerando',
      },
      {
        link: 'Acompanhar Anamnese',
        href: `/pacientes/${PID}/documentos/${OID}/ia?geracao=g2`,
        pill: 'Falhou',
      },
      { link: 'Abrir Evolução', href: `/pacientes/${PID}/documentos/${DOC}`, pill: 'Pronto' },
    ]);
  });

  it('previas que nao foram enviadas ficam de fora', async () => {
    await montar();
    await flush(ctrl.expectOne(URL), [
      g('g1', { estado: 'PREVIA' }),
      g('g2', { estado: 'PENDENTE' }),
    ]);
    expect(linhas().length).toBe(1);
    expect(linhas()[0].pill).toBe('Gerando');
  });

  it('so previas: a secao nao aparece', async () => {
    await montar();
    await flush(ctrl.expectOne(URL), [g('g1', { estado: 'PREVIA' })]);
    expect(el().querySelector('section')).toBeNull();
  });

  it('erro: mensagem e Tentar de novo refaz a chamada', async () => {
    await montar();
    await flush(ctrl.expectOne(URL), {}, 500);
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível carregar os pedidos de IA',
    );
    (el().querySelector('[role="alert"] button') as HTMLElement).click();
    await fixture.whenStable();
    await flush(ctrl.expectOne(URL), [g('g1', { estado: 'PENDENTE' })]);
    expect(linhas().length).toBe(1);
  });

  it('nao mostra nenhum texto do pedido (so metadados)', async () => {
    await montar();
    await flush(ctrl.expectOne(URL), [g('g1', { estado: 'PRONTO', documentoId: DOC })]);
    expect(el().textContent).not.toMatch(/PACIENTE|CPF/);
  });
});
