import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PacientesPage } from './pacientes.page';
import { Paciente } from './pacientes.service';

const LISTA: Paciente[] = [
  {
    id: 'a1',
    nome: 'Ana Lima',
    nascimento: '1990-05-17',
    telefone: '+55 11 99999-0000',
    email: 'ana@exemplo.com',
    criadoEm: '2026-10-01T10:00:00.000Z',
    consentimento: 'CONCEDIDO',
  },
  {
    id: 'b2',
    nome: 'Bruno Alves',
    nascimento: null,
    telefone: null,
    email: null,
    criadoEm: '2026-10-02T10:00:00.000Z',
    consentimento: 'NENHUM',
  },
  {
    id: 'c3',
    nome: 'Carla Dias',
    nascimento: null,
    telefone: null,
    email: null,
    criadoEm: '2026-10-03T10:00:00.000Z',
    consentimento: 'REVOGADO',
  },
  // Sem o campo (corpo de POST/PATCH): trata como NENHUM.
  {
    id: 'd4',
    nome: 'Davi Reis',
    nascimento: null,
    telefone: null,
    email: null,
    criadoEm: '2026-10-04T10:00:00.000Z',
  },
];

describe('PacientesPage', () => {
  let fixture: ComponentFixture<PacientesPage>;
  let ctrl: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [PacientesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PacientesPage);
    await fixture.whenStable();
  });
  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const listar = async (l: Paciente[]) => {
    const r = ctrl.expectOne('/api/pacientes');
    expect(r.request.method).toBe('GET');
    r.flush(l);
    await fixture.whenStable();
  };

  it('mostra carregando e depois a tabela, com links por id e data sem fuso', async () => {
    expect(el().textContent).toContain('Carregando os pacientes…');
    await listar(LISTA);
    const linhas = Array.from(el().querySelectorAll('tbody tr'));
    expect(linhas.length).toBe(4);
    const [ana, bruno] = linhas;
    const link = ana.querySelector('th a') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('Ana Lima');
    expect(link.getAttribute('href')).toBe('/pacientes/a1');
    expect(ana.querySelector('time')?.textContent).toBe('17/05/1990');
    expect(ana.textContent).toContain('+55 11 99999-0000');
    expect(ana.textContent).toContain('ana@exemplo.com');
    expect(bruno.textContent?.match(/Não informado/g)?.length).toBe(3);
    expect(el().querySelector('table caption')?.textContent).toContain('4 cadastrados');
    expect(el().textContent).not.toContain('Carregando');
    expect(el().querySelector('a[href="/pacientes/novo"]')).not.toBeNull();
  });

  it('coluna Consentimento: pill com texto para cada estado e NENHUM quando o campo falta', async () => {
    await listar(LISTA);
    expect(el().querySelector('thead')?.textContent).toContain('Consentimento');
    const pills = Array.from(el().querySelectorAll('tbody tr')).map((tr) => {
      const p = tr.querySelector('td[data-rotulo="Consentimento"] app-pill')!;
      return [p.textContent?.trim(), p.getAttribute('data-tone'), p.classList.contains('dashed')];
    });
    expect(pills).toEqual([
      ['Concedido', 'blue', false],
      ['Não registrado', 'yellow', true],
      ['Revogado', 'pink', false],
      ['Não registrado', 'yellow', true],
    ]);
  });

  it('lista vazia mostra estado vazio com botao Novo paciente', async () => {
    await listar([]);
    const vazio = el().querySelector('[data-teste="vazio"]')!;
    expect(vazio.textContent).toContain('Nenhum paciente ainda');
    const botao = vazio.querySelector('a') as HTMLAnchorElement;
    expect(botao.textContent?.trim()).toBe('Novo paciente');
    expect(botao.getAttribute('href')).toBe('/pacientes/novo');
    expect(el().querySelector('table')).toBeNull();
    expect(el().querySelectorAll('a[href="/pacientes/novo"]').length).toBe(1);
  });

  it('erro de rede mostra "Tentar de novo", que refaz a chamada', async () => {
    ctrl.expectOne('/api/pacientes').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível carregar os pacientes.',
    );
    expect(el().querySelector('table')).toBeNull();
    (
      Array.from(el().querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Tentar de novo',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    await listar(LISTA);
    expect(el().querySelectorAll('tbody tr').length).toBe(4);
    expect(el().querySelector('[role="alert"]')).toBeNull();
  });

  it('5xx na lista tambem cai no erro, sem derrubar a tela', async () => {
    ctrl.expectOne('/api/pacientes').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('PacientesPage (aviso da navegacao)', () => {
  it('mostra "Paciente nao encontrado" quando a tela anterior pediu', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'pacientes', component: PacientesPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const ctrl = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await TestBed.inject(Router).navigateByUrl('/pacientes', {
      state: { aviso: 'nao-encontrado' },
    });
    ctrl.expectOne('/api/pacientes').flush([]);
    await harness.fixture.whenStable();
    const aviso = (harness.routeNativeElement as HTMLElement).querySelector('[data-teste="aviso"]');
    expect(aviso?.textContent).toContain('Paciente não encontrado.');
    ctrl.verify();
  });

  it('sem state nao mostra aviso', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'pacientes', component: PacientesPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const ctrl = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/pacientes');
    ctrl.expectOne('/api/pacientes').flush([]);
    await harness.fixture.whenStable();
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('[data-teste="aviso"]'),
    ).toBeNull();
    ctrl.verify();
  });
});
