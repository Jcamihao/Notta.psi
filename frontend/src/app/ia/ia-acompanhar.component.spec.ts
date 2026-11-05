import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IaAcompanharComponent } from './ia-acompanhar.component';
import { Geracao } from './ia.service';

const PID = '11111111-1111-4111-8111-111111111111';
const OID = '33333333-3333-4333-8333-333333333333';
const GID = '44444444-4444-4444-8444-444444444444';
const GID2 = '55555555-5555-4555-8555-555555555555';
const DOC = '66666666-6666-4666-8666-666666666666';
const URL_G = `/api/geracoes-ia/${GID}`;

const geracao = (parcial: Partial<Geracao> = {}): Geracao => ({
  id: GID,
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
const PRONTO = geracao({
  estado: 'PRONTO',
  documentoId: DOC,
  finalizadoEm: '2026-11-05T10:01:00.000Z',
});
const FALHOU = (motivo: string, retentavel: boolean) =>
  geracao({ estado: 'FALHOU', motivo, retentavel, finalizadoEm: '2026-11-05T10:01:00.000Z' });

// Zoneless: sem fakeAsync. O relogio e o do jasmine (so setTimeout) e a tela e atualizada com
// detectChanges explicito (o agendador do Angular tambem usa timers).
describe('IaAcompanharComponent', () => {
  let fixture: ComponentFixture<IaAcompanharComponent>;
  let ctrl: HttpTestingController;
  let trocou: string[];

  const montar = (id = GID) => {
    TestBed.configureTestingModule({
      imports: [IaAcompanharComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(IaAcompanharComponent);
    trocou = [];
    fixture.componentInstance.trocar.subscribe((i) => trocou.push(i));
    fixture.componentRef.setInput('pacienteId', PID);
    fixture.componentRef.setInput('geracaoId', id);
    fixture.detectChanges();
  };

  beforeEach(() => jasmine.clock().install());
  afterEach(() => {
    jasmine.clock().uninstall();
    ctrl.verify();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const texto = (sel: string) => el().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const flush = (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    fixture.detectChanges();
  };
  const passar = (ms: number) => {
    jasmine.clock().tick(ms);
    fixture.detectChanges();
  };
  const botao = (rotulo: string): HTMLElement | null =>
    Array.from(el().querySelectorAll<HTMLElement>('button, a')).find(
      (b) => b.textContent?.trim() === rotulo,
    ) ?? null;

  describe('polling', () => {
    it('consulta ao abrir e mostra "Gerando..." com o aviso de que pode fechar a tela', () => {
      montar();
      expect(texto('[data-teste="status"]')).toBe('Consultando o pedido…');
      const r = ctrl.expectOne(URL_G);
      expect(r.request.method).toBe('GET');
      flush(r, geracao());
      expect(texto('[data-teste="pendente"]')).toBe(
        'Gerando… pode fechar esta tela, o pedido fica salvo.',
      );
      expect(el().querySelector('[data-teste="status"]')?.getAttribute('aria-live')).toBe('polite');
    });

    it('PENDENTE: nova consulta a cada 3 s, nem antes', () => {
      montar();
      flush(ctrl.expectOne(URL_G), geracao());
      passar(2900);
      ctrl.expectNone(URL_G);
      passar(100);
      flush(ctrl.expectOne(URL_G), geracao());
      passar(3000);
      flush(ctrl.expectOne(URL_G), geracao());
    });

    it('nunca mais de uma consulta em voo: o proximo ciclo so conta depois da resposta', () => {
      montar();
      const lenta = ctrl.expectOne(URL_G);
      passar(10_000);
      ctrl.expectNone(URL_G);
      flush(lenta, geracao());
      passar(3000);
      flush(ctrl.expectOne(URL_G), geracao());
    });

    it('PRONTO: para de consultar', () => {
      montar();
      flush(ctrl.expectOne(URL_G), geracao());
      passar(3000);
      flush(ctrl.expectOne(URL_G), PRONTO);
      passar(30_000);
      ctrl.expectNone(URL_G);
    });

    it('FALHOU: para de consultar', () => {
      montar();
      flush(ctrl.expectOne(URL_G), FALHOU('TIMEOUT', true));
      passar(30_000);
      ctrl.expectNone(URL_G);
    });

    it('ao sair da pagina (destroy) nao consulta mais', () => {
      montar();
      flush(ctrl.expectOne(URL_G), geracao());
      fixture.destroy();
      jasmine.clock().tick(30_000);
      ctrl.expectNone(URL_G);
    });

    it('destroy com consulta em voo: a resposta tardia nao quebra nada', () => {
      montar();
      const r = ctrl.expectOne(URL_G);
      fixture.destroy();
      expect(r.cancelled).toBeTrue();
      jasmine.clock().tick(30_000);
      ctrl.expectNone(URL_G);
    });

    it('erro de rede: avisa, tenta de novo em 3 s e some o aviso quando volta', () => {
      montar();
      flush(ctrl.expectOne(URL_G), {}, 500);
      expect(texto('[data-teste="sem-rede"]')).toContain('Vou tentar de novo.');
      passar(3000);
      flush(ctrl.expectOne(URL_G), geracao());
      expect(el().querySelector('[data-teste="sem-rede"]')).toBeNull();
    });

    it('5 falhas seguidas: para e oferece Atualizar, que volta a consultar', () => {
      montar();
      for (let i = 0; i < 5; i++) {
        flush(ctrl.expectOne(URL_G), {}, 503);
        passar(3000);
      }
      ctrl.expectNone(URL_G);
      expect(texto('[data-teste="sem-rede"]')).not.toContain('Vou tentar de novo.');
      (botao('Atualizar') as HTMLElement).click();
      flush(ctrl.expectOne(URL_G), geracao());
      expect(botao('Atualizar')).toBeNull();
      expect(el().querySelector('[data-teste="pendente"]')).not.toBeNull();
    });

    it('404: "pedido nao encontrado" e nao insiste', () => {
      montar();
      flush(ctrl.expectOne(URL_G), { message: 'Geracao nao encontrada' }, 404);
      expect(texto('[data-teste="status"]')).toBe('Este pedido não foi encontrado.');
      passar(30_000);
      ctrl.expectNone(URL_G);
    });

    it('trocar o id (outro pedido em andamento) recomeca no novo, sem misturar respostas', () => {
      montar();
      const velha = ctrl.expectOne(URL_G);
      fixture.componentRef.setInput('geracaoId', GID2);
      fixture.detectChanges();
      flush(ctrl.expectOne(`/api/geracoes-ia/${GID2}`), geracao({ id: GID2 }));
      // A resposta atrasada do id antigo e ignorada.
      velha.flush(PRONTO);
      fixture.detectChanges();
      expect(el().querySelector('[data-teste="pendente"]')).not.toBeNull();
      expect(el().querySelector('[data-teste="pronto"]')).toBeNull();
    });
  });

  describe('PRONTO', () => {
    it('"Rascunho pronto" e botao que abre o documento criado', () => {
      montar();
      flush(ctrl.expectOne(URL_G), PRONTO);
      expect(texto('[data-teste="pronto"]')).toBe('Rascunho pronto');
      const a = botao('Abrir o rascunho') as HTMLAnchorElement;
      expect(a.getAttribute('href')).toBe(`/pacientes/${PID}/documentos/${DOC}`);
      expect(el().querySelector('[data-teste="avisos"]')).toBeNull();
    });

    it('avisos DADO_NOVO e CODIGO_DESCONHECIDO em linguagem simples', () => {
      montar();
      flush(ctrl.expectOne(URL_G), { ...PRONTO, avisos: ['DADO_NOVO', 'CODIGO_DESCONHECIDO'] });
      const itens = Array.from(el().querySelectorAll('[data-teste="avisos"] li')).map((l) =>
        l.textContent?.trim(),
      );
      expect(itens).toEqual([
        'A IA escreveu um CPF, telefone ou e-mail que não estava na sua nota. Confira e apague se não fizer sentido.',
        'O texto tem um código entre colchetes que o sistema não conseguiu trocar pelo dado original. Confira e corrija.',
      ]);
    });

    it('ao ficar PRONTO depois de gerando, o foco vai ao botao de abrir', () => {
      montar();
      flush(ctrl.expectOne(URL_G), geracao());
      passar(3000);
      flush(ctrl.expectOne(URL_G), PRONTO);
      fixture.detectChanges();
      expect(document.activeElement?.id).toBe('ia-abrir');
    });
  });

  describe('FALHOU', () => {
    const MOTIVOS: [string, string][] = [
      ['TIMEOUT', 'A IA demorou demais para responder.'],
      ['REDE', 'Não foi possível falar com a IA agora. Confira a conexão.'],
      ['LIMITE', 'A IA está com muitos pedidos neste momento.'],
      ['ERRO_DA_IA', 'A IA falhou ao montar o texto.'],
      ['RESPOSTA_INVALIDA', 'A IA devolveu uma resposta que o sistema não conseguiu usar.'],
      ['TEMPO_ESGOTADO', 'O pedido demorou mais do que o esperado e foi interrompido.'],
    ];
    for (const [motivo, frase] of MOTIVOS) {
      it(`${motivo}: frase propria, nota salva e Tentar de novo`, () => {
        montar();
        flush(ctrl.expectOne(URL_G), FALHOU(motivo, true));
        expect(texto('[data-teste="falhou"]')).toBe(`${frase} A sua nota continua salva.`);
        expect(botao('Tentar de novo')).not.toBeNull();
        expect(el().querySelector('[data-teste="sem-retentativa"]')).toBeNull();
      });
    }

    it('nao retentavel: explica que e falha de configuracao e NAO oferece o botao', () => {
      montar();
      flush(ctrl.expectOne(URL_G), FALHOU('CONFIG', false));
      expect(texto('[data-teste="falhou"]')).toContain('A sua nota continua salva.');
      expect(texto('[data-teste="sem-retentativa"]')).toBe(
        'Esta é uma falha de configuração do sistema, não do seu texto. Avise o suporte.',
      );
      expect(botao('Tentar de novo')).toBeNull();
    });

    it('Tentar de novo: POST confirmar, volta a "Gerando...", consulta de novo e chega a PRONTO', () => {
      montar();
      flush(ctrl.expectOne(URL_G), FALHOU('TIMEOUT', true));
      (botao('Tentar de novo') as HTMLElement).click();
      fixture.detectChanges();
      expect(botao('Enviando…')?.hasAttribute('disabled')).toBeTrue();
      const c = ctrl.expectOne(`${URL_G}/confirmar`);
      expect(c.request.method).toBe('POST');
      expect(c.request.body).toBeNull();
      flush(c, { id: GID, estado: 'PENDENTE' }, 202);
      expect(el().querySelector('[data-teste="pendente"]')).not.toBeNull();
      flush(ctrl.expectOne(URL_G), geracao());
      passar(3000);
      flush(ctrl.expectOne(URL_G), PRONTO);
      expect(texto('[data-teste="pronto"]')).toBe('Rascunho pronto');
    });

    it('sem limite de tentativas: falha, tenta, falha de novo, tenta de novo', () => {
      montar();
      for (let i = 0; i < 3; i++) {
        flush(ctrl.expectOne(URL_G), FALHOU('REDE', true));
        (botao('Tentar de novo') as HTMLElement).click();
        flush(ctrl.expectOne(`${URL_G}/confirmar`), { id: GID, estado: 'PENDENTE' }, 202);
      }
      flush(ctrl.expectOne(URL_G), FALHOU('REDE', true));
      expect(botao('Tentar de novo')).not.toBeNull();
    });

    it('duplo clique em Tentar de novo: um POST so', () => {
      montar();
      flush(ctrl.expectOne(URL_G), FALHOU('TIMEOUT', true));
      const b = botao('Tentar de novo') as HTMLElement;
      b.click();
      b.click();
      flush(ctrl.expectOne(`${URL_G}/confirmar`), { id: GID, estado: 'PENDENTE' }, 202);
      flush(ctrl.expectOne(URL_G), geracao());
    });

    it('retentativa com 429 do limite diario: mostra a hora (do corpo) e mantem o botao', () => {
      montar();
      flush(ctrl.expectOne(URL_G), FALHOU('TIMEOUT', true));
      (botao('Tentar de novo') as HTMLElement).click();
      flush(
        ctrl.expectOne(`${URL_G}/confirmar`),
        { mensagem: 'x', limite: 20, usadas: 20, renovaEm: '2026-11-06T03:00:00.000Z' },
        429,
      );
      expect(texto('[data-teste="erro-envio"]')).toMatch(
        /^Limite diário de gerações atingido; renova em 06\/11\/2026, \d{2}:\d{2}\.$/,
      );
      expect(botao('Tentar de novo')).not.toBeNull();
      expect(el().querySelector('[data-teste="falhou"]')).not.toBeNull();
    });

    it('retentativa com 429 "ja ha uma geracao em andamento": acha a pendente e troca para ela', () => {
      montar();
      flush(ctrl.expectOne(URL_G), FALHOU('TIMEOUT', true));
      (botao('Tentar de novo') as HTMLElement).click();
      flush(
        ctrl.expectOne(`${URL_G}/confirmar`),
        { message: 'Ja ha uma geracao em andamento' },
        429,
      );
      flush(ctrl.expectOne(`/api/pacientes/${PID}/geracoes-ia`), [
        FALHOU('TIMEOUT', true),
        geracao({ id: GID2 }),
      ]);
      expect(trocou).toEqual([GID2]);
    });

    it('429 de andamento sem pendente neste paciente: explica que e em outra nota', () => {
      montar();
      flush(ctrl.expectOne(URL_G), FALHOU('TIMEOUT', true));
      (botao('Tentar de novo') as HTMLElement).click();
      flush(
        ctrl.expectOne(`${URL_G}/confirmar`),
        { message: 'Ja ha uma geracao em andamento' },
        429,
      );
      flush(ctrl.expectOne(`/api/pacientes/${PID}/geracoes-ia`), [FALHOU('TIMEOUT', true)]);
      expect(trocou).toEqual([]);
      expect(texto('[data-teste="erro-envio"]')).toContain('em outra nota');
    });

    it('409 de falha de configuracao ao tentar de novo: mensagem de suporte', () => {
      montar();
      flush(ctrl.expectOne(URL_G), FALHOU('TIMEOUT', true));
      (botao('Tentar de novo') as HTMLElement).click();
      flush(
        ctrl.expectOne(`${URL_G}/confirmar`),
        { message: 'Falha de configuracao da IA, avise o suporte' },
        409,
      );
      expect(texto('[data-teste="erro-envio"]')).toContain('Avise o suporte');
    });

    it('erro de rede ao tentar de novo: mensagem geral e o botao volta', () => {
      montar();
      flush(ctrl.expectOne(URL_G), FALHOU('TIMEOUT', true));
      (botao('Tentar de novo') as HTMLElement).click();
      flush(ctrl.expectOne(`${URL_G}/confirmar`), {}, 500);
      expect(texto('[data-teste="erro-envio"]')).toContain('Confira sua conexão');
      expect(botao('Tentar de novo')?.hasAttribute('disabled')).toBeFalse();
    });
  });

  it('pedido ainda em previa: diz que nao foi enviado', () => {
    montar();
    flush(ctrl.expectOne(URL_G), geracao({ estado: 'PREVIA' }));
    expect(texto('[data-teste="nao-enviado"]')).toBe(
      'Este pedido ainda não foi enviado para a IA.',
    );
    passar(30_000);
    ctrl.expectNone(URL_G);
  });
});
