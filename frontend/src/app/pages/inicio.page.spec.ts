import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { dataHoraBr } from '../core/datas';
import { Eu, SessaoStore } from '../core/sessao.store';
import { Paciente } from '../pacientes/pacientes.service';
import { InicioPage } from './inicio.page';

const EU: Eu = {
  psicologoId: 'p1',
  nome: 'Dra. Helena Prado',
  email: 'helena@clinica.com',
  papel: 'PSICOLOGO',
  abordagemPadrao: 'SISTEMICA',
  clinica: { id: 'c1', nome: 'Clínica Horizonte' },
  senhaProvisoria: false,
};

const paciente = (
  id: string,
  nome: string,
  criadoEm: string,
  consentimento?: Paciente['consentimento'],
): Paciente => ({
  id,
  nome,
  nascimento: null,
  telefone: null,
  email: null,
  criadoEm,
  consentimento,
});

// Sete pacientes, fora de ordem na lista. Sem consentimento: Carla (REVOGADO) e Davi (NENHUM).
// Os dois mais antigos (Ana e Bruno) ficam fora dos 5 recentes.
const LISTA: Paciente[] = [
  paciente('p4', 'Davi Reis', '2026-10-04T10:00:00.000Z', 'NENHUM'),
  paciente('p7', 'Gabi Nunes', '2026-10-07T10:00:00.000Z', 'CONCEDIDO'),
  paciente('p1', 'Ana Lima', '2026-10-01T10:00:00.000Z', 'CONCEDIDO'),
  paciente('p3', 'Carla Dias', '2026-10-03T10:00:00.000Z', 'REVOGADO'),
  paciente('p6', 'Fábio Rocha', '2026-10-06T10:00:00.000Z', 'CONCEDIDO'),
  paciente('p2', 'Bruno Alves', '2026-10-02T10:00:00.000Z', 'CONCEDIDO'),
  paciente('p5', 'Elisa Moura', '2026-10-05T10:00:00.000Z', 'CONCEDIDO'),
];

describe('InicioPage', () => {
  let fixture: ComponentFixture<InicioPage>;
  let ctrl: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const texto = () => el().textContent ?? '';

  // Responde a unica chamada pendente de GET /api/pacientes e espera a tela assentar.
  const responde = async (lista: Paciente[]) => {
    ctrl.expectOne('/api/pacientes').flush(lista);
    await fixture.whenStable();
  };
  const recentes = () => Array.from(el().querySelectorAll<HTMLElement>('[data-teste="recente"]'));

  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    // Espiona o console antes de criar a tela: se algo logar nome de paciente, o teste acusa.
    spyOn(console, 'log');
    spyOn(console, 'info');
    spyOn(console, 'warn');
    spyOn(console, 'error');
    spyOn(console, 'debug');
    spyOn(window, 'setInterval').and.callThrough();

    TestBed.configureTestingModule({
      imports: [InicioPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(SessaoStore).entrar(EU);
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InicioPage);
    await fixture.whenStable();
  });
  afterEach(() => ctrl.verify());

  it('saudacao com o nome do psicologo (como vem, com titulo) e o nome da clinica', async () => {
    await responde(LISTA);
    const h1 = el().querySelectorAll('h1');
    expect(h1.length).toBe(1);
    expect(h1[0].textContent?.trim()).toBe('Olá, Dra. Helena Prado');
    expect(texto()).toContain('Clínica Horizonte');
  });

  it('faz uma unica requisicao GET /api/pacientes e nao repete nem faz polling', async () => {
    await responde(LISTA);
    expect(window.setInterval).not.toHaveBeenCalled();
    // verify() no afterEach acusa qualquer requisicao extra pendente.
  });

  it('resumo: total e pacientes sem consentimento (NENHUM e REVOGADO contam; CONCEDIDO nao)', async () => {
    await responde(LISTA);
    const resumo = el().querySelector('[data-teste="resumo"]')?.textContent ?? '';
    expect(resumo).toContain('7 pacientes cadastrados');
    expect(resumo).toContain('2 pacientes sem consentimento concedido');
    expect(resumo).toContain(
      'Sem consentimento concedido não é possível criar documentos nem usar a IA.',
    );
    const linkLista = el().querySelector<HTMLAnchorElement>('[data-teste="resumo"] a');
    expect(linkLista?.getAttribute('href')).toBe('/pacientes');
  });

  it('resumo singular quando ha um paciente sem consentimento', async () => {
    await responde([paciente('a', 'Ana Lima', '2026-10-01T10:00:00.000Z', 'REVOGADO')]);
    expect(texto()).toContain('1 paciente cadastrado');
    expect(texto()).toContain('1 paciente sem consentimento concedido');
  });

  it('paciente sem o campo consentimento conta como NENHUM (sem consentimento)', async () => {
    await responde([paciente('a', 'Ana Lima', '2026-10-01T10:00:00.000Z')]);
    expect(texto()).toContain('1 paciente sem consentimento concedido');
  });

  it('mensagem positiva quando todos tem consentimento concedido', async () => {
    const todos = LISTA.filter((p) => p.consentimento === 'CONCEDIDO');
    await responde(todos);
    expect(texto()).toContain('Todos os pacientes têm consentimento concedido.');
    expect(texto()).not.toContain('sem consentimento concedido');
    expect(texto()).not.toContain('Sem consentimento concedido não é possível');
  });

  it('atalhos para novo paciente e para a lista', async () => {
    await responde(LISTA);
    const atalhos = el().querySelector('[aria-labelledby="titulo-atalhos"]') as HTMLElement;
    const novo = atalhos.querySelector<HTMLAnchorElement>('a[href="/pacientes/novo"]');
    const ver = atalhos.querySelector<HTMLAnchorElement>('a[href="/pacientes"]');
    expect(novo?.textContent?.trim()).toBe('Novo paciente');
    expect(ver?.textContent?.trim()).toBe('Ver pacientes');
  });

  it('mostra so os 5 cadastros mais recentes, em ordem decrescente, sem os 2 mais antigos', async () => {
    await responde(LISTA);
    const nomes = recentes().map((li) => li.querySelector('a')?.textContent?.trim());
    expect(nomes).toEqual(['Gabi Nunes', 'Fábio Rocha', 'Elisa Moura', 'Davi Reis', 'Carla Dias']);
    expect(texto()).not.toContain('Ana Lima');
    expect(texto()).not.toContain('Bruno Alves');
  });

  it('empate de data mantem a ordem que a API mandou', async () => {
    await responde([
      paciente('a', 'Ana Lima', '2026-10-01T10:00:00.000Z', 'CONCEDIDO'),
      paciente('b', 'Bruno Alves', '2026-10-05T10:00:00.000Z', 'CONCEDIDO'),
      paciente('c', 'Carla Dias', '2026-10-05T10:00:00.000Z', 'CONCEDIDO'),
      paciente('d', 'Davi Reis', '2026-10-03T10:00:00.000Z', 'CONCEDIDO'),
      paciente('e', 'Elisa Moura', '2026-10-02T10:00:00.000Z', 'CONCEDIDO'),
      paciente('f', 'Fábio Rocha', '2026-09-01T10:00:00.000Z', 'CONCEDIDO'),
    ]);
    const nomes = recentes().map((li) => li.querySelector('a')?.textContent?.trim());
    expect(nomes).toEqual(['Bruno Alves', 'Carla Dias', 'Davi Reis', 'Elisa Moura', 'Ana Lima']);
  });

  it('cada item e um link para /pacientes/:id, com a data de cadastro', async () => {
    await responde(LISTA);
    const links = recentes().map((li) => li.querySelector('a')?.getAttribute('href'));
    expect(links).toEqual([
      '/pacientes/p7',
      '/pacientes/p6',
      '/pacientes/p5',
      '/pacientes/p4',
      '/pacientes/p3',
    ]);
    expect(recentes()[0].textContent).toContain(dataHoraBr('2026-10-07T10:00:00.000Z'));
  });

  it('pilula de consentimento certa para cada estado', async () => {
    await responde(LISTA);
    const pilula = (nome: string) => {
      const li = recentes().find((x) => x.textContent?.includes(nome));
      return li?.querySelector('app-pill') as HTMLElement;
    };
    expect(pilula('Gabi Nunes').getAttribute('data-tone')).toBe('blue');
    expect(pilula('Gabi Nunes').textContent?.trim()).toBe('Concedido');
    expect(pilula('Carla Dias').getAttribute('data-tone')).toBe('pink');
    expect(pilula('Carla Dias').textContent?.trim()).toBe('Revogado');
    expect(pilula('Davi Reis').getAttribute('data-tone')).toBe('yellow');
    expect(pilula('Davi Reis').textContent?.trim()).toBe('Não registrado');
    expect(pilula('Davi Reis').classList.contains('dashed')).toBeTrue();
  });

  it('rotulo honesto: sao os ultimos cadastrados, nao os ultimos atendidos', async () => {
    await responde(LISTA);
    expect(texto()).toContain('Últimos pacientes cadastrados');
    expect(texto()).toContain('não os últimos atendidos');
  });

  it('estado vazio: passo a passo e botao para cadastrar, sem resumo nem recentes', async () => {
    await responde([]);
    const passos = Array.from(el().querySelectorAll('ol li')).map((li) => li.textContent?.trim());
    expect(passos).toEqual([
      'Cadastre um paciente.',
      'Registre o consentimento (ou envie o termo por link).',
      'Escreva a nota da sessão como rascunho e aprove quando estiver pronta.',
    ]);
    const botao = el().querySelector<HTMLAnchorElement>('a[href="/pacientes/novo"][data-variant]');
    expect(botao?.textContent?.trim()).toBe('Cadastrar primeiro paciente');
    expect(el().querySelector('[data-teste="resumo"]')).toBeNull();
    expect(el().querySelector('[data-teste="recentes"]')).toBeNull();
    expect(texto()).not.toContain('sem consentimento');
  });

  it('carregando: role status com texto, sem resumo e sem recentes', () => {
    expect(el().querySelector('[role="status"]')?.textContent).toContain(
      'Carregando seus pacientes…',
    );
    expect(el().querySelector('[data-teste="resumo"]')).toBeNull();
    // Carregando tambem nao deixa a tela em branco: os atalhos seguem na tela.
    expect(el().querySelector('a[href="/pacientes/novo"]')).not.toBeNull();
    ctrl.expectOne('/api/pacientes').flush([]);
  });

  it('erro: role alert com texto e botao Tentar de novo, que refaz a chamada', async () => {
    ctrl
      .expectOne('/api/pacientes')
      .flush(
        { erro: 'segredo-do-servidor', nome: 'Ana Lima' },
        { status: 500, statusText: 'Erro' },
      );
    await fixture.whenStable();
    const alerta = el().querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain(
      'Não foi possível carregar seus pacientes. Confira sua conexão.',
    );
    // O corpo do erro nunca vai para a tela.
    expect(texto()).not.toContain('segredo-do-servidor');
    expect(texto()).not.toContain('Ana Lima');

    const botao = Array.from(el().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Tentar de novo',
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    botao.click();
    await fixture.whenStable();
    await responde(LISTA);
    expect(recentes().length).toBe(5);
    expect(el().querySelector('[role="alert"]')).toBeNull();
  });

  it('nenhum nome de paciente em console, storage, history.state ou URL', async () => {
    await responde(LISTA);

    const logs = JSON.stringify([
      ...(console.log as jasmine.Spy).calls.allArgs(),
      ...(console.info as jasmine.Spy).calls.allArgs(),
      ...(console.warn as jasmine.Spy).calls.allArgs(),
      ...(console.error as jasmine.Spy).calls.allArgs(),
      ...(console.debug as jasmine.Spy).calls.allArgs(),
    ]);
    const storage = JSON.stringify({ ...localStorage, ...sessionStorage });
    const estado = JSON.stringify(history.state) + location.href;
    for (const nome of ['Ana Lima', 'Gabi Nunes', 'Carla Dias', 'Davi Reis']) {
      expect(logs).not.toContain(nome);
      expect(storage).not.toContain(nome);
      expect(estado).not.toContain(nome);
    }
  });

  it('lista com 500 pacientes nao quebra e mostra so os 5 recentes', async () => {
    const grande: Paciente[] = Array.from({ length: 500 }, (_, i) =>
      paciente(
        `id${i}`,
        `Paciente ${i}`,
        new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
        i % 3 === 0 ? 'NENHUM' : 'CONCEDIDO',
      ),
    );
    await responde(grande);
    expect(texto()).toContain('500 pacientes cadastrados');
    expect(recentes().length).toBe(5);
    expect(recentes()[0].querySelector('a')?.textContent?.trim()).toBe('Paciente 499');
  });
});
