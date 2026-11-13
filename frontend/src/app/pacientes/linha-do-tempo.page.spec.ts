import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { DocumentoResumo } from '../documentos/documentos.service';
import { Consentimento } from './consentimento.service';
import { Convite } from './convite-consentimento.service';
import { LinhaDoTempoPage } from './linha-do-tempo.page';
import { Paciente } from './pacientes.service';

const PID = '11111111-1111-4111-8111-111111111111';
const BASE = `/api/pacientes/${PID}`;
const NOME = 'Maria da Silva';
const SIGILO = 'TEXTO CLINICO SIGILOSO';
const FRASE_ERRO = 'Não foi possível carregar a linha do tempo. Confira sua conexão.';

const local = (ano: number, mes: number, dia: number, hora = 12) =>
  new Date(ano, mes - 1, dia, hora).toISOString();

const PACIENTE: Paciente = {
  id: PID,
  nome: NOME,
  nascimento: null,
  telefone: null,
  email: null,
  criadoEm: local(2026, 10, 1, 9),
};

const CONSENTIMENTO: Consentimento = {
  estado: 'CONCEDIDO',
  desde: local(2026, 10, 5),
  historico: [
    {
      seq: 1,
      evento: 'CONCEDIDO',
      termoVersao: 'v1-rascunho',
      origem: 'PSICOLOGO',
      em: local(2026, 10, 5, 10),
    },
  ],
};

const CONVITE: Convite = {
  id: 'c1',
  estado: 'ACEITO',
  expirado: false,
  criadoEm: local(2026, 10, 20),
  expiraEm: local(2026, 10, 27),
  usadoEm: local(2026, 10, 21),
  termoVersao: 'v1-rascunho',
};

// Documento com texto clinico: a lista nunca traz conteudo, e a tela nao pode mostrar o campo.
const APROVADO = {
  id: 'a1',
  tipo: 'EVOLUCAO',
  dataSessao: '2026-11-02',
  status: 'APROVADO',
  criadoEm: local(2026, 11, 2, 9),
  aprovadoEm: local(2026, 11, 4, 10),
  substituiId: null,
  geradoPorIa: true,
  descarteEm: null,
  conteudo: SIGILO,
} as unknown as DocumentoResumo;

const RASCUNHO = {
  id: 'r1',
  tipo: 'ANAMNESE',
  dataSessao: null,
  status: 'RASCUNHO',
  criadoEm: local(2026, 11, 6, 8),
  aprovadoEm: null,
  substituiId: null,
  geradoPorIa: false,
  descarteEm: null,
  conteudo: SIGILO,
} as unknown as DocumentoResumo;

const DADOS = {
  paciente: PACIENTE,
  consentimento: CONSENTIMENTO,
  convites: [CONVITE],
  aprovados: [APROVADO],
  rascunhos: [RASCUNHO],
};

const pausa = () => new Promise<void>((r) => setTimeout(r, 0));

describe('LinhaDoTempoPage', () => {
  let fixture: ComponentFixture<LinhaDoTempoPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const montar = () => {
    params = new BehaviorSubject(convertToParamMap({ id: PID }));
    TestBed.configureTestingModule({
      imports: [LinhaDoTempoPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(LinhaDoTempoPage);
  };

  // As 5 leituras, uma depois da outra, na ordem do servico.
  const atender = async (dados: typeof DADOS = DADOS) => {
    ctrl.expectOne(BASE).flush(dados.paciente);
    await pausa();
    ctrl.expectOne(`${BASE}/consentimento`).flush(dados.consentimento);
    await pausa();
    ctrl.expectOne(`${BASE}/convites-consentimento`).flush(dados.convites);
    await pausa();
    ctrl.expectOne(`${BASE}/documentos?status=APROVADO`).flush(dados.aprovados);
    await pausa();
    ctrl.expectOne(`${BASE}/documentos?status=RASCUNHO`).flush(dados.rascunhos);
    await pausa();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const itens = () => Array.from(el().querySelectorAll('li'));
  const botao = (texto: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent!.trim() === texto)!;
  const clicar = (texto: string) => {
    botao(texto).click();
    fixture.detectChanges();
  };

  afterEach(() => ctrl?.verify());

  describe('carregamento e lista', () => {
    beforeEach(() => montar());

    it('mostra "carregando" enquanto as leituras correm', () => {
      fixture.detectChanges();
      const status = el().querySelector('[role="status"]')!;
      expect(status.textContent).toContain('Carregando a linha do tempo…');
      // Sem resposta: a primeira leitura fica pendente; o teste so olha o estado de carregamento.
      ctrl.match(() => true);
    });

    it('depois de carregar: um so h1, nome so no cabecalho, ol/li/time e mes em h2', async () => {
      fixture.detectChanges();
      await atender();

      expect(el().querySelectorAll('h1').length).toBe(1);
      expect(el().querySelector('h1')!.textContent).toContain('Linha do tempo');
      expect(el().textContent!.split(NOME).length - 1).toBe(1);
      expect(el().querySelector('[data-teste="paciente"]')!.textContent).toContain(
        `Paciente: ${NOME}`,
      );
      expect(el().querySelectorAll('ol').length).toBeGreaterThan(0);
      expect(el().querySelector('ol > li time[datetime]')).not.toBeNull();
      const meses = Array.from(el().querySelectorAll('section h2')).map((h) => h.textContent);
      expect(meses).toEqual(['novembro de 2026', 'outubro de 2026']);
    });

    it('ordena do mais recente ao mais antigo, com titulos corretos', async () => {
      fixture.detectChanges();
      await atender();
      const titulos = itens().map((li) => li.querySelector('.linha-titulo')!.textContent!.trim());
      expect(titulos).toEqual([
        'Rascunho de anamnese',
        'Evolução aprovada',
        'Termo enviado por link',
        'Consentimento concedido',
        'Paciente cadastrado',
      ]);
    });

    it('so o primeiro item (o mais recente) leva o marcador azul; marcador e decorativo', async () => {
      fixture.detectChanges();
      await atender();
      const lis = itens();
      expect(lis[0].classList.contains('atual')).toBeTrue();
      expect(lis.slice(1).some((li) => li.classList.contains('atual'))).toBeFalse();
      const marcadores = Array.from(el().querySelectorAll('.linha-marcador'));
      expect(marcadores.length).toBe(lis.length);
      expect(marcadores.every((m) => m.getAttribute('aria-hidden') === 'true')).toBeTrue();
    });

    it('documento aprovado: link para o id certo, pilula Aprovado e pilula IA', async () => {
      fixture.detectChanges();
      await atender();
      const link = el().querySelector(`a[href="/pacientes/${PID}/documentos/a1"]`)!;
      expect(link).not.toBeNull();
      expect(link.textContent).toContain('Evolução aprovada');
      const li = link.closest('li')!;
      expect(li.textContent).toContain('Sessão de 02/11/2026');
      expect(li.textContent).toContain('Aprovado');
      expect(li.querySelector('app-pill[data-tone="pink"]')!.textContent).toContain('IA');
    });

    it('rascunho: link para o id certo e pilula Rascunho, sem IA', async () => {
      fixture.detectChanges();
      await atender();
      const link = el().querySelector(`a[href="/pacientes/${PID}/documentos/r1"]`)!;
      expect(link.closest('li')!.textContent).toContain('Rascunho');
      expect(link.closest('li')!.textContent).not.toContain('IA');
    });

    it('o link "Voltar ao paciente" aponta para a ficha', async () => {
      fixture.detectChanges();
      await atender();
      expect(el().querySelector(`a[href="/pacientes/${PID}"]`)!.textContent).toContain(
        'Voltar ao paciente',
      );
    });

    it('nenhum texto de documento aparece na pagina', async () => {
      fixture.detectChanges();
      await atender();
      expect(el().textContent).not.toContain(SIGILO);
      expect(el().innerHTML).not.toContain(SIGILO);
    });
  });

  describe('filtro', () => {
    beforeEach(() => montar());

    it('grupo "Filtrar eventos" com Tudo, Documentos e Consentimento; Tudo vem marcado', async () => {
      fixture.detectChanges();
      await atender();
      const grupo = el().querySelector('[role="group"][aria-label="Filtrar eventos"]')!;
      expect(grupo).not.toBeNull();
      const botoes = Array.from(grupo.querySelectorAll('button'));
      expect(botoes.map((b) => b.textContent!.trim())).toEqual([
        'Tudo',
        'Documentos',
        'Consentimento',
      ]);
      expect(botao('Tudo').getAttribute('aria-pressed')).toBe('true');
      expect(botao('Documentos').getAttribute('aria-pressed')).toBe('false');
      expect(botao('Consentimento').getAttribute('aria-pressed')).toBe('false');
    });

    it('Documentos mostra so documentos; Consentimento mostra consentimento e termo', async () => {
      fixture.detectChanges();
      await atender();

      clicar('Documentos');
      expect(botao('Documentos').getAttribute('aria-pressed')).toBe('true');
      expect(botao('Tudo').getAttribute('aria-pressed')).toBe('false');
      expect(itens().map((li) => li.querySelector('.linha-titulo')!.textContent!.trim())).toEqual([
        'Rascunho de anamnese',
        'Evolução aprovada',
      ]);

      clicar('Consentimento');
      expect(itens().map((li) => li.querySelector('.linha-titulo')!.textContent!.trim())).toEqual([
        'Termo enviado por link',
        'Consentimento concedido',
      ]);

      clicar('Tudo');
      expect(itens().length).toBe(5);
    });

    it('o primeiro item visivel do filtro leva o marcador azul', async () => {
      fixture.detectChanges();
      await atender();
      clicar('Consentimento');
      const lis = itens();
      expect(lis[0].classList.contains('atual')).toBeTrue();
      expect(lis[1].classList.contains('atual')).toBeFalse();
    });

    it('vazio por filtro: "Nenhum registro neste filtro."', async () => {
      fixture.detectChanges();
      await atender({ ...DADOS, aprovados: [], rascunhos: [], convites: [] });
      clicar('Documentos');
      // Sem documentos, o filtro Documentos fica vazio (o cadastro e o consentimento continuam).
      expect(el().textContent).toContain('Nenhum registro neste filtro.');
      expect(itens().length).toBe(0);
    });

    it('nao guarda o filtro em URL, storage nem history.state', async () => {
      const storage = spyOn(Storage.prototype, 'setItem').and.callThrough();
      const push = spyOn(history, 'pushState').and.callThrough();
      const replace = spyOn(history, 'replaceState').and.callThrough();
      fixture.detectChanges();
      await atender();
      clicar('Documentos');
      clicar('Consentimento');
      expect(storage).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe('vazios e erros', () => {
    beforeEach(() => montar());

    it('vazio total: "Ainda não há registros para este paciente."', async () => {
      fixture.detectChanges();
      await atender();
      fixture.componentInstance.eventos.set([]);
      fixture.detectChanges();
      expect(el().textContent).toContain('Ainda não há registros para este paciente.');
      expect(el().querySelector('[role="group"]')).not.toBeNull();
    });

    it('falha em qualquer leitura: alerta com texto fixo e sem corpo do erro', async () => {
      fixture.detectChanges();
      ctrl.expectOne(BASE).flush(PACIENTE);
      await pausa();
      ctrl.expectOne(`${BASE}/consentimento`).flush(CONSENTIMENTO);
      await pausa();
      ctrl
        .expectOne(`${BASE}/convites-consentimento`)
        .flush({ mensagem: 'SEGREDO DO SERVIDOR' }, { status: 500, statusText: 'Erro' });
      await pausa();
      await fixture.whenStable();
      fixture.detectChanges();

      const alerta = el().querySelector('[role="alert"]')!;
      expect(alerta.textContent).toContain(FRASE_ERRO);
      expect(el().textContent).not.toContain('SEGREDO DO SERVIDOR');
      expect(el().textContent).not.toContain(NOME);
      expect(el().querySelector('li')).toBeNull();
    });

    it('"Tentar de novo" refaz as 5 leituras, em sequencia', async () => {
      fixture.detectChanges();
      ctrl.expectOne(BASE).flush(null, { status: 503, statusText: 'x' });
      await pausa();
      await fixture.whenStable();
      fixture.detectChanges();

      clicar('Tentar de novo');
      await atender();
      expect(el().querySelector('[role="alert"]')).toBeNull();
      expect(itens().length).toBe(5);
    });

    it('404 do paciente: volta para /pacientes com o aviso, sem mostrar nada', async () => {
      fixture.detectChanges();
      ctrl.expectOne(BASE).flush(null, { status: 404, statusText: 'x' });
      await pausa();
      await fixture.whenStable();
      expect(navegar).toHaveBeenCalledOnceWith('/pacientes', {
        state: { aviso: 'nao-encontrado-exclusao' },
      });
      expect(el().textContent).not.toContain(NOME);
    });

    it('a pagina nunca le nem mostra o corpo de erro', async () => {
      fixture.detectChanges();
      ctrl
        .expectOne(BASE)
        .flush({ mensagem: 'corpo sigiloso' }, { status: 500, statusText: 'Erro' });
      await pausa();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().textContent).not.toContain('corpo sigiloso');
    });
  });

  describe('troca de paciente na mesma rota', () => {
    beforeEach(() => montar());

    it('reage ao novo id: some o paciente antigo e carrega o novo, sem usar resposta antiga', async () => {
      const OUTRO = '22222222-2222-4222-8222-222222222222';
      fixture.detectChanges();
      await atender();
      expect(el().textContent).toContain(NOME);

      params.next(convertToParamMap({ id: OUTRO }));
      fixture.detectChanges();
      expect(el().textContent).not.toContain(NOME);
      expect(el().querySelector('li')).toBeNull();
      ctrl.expectOne(`/api/pacientes/${OUTRO}`).flush({ ...PACIENTE, id: OUTRO, nome: 'Outro' });
      await pausa();
      ctrl
        .expectOne(`/api/pacientes/${OUTRO}/consentimento`)
        .flush({ ...CONSENTIMENTO, historico: [] });
      await pausa();
      ctrl.expectOne(`/api/pacientes/${OUTRO}/convites-consentimento`).flush([]);
      await pausa();
      ctrl.expectOne(`/api/pacientes/${OUTRO}/documentos?status=APROVADO`).flush([]);
      await pausa();
      ctrl.expectOne(`/api/pacientes/${OUTRO}/documentos?status=RASCUNHO`).flush([]);
      await pausa();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().textContent).toContain('Outro');
      expect(el().querySelector('.linha-voltar')!.getAttribute('href')).toBe(`/pacientes/${OUTRO}`);
    });
  });

  describe('sigilo', () => {
    beforeEach(() => montar());

    it('nada vai para console (nem o nome, nem o texto)', async () => {
      const metodos = ['log', 'info', 'warn', 'error', 'debug'] as const;
      const espias = metodos.map((m) => spyOn(console, m));
      fixture.detectChanges();
      await atender();
      clicar('Documentos');
      for (const espia of espias) expect(espia).not.toHaveBeenCalled();
    });

    it('nada vai para localStorage nem sessionStorage', async () => {
      const storage = spyOn(Storage.prototype, 'setItem').and.callThrough();
      fixture.detectChanges();
      await atender();
      expect(storage).not.toHaveBeenCalled();
    });
  });
});
