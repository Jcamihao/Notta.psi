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

  it('"Paciente excluído." aparece como status (anuncia sem tirar o foco)', async () => {
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
      state: { aviso: 'excluido' },
    });
    ctrl.expectOne('/api/pacientes').flush([]);
    await harness.fixture.whenStable();
    const aviso = (harness.routeNativeElement as HTMLElement).querySelector('[data-teste="aviso"]');
    expect(aviso?.textContent).toContain('Paciente excluído.');
    expect(aviso?.getAttribute('role')).toBe('status');
    ctrl.verify();
  });

  it('404 da exclusao: "Paciente não encontrado. Ele pode já ter sido excluído." como alerta', async () => {
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
      state: { aviso: 'nao-encontrado-exclusao' },
    });
    ctrl.expectOne('/api/pacientes').flush([]);
    await harness.fixture.whenStable();
    const aviso = (harness.routeNativeElement as HTMLElement).querySelector('[data-teste="aviso"]');
    expect(aviso?.textContent).toContain('Paciente não encontrado. Ele pode já ter sido excluído.');
    expect(aviso?.getAttribute('role')).toBe('alert');
    ctrl.verify();
  });

  it('o aviso de exclusao some ao navegar de novo (sem state)', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'pacientes', component: PacientesPage },
          { path: 'outra', component: PacientesPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const ctrl = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const harness = await RouterTestingHarness.create();
    await router.navigateByUrl('/pacientes', { state: { aviso: 'excluido' } });
    ctrl.expectOne('/api/pacientes').flush([]);
    await harness.fixture.whenStable();
    await router.navigateByUrl('/outra');
    ctrl.expectOne('/api/pacientes').flush([]);
    await harness.fixture.whenStable();
    await router.navigateByUrl('/pacientes');
    ctrl.expectOne('/api/pacientes').flush([]);
    await harness.fixture.whenStable();
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('[data-teste="aviso"]'),
    ).toBeNull();
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

describe('PacientesPage (busca e filtros)', () => {
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
  const campo = () => el().querySelector('input[type="search"]') as HTMLInputElement;
  const botao = (rotulo: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === rotulo) as
      HTMLButtonElement | undefined;
  const nomes = () =>
    Array.from(el().querySelectorAll('tbody th a')).map((a) => a.textContent?.trim());
  const contagem = () => el().querySelector('[data-teste="contagem"]');
  const passo = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const digitar = async (texto: string) => {
    campo().value = texto;
    campo().dispatchEvent(new Event('input'));
    await passo();
  };
  const clicar = async (rotulo: string) => {
    botao(rotulo)!.click();
    await passo();
  };
  const carregar = async (l: Paciente[]) => {
    ctrl.expectOne('/api/pacientes').flush(l);
    await passo();
  };
  const muitos = (n: number): Paciente[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      nome: `Paciente ${i}`,
      nascimento: null,
      telefone: null,
      email: null,
      criadoEm: '2026-10-01T10:00:00.000Z',
      consentimento: 'NENHUM',
    }));

  it('campo "Buscar paciente" com label visível, dentro de form role="search", sem recursos do navegador', async () => {
    await carregar(LISTA);
    const form = el().querySelector('form[role="search"]') as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(form.contains(campo())).toBeTrue();
    const label = form.querySelector('label') as HTMLLabelElement;
    expect(label.textContent?.trim()).toBe('Buscar paciente');
    expect(label.htmlFor).toBe(campo().id);
    expect(campo().getAttribute('autocomplete')).toBe('off');
    expect(campo().getAttribute('spellcheck')).toBe('false');
    expect(campo().getAttribute('autocapitalize')).toBe('off');
    expect(campo().hasAttribute('name')).toBeFalse();
  });

  it('Enter (submit do form) nao recarrega a pagina', async () => {
    await carregar(LISTA);
    const form = el().querySelector('form[role="search"]') as HTMLFormElement;
    const evento = new Event('submit', { cancelable: true });
    form.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBeTrue();
  });

  it('digitar filtra a tabela e atualiza a contagem em aria-live', async () => {
    await carregar(LISTA);
    expect(nomes().length).toBe(4);
    expect(contagem()?.textContent?.trim()).toBe('4 de 4 pacientes');
    expect(contagem()?.getAttribute('aria-live')).toBe('polite');
    await digitar('ana');
    expect(nomes()).toEqual(['Ana Lima']);
    expect(contagem()?.textContent?.trim()).toBe('1 de 4 pacientes');
  });

  it('contagem no singular quando a lista tem um paciente', async () => {
    await carregar([LISTA[0]]);
    expect(contagem()?.textContent?.trim()).toBe('1 de 1 paciente');
  });

  it('filtro de consentimento: grupo rotulado, aria-pressed no ativo, Todos por padrão', async () => {
    await carregar(LISTA);
    const grupo = el().querySelector('[role="group"][aria-label="Filtrar por consentimento"]');
    expect(grupo).not.toBeNull();
    const rotulos = Array.from(grupo!.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(rotulos).toEqual(['Todos', 'Concedido', 'Não registrado', 'Revogado']);
    expect(botao('Todos')?.getAttribute('aria-pressed')).toBe('true');
    expect(botao('Revogado')?.getAttribute('aria-pressed')).toBe('false');
    await clicar('Revogado');
    expect(nomes()).toEqual(['Carla Dias']);
    expect(botao('Revogado')?.getAttribute('aria-pressed')).toBe('true');
    expect(botao('Todos')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('"Não registrado" pega NENHUM, inclusive quem não tem o campo', async () => {
    await carregar(LISTA);
    await clicar('Não registrado');
    expect(nomes()).toEqual(['Bruno Alves', 'Davi Reis']);
  });

  it('busca e filtro combinados (os dois valem)', async () => {
    await carregar(LISTA);
    await clicar('Não registrado');
    await digitar('a');
    expect(nomes()).toEqual(['Bruno Alves', 'Davi Reis']);
    expect(contagem()?.textContent?.trim()).toBe('2 de 4 pacientes');
    await digitar('bruno');
    expect(nomes()).toEqual(['Bruno Alves']);
  });

  it('nenhum resultado: role="status", botao limpar devolve tudo e foca o campo', async () => {
    await carregar(LISTA);
    await clicar('Revogado');
    await digitar('zzz');
    const status = el().querySelector('[role="status"][data-teste="sem-resultado"]');
    expect(status?.textContent).toContain('Nenhum paciente encontrado.');
    expect(el().querySelector('table')).toBeNull();
    expect(contagem()?.textContent?.trim()).toBe('0 de 4 pacientes');
    await clicar('Limpar busca e filtros');
    expect(nomes().length).toBe(4);
    expect(campo().value).toBe('');
    expect(botao('Todos')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(campo());
  });

  it('o botao "Limpar busca e filtros" só aparece com busca ou filtro ativo', async () => {
    await carregar(LISTA);
    expect(botao('Limpar busca e filtros')).toBeUndefined();
    await digitar('   ');
    expect(botao('Limpar busca e filtros')).toBeUndefined();
    await digitar('an');
    expect(botao('Limpar busca e filtros')).toBeDefined();
  });

  it('nota de limite só quando a lista chega a 500 pacientes', async () => {
    await carregar(muitos(499));
    expect(el().querySelector('[role="note"]')).toBeNull();
    fixture.destroy();
    fixture = TestBed.createComponent(PacientesPage);
    await fixture.whenStable();
    await carregar(muitos(500));
    const nota = el().querySelector('[role="note"]');
    expect(nota?.textContent).toContain(
      'A lista mostra no máximo 500 pacientes, e a busca só procura entre eles.',
    );
  });

  it('sem nenhum paciente cadastrado: sem busca, sem filtro e sem nota', async () => {
    await carregar([]);
    expect(el().querySelector('[data-teste="vazio"]')).not.toBeNull();
    expect(el().querySelector('form[role="search"]')).toBeNull();
    expect(el().querySelector('[role="group"]')).toBeNull();
    expect(el().querySelector('[role="note"]')).toBeNull();
  });

  it('digitar e filtrar nao disparam nenhuma requisicao extra', async () => {
    await carregar(LISTA);
    await digitar('a');
    await digitar('an');
    await clicar('Revogado');
    await clicar('Todos');
    expect(ctrl.match(() => true).length).toBe(0);
  });

  it('o termo digitado e o filtro nao vao para URL, console, storage nem history.state', async () => {
    const router = TestBed.inject(Router);
    const logs = [
      spyOn(console, 'log'),
      spyOn(console, 'info'),
      spyOn(console, 'warn'),
      spyOn(console, 'error'),
      spyOn(console, 'debug'),
    ];
    await carregar(LISTA);
    await digitar('sigilo-xyz');
    await clicar('Revogado');
    const armazenado = (s: Storage) =>
      Object.keys(s)
        .map((k) => k + s.getItem(k))
        .join('');
    expect(location.href).not.toContain('sigilo');
    expect(router.url).not.toContain('sigilo');
    expect(JSON.stringify(history.state ?? null)).not.toContain('sigilo');
    expect(armazenado(localStorage)).not.toContain('sigilo');
    expect(armazenado(sessionStorage)).not.toContain('sigilo');
    for (const spy of logs) {
      expect(JSON.stringify(spy.calls.allArgs())).not.toContain('sigilo');
    }
  });
});

describe('PacientesPage (paginacao)', () => {
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
  const campo = () => el().querySelector('input[type="search"]') as HTMLInputElement;
  const botao = (rotulo: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === rotulo) as
      HTMLButtonElement | undefined;
  const nomes = () =>
    Array.from(el().querySelectorAll('tbody th a')).map((a) => a.textContent?.trim());
  const contagem = () => el().querySelector('[data-teste="contagem"]');
  const nav = () => el().querySelector('nav[aria-label="Paginação"]') as HTMLElement | null;
  const select = () => nav()?.querySelector('select') as HTMLSelectElement | null;
  const textoPagina = () => nav()?.querySelector('p')?.textContent?.trim();
  const passo = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const clicar = async (rotulo: string) => {
    botao(rotulo)!.click();
    await passo();
  };
  const digitar = async (texto: string) => {
    campo().value = texto;
    campo().dispatchEvent(new Event('input'));
    await passo();
  };
  const trocarPorPagina = async (valor: number) => {
    select()!.value = String(valor);
    select()!.dispatchEvent(new Event('change'));
    await passo();
  };
  const carregar = async (l: Paciente[]) => {
    ctrl.expectOne('/api/pacientes').flush(l);
    await passo();
  };
  const muitos = (n: number, consentimento: Paciente['consentimento'] = 'NENHUM'): Paciente[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      nome: `Paciente ${String(i + 1).padStart(3, '0')}`,
      nascimento: null,
      telefone: null,
      email: null,
      criadoEm: '2026-10-01T10:00:00.000Z',
      consentimento,
    }));

  it('com 45 pacientes e padrao 20: 20 linhas, contagem, pagina 1 de 3 e Anterior desabilitado', async () => {
    await carregar(muitos(45));
    expect(nomes().length).toBe(20);
    expect(nomes()[0]).toBe('Paciente 001');
    expect(contagem()?.textContent?.trim()).toBe('1 a 20 de 45 pacientes');
    expect(textoPagina()).toBe('Página 1 de 3');
    expect(botao('Anterior')?.disabled).toBeTrue();
    expect(botao('Próxima')?.disabled).toBeFalse();
    expect(select()?.value).toBe('20');
    expect(nav()?.querySelector('label')?.textContent?.trim()).toBe('Por página');
  });

  it('Próxima vai para 21 a 40 e depois 41 a 45 (5 linhas), com Próxima desabilitada', async () => {
    await carregar(muitos(45));
    await clicar('Próxima');
    expect(nomes().length).toBe(20);
    expect(nomes()[0]).toBe('Paciente 021');
    expect(contagem()?.textContent?.trim()).toBe('21 a 40 de 45 pacientes');
    expect(textoPagina()).toBe('Página 2 de 3');
    expect(botao('Anterior')?.disabled).toBeFalse();
    await clicar('Próxima');
    expect(nomes()).toEqual([
      'Paciente 041',
      'Paciente 042',
      'Paciente 043',
      'Paciente 044',
      'Paciente 045',
    ]);
    expect(contagem()?.textContent?.trim()).toBe('41 a 45 de 45 pacientes');
    expect(textoPagina()).toBe('Página 3 de 3');
    expect(botao('Próxima')?.disabled).toBeTrue();
    await clicar('Anterior');
    expect(textoPagina()).toBe('Página 2 de 3');
  });

  it('trocar "Por página" para 10 e 30 recalcula e volta para a pagina 1', async () => {
    await carregar(muitos(45));
    await clicar('Próxima');
    await trocarPorPagina(10);
    expect(nomes().length).toBe(10);
    expect(textoPagina()).toBe('Página 1 de 5');
    expect(contagem()?.textContent?.trim()).toBe('1 a 10 de 45 pacientes');
    await clicar('Próxima');
    await trocarPorPagina(30);
    expect(nomes().length).toBe(30);
    expect(textoPagina()).toBe('Página 1 de 2');
    expect(contagem()?.textContent?.trim()).toBe('1 a 30 de 45 pacientes');
  });

  it('busca, filtro de consentimento e "Limpar" voltam para a pagina 1', async () => {
    await carregar(muitos(45));
    await clicar('Próxima');
    await digitar('paciente');
    expect(textoPagina()).toBe('Página 1 de 3');
    await clicar('Próxima');
    expect(textoPagina()).toBe('Página 2 de 3');
    await clicar('Revogado');
    await clicar('Todos');
    expect(textoPagina()).toBe('Página 1 de 3');
    await clicar('Próxima');
    await clicar('Limpar busca e filtros');
    expect(textoPagina()).toBe('Página 1 de 3');
  });

  it('busca que reduz para 10 ou menos esconde os controles', async () => {
    await carregar(muitos(45));
    expect(nav()).not.toBeNull();
    await digitar('paciente 00');
    expect(nav()).toBeNull();
    expect(nomes().length).toBe(9);
  });

  it('com 10 pacientes nao aparece nenhum controle de paginacao', async () => {
    await carregar(muitos(10));
    expect(nomes().length).toBe(10);
    expect(nav()).toBeNull();
    expect(contagem()?.textContent?.trim()).toBe('10 de 10 pacientes');
  });

  it('com 11 pacientes e padrao 20: controles aparecem, mas numa pagina so (Página 1 de 1)', async () => {
    await carregar(muitos(11));
    expect(nav()).not.toBeNull();
    expect(textoPagina()).toBe('Página 1 de 1');
    expect(botao('Próxima')?.disabled).toBeTrue();
    expect(contagem()?.textContent?.trim()).toBe('11 de 11 pacientes');
  });

  it('o foco vai para a linha de contagem depois de Próxima; Por página mantem o foco no select', async () => {
    await carregar(muitos(45));
    const proxima = botao('Próxima')!;
    proxima.focus();
    proxima.click();
    await passo();
    expect(document.activeElement).toBe(contagem());
    expect(contagem()?.getAttribute('tabindex')).toBe('-1');
    select()!.focus();
    await trocarPorPagina(10);
    expect(document.activeElement).toBe(select());
  });

  it('foco nao se perde quando Próxima fica desabilitada na ultima pagina', async () => {
    await carregar(muitos(45));
    await clicar('Próxima');
    await clicar('Próxima');
    expect(botao('Próxima')?.disabled).toBeTrue();
    expect(document.activeElement).toBe(contagem());
  });

  it('paginar nao faz nenhuma requisicao extra', async () => {
    await carregar(muitos(45));
    await clicar('Próxima');
    await trocarPorPagina(10);
    await clicar('Anterior');
    expect(ctrl.match(() => true).length).toBe(0);
  });

  it('a lista encolhe depois de uma nova carga: pagina corrigida sem erro', async () => {
    await carregar(muitos(45));
    await clicar('Próxima');
    await clicar('Próxima');
    expect(textoPagina()).toBe('Página 3 de 3');
    (fixture.componentInstance as PacientesPage).carregar();
    await passo();
    await carregar(muitos(25));
    expect(textoPagina()).toBe('Página 2 de 2');
    expect(nomes()).toEqual([
      'Paciente 021',
      'Paciente 022',
      'Paciente 023',
      'Paciente 024',
      'Paciente 025',
    ]);
  });

  it('com 500 pacientes: so 20 linhas no DOM e a nota de limite continua', async () => {
    await carregar(muitos(500));
    expect(el().querySelectorAll('tbody tr').length).toBe(20);
    expect(textoPagina()).toBe('Página 1 de 25');
    expect(el().querySelector('[role="note"]')?.textContent).toContain(
      'A lista mostra no máximo 500 pacientes',
    );
    await trocarPorPagina(30);
    expect(el().querySelectorAll('tbody tr').length).toBe(30);
    expect(textoPagina()).toBe('Página 1 de 17');
  });

  it('o numero da pagina e o tamanho nao vao para URL, console, storage nem history.state', async () => {
    const router = TestBed.inject(Router);
    const logs = [
      spyOn(console, 'log'),
      spyOn(console, 'info'),
      spyOn(console, 'warn'),
      spyOn(console, 'error'),
      spyOn(console, 'debug'),
    ];
    await carregar(muitos(45));
    await clicar('Próxima');
    await trocarPorPagina(10);
    await clicar('Próxima');
    expect(location.href).not.toContain('pagina');
    expect(router.url).not.toContain('Página');
    expect(JSON.stringify(history.state ?? null)).not.toContain('Página');
    expect(Object.keys(localStorage).join('')).not.toContain('pagina');
    expect(Object.keys(sessionStorage).join('')).not.toContain('pagina');
    for (const spy of logs) {
      expect(JSON.stringify(spy.calls.allArgs())).not.toContain('Página');
    }
  });
});
