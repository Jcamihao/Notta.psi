import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { IaGerarPage } from './ia-gerar.page';

const PID = '11111111-1111-4111-8111-111111111111';
const DID = '22222222-2222-4222-8222-222222222222';
const GID = '44444444-4444-4444-8444-444444444444';
const GID2 = '55555555-5555-4555-8555-555555555555';
const URL_PREVIA = `/api/pacientes/${PID}/documentos/${DID}/previa-ia`;
const TEXTO =
  '[PACIENTE], CPF [CPF], tel [TELEFONE], falou de [TERMO_1] em [DATA].\nLinha 2 <b>x</b>';

const previa = (id = GID, textoAnonimizado = TEXTO) => ({
  id,
  estado: 'PREVIA',
  tipoDocumento: 'EVOLUCAO',
  textoAnonimizado,
  expiraEm: '2026-11-05T10:30:00.000Z',
});

describe('IaGerarPage', () => {
  let fixture: ComponentFixture<IaGerarPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  const montar = async (query: Record<string, string> = {}) => {
    TestBed.configureTestingModule({
      imports: [IaGerarPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: PID, docId: DID }),
              queryParamMap: convertToParamMap(query),
            },
          },
        },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(IaGerarPage);
    await fixture.whenStable();
  };
  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const texto = (sel: string) => el().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const flush = async (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    await fixture.whenStable();
  };
  const botao = (rotulo: string): HTMLElement | null =>
    Array.from(el().querySelectorAll<HTMLElement>('button, a')).find(
      (b) => b.textContent?.trim() === rotulo,
    ) ?? null;
  const clicar = async (rotulo: string) => {
    botao(rotulo)!.click();
    await fixture.whenStable();
  };
  const digitarTermo = async (valor: string, botaoRotulo: string) => {
    const c = el().querySelector('#ia-termo') as HTMLInputElement;
    c.value = valor;
    await clicar(botaoRotulo);
  };
  const verPrevia = async (corpo: object = previa()) => {
    await clicar('Ver prévia');
    await flush(ctrl.expectOne(URL_PREVIA), corpo, 201);
  };

  describe('passo 1', () => {
    it('nenhuma chamada ao abrir; Evolucao ja marcada; sem corretor no campo de termos', async () => {
      await montar();
      ctrl.expectNone(() => true);
      expect(texto('h1')).toBe('Gerar com IA');
      const radios = Array.from(el().querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      expect(radios.map((r) => [r.value, r.checked])).toEqual([
        ['EVOLUCAO', true],
        ['ANAMNESE', false],
      ]);
      expect(el().querySelector('#ia-termo')?.getAttribute('spellcheck')).toBe('false');
    });

    it('termos: adiciona e remove da lista sem chamar a API', async () => {
      await montar();
      await digitarTermo('Joana', 'Adicionar à lista');
      await digitarTermo('Escola Sol', 'Adicionar à lista');
      expect(texto('[data-teste="termos"]')).toContain('Joana');
      (el().querySelector('[aria-label="Remover o termo Joana"]') as HTMLElement).click();
      await fixture.whenStable();
      expect(texto('[data-teste="termos"]')).not.toContain('Joana');
      expect(texto('[data-teste="termos"]')).toContain('Escola Sol');
      ctrl.expectNone(() => true);
    });

    it('Ver prévia manda tipo e termos, e so isso', async () => {
      await montar();
      (el().querySelector('input[value="ANAMNESE"]') as HTMLElement).click();
      await digitarTermo('Joana', 'Adicionar à lista');
      await clicar('Ver prévia');
      const r = ctrl.expectOne(URL_PREVIA);
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toEqual({ tipoDocumento: 'ANAMNESE', termosExtras: ['Joana'] });
      expect(botao('Gerando a prévia…')?.hasAttribute('disabled')).toBeTrue();
      await flush(r, previa(), 201);
    });

    it('duplo clique em Ver prévia dispara uma chamada so', async () => {
      await montar();
      const b = botao('Ver prévia')!;
      b.click();
      b.click();
      await fixture.whenStable();
      await flush(ctrl.expectOne(URL_PREVIA), previa(), 201);
    });
  });

  describe('passo 2: prévia', () => {
    it('mostra o texto anonimizado EXATO, com codigos destacados em elementos proprios', async () => {
      await montar();
      await verPrevia();
      const p = el().querySelector('[data-teste="previa"]') as HTMLElement;
      expect(p.textContent?.trim()).toBe(TEXTO);
      const codigos = Array.from(p.querySelectorAll('.ia-codigo')).map((c) => c.textContent);
      expect(codigos).toEqual(['[PACIENTE]', '[CPF]', '[TELEFONE]', '[TERMO_1]', '[DATA]']);
      expect(getComputedStyle(p).whiteSpace).toBe('pre-wrap');
    });

    it('nunca interpreta o texto como HTML', async () => {
      await montar();
      await verPrevia(previa(GID, 'oi <img src=x onerror=alert(1)> [CPF_2] fim'));
      const p = el().querySelector('[data-teste="previa"]') as HTMLElement;
      expect(p.querySelector('img')).toBeNull();
      expect(p.textContent).toContain('<img src=x onerror=alert(1)>');
      expect(Array.from(p.querySelectorAll('.ia-codigo')).map((c) => c.textContent)).toEqual([
        '[CPF_2]',
      ]);
    });

    it('colchete que nao e codigo nao e destacado', async () => {
      await montar();
      await verPrevia(previa(GID, 'a [obs] b [cpf] c'));
      expect(el().querySelectorAll('.ia-codigo').length).toBe(0);
    });

    it('aviso de revisao e tipo escolhido; foco no titulo do passo', async () => {
      await montar();
      await verPrevia();
      expect(texto('[data-teste="aviso-previa"]')).toBe(
        'Este é o texto exato que vai sair do sistema. Revise: nomes de terceiros e detalhes que identificam podem não ter sido reconhecidos.',
      );
      expect(texto('.ia-resumo')).toBe('Tipo: Evolução');
      expect(document.activeElement?.id).toBe('ia-previa-titulo');
    });

    it('Adicionar termo gera NOVA previa com a lista completa e atualiza o texto', async () => {
      await montar();
      await digitarTermo('Joana', 'Adicionar à lista');
      await verPrevia();
      await digitarTermo('Escola Sol', 'Adicionar termo');
      const r = ctrl.expectOne(URL_PREVIA);
      expect(r.request.body).toEqual({
        tipoDocumento: 'EVOLUCAO',
        termosExtras: ['Joana', 'Escola Sol'],
      });
      await flush(r, previa(GID2, 'nova [TERMO_2]'), 201);
      expect(el().querySelector('[data-teste="previa"]')?.textContent?.trim()).toBe(
        'nova [TERMO_2]',
      );
      expect(texto('[data-teste="mensagem"]')).toBe('Prévia atualizada com o novo termo.');
      expect(texto('[data-teste="termos"]')).toContain('Escola Sol');
      // No passo 2 nao ha botao de remover (remover exige nova previa: volta ao passo 1).
      expect(el().querySelector('[aria-label^="Remover"]')).toBeNull();
    });

    it('se a nova previa falha, o termo novo some da lista e a previa antiga fica', async () => {
      await montar();
      await verPrevia();
      await digitarTermo('Joana', 'Adicionar termo');
      await flush(ctrl.expectOne(URL_PREVIA), {}, 500);
      expect(el().querySelector('[data-teste="termos"]')).toBeNull();
      expect(el().querySelector('[data-teste="previa"]')?.textContent?.trim()).toBe(TEXTO);
      expect(texto('[data-teste="erro"]')).toContain('Não foi possível concluir agora');
    });

    it('Mudar tipo ou termos volta ao passo 1 mantendo a escolha', async () => {
      await montar();
      await digitarTermo('Joana', 'Adicionar à lista');
      await verPrevia();
      await clicar('Mudar tipo ou termos');
      expect(el().querySelector('[data-teste="passo-config"]')).not.toBeNull();
      expect(texto('[data-teste="termos"]')).toContain('Joana');
      expect(document.activeElement?.id).toBe('ia-config-titulo');
    });
  });

  describe('erros da prévia', () => {
    const cenarios: [number, object, string][] = [
      [
        403,
        { message: 'Consentimento nao concedido' },
        'Registre o consentimento do paciente para usar a IA.',
      ],
      [
        409,
        { message: 'A origem precisa ser uma nota bruta' },
        'Só uma nota bruta pode ser usada como origem da IA.',
      ],
      [422, { message: 'Nota longa demais' }, 'A nota é longa demais para a IA'],
      [503, { message: 'IA indisponivel' }, 'A IA está desligada neste ambiente.'],
      [0, {}, 'Confira sua conexão'],
    ];
    for (const [status, corpo, esperado] of cenarios) {
      it(`${status}: mostra a mensagem e fica no passo 1`, async () => {
        await montar();
        await clicar('Ver prévia');
        await flush(ctrl.expectOne(URL_PREVIA), corpo, status || 500);
        expect(texto('[data-teste="erro"]')).toContain(esperado);
        expect(el().querySelector('[data-teste="passo-config"]')).not.toBeNull();
        expect(botao('Ver prévia')?.hasAttribute('disabled')).toBeFalse();
      });
    }

    it('404: volta ao paciente com aviso fixo (so codigo no state)', async () => {
      await montar();
      await clicar('Ver prévia');
      await flush(ctrl.expectOne(URL_PREVIA), { message: 'Documento nao encontrado' }, 404);
      expect(navegar).toHaveBeenCalledWith(`/pacientes/${PID}`, {
        state: { aviso: 'documento-nao-encontrado' },
      });
    });
  });

  describe('passo 2: enviar para a IA', () => {
    const URL_CONF = `/api/geracoes-ia/${GID}/confirmar`;
    const URL_G = `/api/geracoes-ia/${GID}`;
    const pronto = () => ({
      id: GID,
      estado: 'PENDENTE',
      tipoDocumento: 'EVOLUCAO',
      origemId: DID,
      documentoId: null,
      motivo: null,
      retentavel: null,
      avisos: [],
      criadoEm: '2026-11-05T10:00:00.000Z',
      finalizadoEm: null,
    });
    const escape = async () => {
      el()
        .querySelector('[data-teste="confirmacao"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
    };
    const abrirConfirmacao = async () => {
      await verPrevia();
      await clicar('Enviar para a IA');
    };

    it('Enviar para a IA so abre a confirmacao inline: nada e enviado ainda, foco em Cancelar', async () => {
      await montar();
      await abrirConfirmacao();
      ctrl.expectNone(URL_CONF);
      const c = el().querySelector('[data-teste="confirmacao"]') as HTMLElement;
      expect(c.getAttribute('role')).toBe('group');
      expect(c.textContent).toContain('Enviar este texto para a IA?');
      expect(c.textContent).toContain('exatamente como está na prévia');
      expect(document.activeElement?.id).toBe('ia-cancelar-envio');
    });

    it('Cancelar e Escape fecham a confirmacao e devolvem o foco ao botao', async () => {
      await montar();
      await abrirConfirmacao();
      await clicar('Cancelar');
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(document.activeElement?.id).toBe('ia-enviar');
      await clicar('Enviar para a IA');
      await escape();
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(document.activeElement?.id).toBe('ia-enviar');
      ctrl.expectNone(URL_CONF);
    });

    it('Confirmar envio: POST confirmar so com o id (sem corpo) e abre o acompanhamento; texto sai da memoria', async () => {
      await montar();
      await abrirConfirmacao();
      await clicar('Confirmar envio');
      const r = ctrl.expectOne(URL_CONF);
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toBeNull();
      expect(botao('Enviando…')?.hasAttribute('disabled')).toBeTrue();
      await flush(r, { id: GID, estado: 'PENDENTE' }, 202);
      expect(el().querySelector('[data-teste="passo-acompanhar"]')).not.toBeNull();
      expect(el().querySelector('[data-teste="previa"]')).toBeNull();
      expect(fixture.componentInstance.previa()).toBeNull();
      await flush(ctrl.expectOne(URL_G), pronto());
      expect(texto('[data-teste="pendente"]')).toContain('Gerando…');
      expect(document.activeElement?.id).toBe('ia-acomp-titulo');
    });

    it('duplo clique em Confirmar envio: um POST so', async () => {
      await montar();
      await abrirConfirmacao();
      const b = botao('Confirmar envio')!;
      b.click();
      b.click();
      await fixture.whenStable();
      await flush(ctrl.expectOne(URL_CONF), { id: GID, estado: 'PENDENTE' }, 202);
      await flush(ctrl.expectOne(URL_G), pronto());
    });

    it('409 de previa expirada: oferece gerar outra, que cria nova previa e reabre o passo', async () => {
      await montar();
      await abrirConfirmacao();
      await clicar('Confirmar envio');
      await flush(ctrl.expectOne(URL_CONF), { message: 'Previa expirada, gere outra' }, 409);
      expect(texto('[data-teste="erro"]')).toBe(
        'A prévia expirou (vale 30 minutos). Gere outra para continuar.',
      );
      expect(botao('Enviar para a IA')).toBeNull();
      await clicar('Gerar outra prévia');
      const r = ctrl.expectOne(URL_PREVIA);
      expect(r.request.body).toEqual({ tipoDocumento: 'EVOLUCAO' });
      await flush(r, previa(GID2, 'texto novo [CPF]'), 201);
      expect(el().querySelector('[data-teste="erro"]')).toBeNull();
      expect(el().querySelector('[data-teste="previa"]')?.textContent?.trim()).toBe(
        'texto novo [CPF]',
      );
      expect(botao('Enviar para a IA')).not.toBeNull();
    });

    it('429 do limite diario: mostra a hora de renovar e a previa continua para tentar mais tarde', async () => {
      await montar();
      await abrirConfirmacao();
      await clicar('Confirmar envio');
      await flush(
        ctrl.expectOne(URL_CONF),
        { mensagem: 'x', limite: 20, usadas: 20, renovaEm: '2026-11-06T03:00:00.000Z' },
        429,
      );
      expect(texto('[data-teste="erro"]')).toMatch(
        /^Limite diário de gerações atingido; renova em 06\/11\/2026, \d{2}:\d{2}\.$/,
      );
      expect(el().querySelector('[data-teste="previa"]')?.textContent?.trim()).toBe(TEXTO);
      expect(botao('Enviar para a IA')).not.toBeNull();
    });

    it('429 "ja ha uma geracao em andamento": avisa e leva ao acompanhamento da que esta rodando', async () => {
      await montar();
      await abrirConfirmacao();
      await clicar('Confirmar envio');
      await flush(ctrl.expectOne(URL_CONF), { message: 'Ja ha uma geracao em andamento' }, 429);
      await flush(ctrl.expectOne(`/api/pacientes/${PID}/geracoes-ia`), [
        { ...pronto(), id: GID2 },
        { ...pronto(), estado: 'FALHOU' },
      ]);
      expect(texto('[data-teste="mensagem"]')).toBe(
        'Já havia uma geração em andamento. Estou mostrando o andamento dela.',
      );
      expect(el().querySelector('[data-teste="passo-acompanhar"]')).not.toBeNull();
      expect(fixture.componentInstance.previa()).toBeNull();
      await flush(ctrl.expectOne(`/api/geracoes-ia/${GID2}`), { ...pronto(), id: GID2 });
    });

    it('429 de andamento sem pendente neste paciente: explica e fica na previa', async () => {
      await montar();
      await abrirConfirmacao();
      await clicar('Confirmar envio');
      await flush(ctrl.expectOne(URL_CONF), { message: 'Ja ha uma geracao em andamento' }, 429);
      await flush(ctrl.expectOne(`/api/pacientes/${PID}/geracoes-ia`), []);
      expect(texto('[data-teste="erro"]')).toContain('em outra nota');
      expect(el().querySelector('[data-teste="previa"]')).not.toBeNull();
    });

    it('503 (IA desligada) e erro de rede: mensagem e a previa continua', async () => {
      await montar();
      await abrirConfirmacao();
      await clicar('Confirmar envio');
      await flush(ctrl.expectOne(URL_CONF), { message: 'IA indisponivel' }, 503);
      expect(texto('[data-teste="erro"]')).toBe('A IA está desligada neste ambiente.');
      await clicar('Enviar para a IA');
      await clicar('Confirmar envio');
      await flush(ctrl.expectOne(URL_CONF), {}, 500);
      expect(texto('[data-teste="erro"]')).toContain('Confira sua conexão');
      expect(el().querySelector('[data-teste="previa"]')?.textContent?.trim()).toBe(TEXTO);
    });
  });

  describe('?geracao=<id> (link de "Pedidos de IA")', () => {
    it('abre direto no acompanhamento e consulta so esse pedido', async () => {
      await montar({ geracao: GID });
      expect(el().querySelector('[data-teste="passo-config"]')).toBeNull();
      expect(el().querySelector('[data-teste="passo-acompanhar"]')).not.toBeNull();
      await flush(ctrl.expectOne(`/api/geracoes-ia/${GID}`), {
        id: GID,
        estado: 'PRONTO',
        tipoDocumento: 'ANAMNESE',
        origemId: DID,
        documentoId: '66666666-6666-4666-8666-666666666666',
        motivo: null,
        retentavel: null,
        avisos: [],
        criadoEm: 'x',
        finalizadoEm: 'y',
      });
      expect(botao('Abrir o rascunho')).not.toBeNull();
    });
  });

  it('ao sair da pagina o texto e os termos saem da memoria', async () => {
    await montar();
    await digitarTermo('Joana', 'Adicionar à lista');
    await verPrevia();
    const pagina = fixture.componentInstance;
    expect(pagina.previa()).not.toBeNull();
    fixture.destroy();
    expect(pagina.previa()).toBeNull();
    expect(pagina.termos()).toEqual([]);
    expect(pagina.partes()).toEqual([]);
  });

  it('o texto da previa nao vai para storage, URL nem history.state', async () => {
    sessionStorage.clear();
    localStorage.clear();
    await montar();
    await verPrevia();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(location.href).not.toContain('PACIENTE');
    expect(JSON.stringify(history.state)).not.toContain('PACIENTE');
  });
});
