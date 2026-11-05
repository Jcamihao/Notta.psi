import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { DocumentoLeituraPage } from './documento-leitura.page';
import { Documento } from './documentos.service';

const PID = '11111111-1111-4111-8111-111111111111';
const DID = '22222222-2222-4222-8222-222222222222';
const OID = '33333333-3333-4333-8333-333333333333';
const URL = `/api/pacientes/${PID}/documentos/${DID}`;
const URL_ORIGINAL = `/api/pacientes/${PID}/documentos/${OID}`;
const URL_PACIENTE = `/api/pacientes/${PID}`;
const RASCUNHO: Documento = {
  id: DID,
  pacienteId: PID,
  tipo: 'EVOLUCAO',
  dataSessao: '2026-11-02',
  conteudo: 'Linha 1\nLinha 2\n\n<b>nao e html</b> <img src=x onerror=alert(1)>',
  status: 'RASCUNHO',
  criadoEm: '2026-11-03T13:00:00.000Z',
  atualizadoEm: '2026-11-03T13:00:00.000Z',
  aprovadoEm: null,
  substituiId: null,
  geradoPorIa: false,
};
const APROVADO: Documento = {
  ...RASCUNHO,
  status: 'APROVADO',
  aprovadoEm: '2026-11-04T15:30:00.000Z',
};
const PACIENTE = { id: PID, nome: 'Maria da Silva', nascimento: null, telefone: null, email: null };

describe('DocumentoLeituraPage', () => {
  let fixture: ComponentFixture<DocumentoLeituraPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const montar = async (doc: Documento | null = null) => {
    params = new BehaviorSubject(convertToParamMap({ id: PID, docId: DID }));
    TestBed.configureTestingModule({
      imports: [DocumentoLeituraPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: params.value }, paramMap: params },
        },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(DocumentoLeituraPage);
    await fixture.whenStable();
    if (doc) await flush(ctrl.expectOne(URL), doc);
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
  const campo = <T extends HTMLElement>(nome: string) => el().querySelector(`#de-${nome}`) as T;
  const digitar = async (nome: string, valor: string) => {
    const c = campo<HTMLInputElement>(nome);
    c.value = valor;
    c.dispatchEvent(new Event('input'));
    c.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
  };
  const submeter = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const abrirEdicao = async () => {
    await clicar('Editar');
    await flush(ctrl.expectOne(URL_PACIENTE), PACIENTE);
  };
  const escape = async () => {
    el()
      .querySelector('[data-teste="confirmacao"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
  };

  describe('leitura', () => {
    it('uma chamada so (GET do documento) e mostra carregando', async () => {
      await montar();
      expect(texto('[role="status"]')).toBe('Carregando o documento…');
      const r = ctrl.expectOne(URL);
      expect(r.request.method).toBe('GET');
      await flush(r, RASCUNHO);
    });

    it('mostra tipo, status em pill com texto, data da sessao e criado em', async () => {
      await montar(RASCUNHO);
      expect(texto('h1')).toBe('Evolução');
      expect(texto('app-pill')).toBe('Rascunho');
      const dd = Array.from(el().querySelectorAll('dl > div')).map((d) => ({
        dt: d.querySelector('dt')?.textContent,
        dd: d.querySelector('dd')?.textContent?.trim(),
      }));
      expect(dd[0]).toEqual({ dt: 'Status', dd: 'Rascunho' });
      expect(dd[1]).toEqual({ dt: 'Data da sessão', dd: '02/11/2026' });
      expect(dd[2].dt).toBe('Criado em');
      expect(dd[2].dd).toMatch(/^03\/11\/2026, \d{2}:\d{2}$/);
    });

    it('sem data de sessao: "Não informada"', async () => {
      await montar({ ...RASCUNHO, dataSessao: null });
      expect(texto('dl')).toContain('Não informada');
    });

    it('preserva quebras de linha (pre-wrap) e mostra o texto exato', async () => {
      await montar(RASCUNHO);
      const p = el().querySelector('[data-teste="texto"]') as HTMLElement;
      expect(p.textContent).toBe(RASCUNHO.conteudo);
      expect(getComputedStyle(p).whiteSpace).toBe('pre-wrap');
    });

    it('nunca interpreta o texto como HTML', async () => {
      await montar(RASCUNHO);
      const p = el().querySelector('[data-teste="texto"]') as HTMLElement;
      expect(p.querySelector('b, img')).toBeNull();
      expect(p.children.length).toBe(0);
    });

    it('link para voltar ao paciente', async () => {
      await montar(RASCUNHO);
      expect(el().querySelector('a')?.getAttribute('href')).toBe(`/pacientes/${PID}`);
    });

    it('404: volta ao paciente com o aviso fixo, sem mostrar texto', async () => {
      await montar();
      await flush(ctrl.expectOne(URL), { statusCode: 404 }, 404);
      expect(navegar).toHaveBeenCalledWith(`/pacientes/${PID}`, {
        state: { aviso: 'documento-nao-encontrado' },
      });
      expect(el().querySelector('[data-teste="texto"]')).toBeNull();
    });

    it('503/rede/400: alerta com "Tentar de novo", sem navegar; refaz a chamada', async () => {
      await montar();
      await flush(ctrl.expectOne(URL), { statusCode: 503 }, 503);
      expect(texto('[role="alert"]')).toContain('Não foi possível carregar o documento');
      expect(navegar).not.toHaveBeenCalled();
      (el().querySelector('[role="alert"] button') as HTMLButtonElement).click();
      await fixture.whenStable();
      await flush(ctrl.expectOne(URL), RASCUNHO);
      expect(el().querySelector('[data-teste="texto"]')).not.toBeNull();
    });

    it('ao sair da pagina o texto sai da memoria e do formulario', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      expect(fixture.componentInstance.form.controls.conteudo.value).toBe(RASCUNHO.conteudo);
      fixture.destroy();
      expect(fixture.componentInstance.documento()).toBeNull();
      expect(fixture.componentInstance.form.controls.conteudo.value).toBe('');
    });

    it('nao guarda nada em storage nem poe texto no console, nem no state do router', async () => {
      const antes = [localStorage.length, sessionStorage.length];
      const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        spyOn(console, m),
      );
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('conteudo', 'CPF 529.982.247-25 novo texto');
      expect([localStorage.length, sessionStorage.length]).toEqual(antes);
      for (const e of espioes) expect(e).not.toHaveBeenCalled();
      expect(JSON.stringify(navegar.calls.allArgs())).not.toContain('529');
    });

    it('navegar para outro documento (mesma rota) recarrega e esquece o estado', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      expect(el().querySelector('[data-teste="confirmacao"]')).not.toBeNull();
      params.next(convertToParamMap({ id: PID, docId: OID }));
      await fixture.whenStable();
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      await flush(ctrl.expectOne(URL_ORIGINAL), { ...APROVADO, id: OID, conteudo: 'outro' });
      expect(texto('[data-teste="texto"]')).toBe('outro');
    });
  });

  describe('editar rascunho (item 14)', () => {
    it('rascunho mostra Editar e Aprovar; sem campos ate clicar', async () => {
      await montar(RASCUNHO);
      expect(botao('Editar')).not.toBeNull();
      expect(botao('Aprovar documento')).not.toBeNull();
      expect(el().querySelector('textarea, input, select, form')).toBeNull();
    });

    it('Editar abre o formulario preenchido, com foco no texto, sem tipo, e busca o paciente 1 vez', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      expect(campo<HTMLTextAreaElement>('conteudo').value).toBe(RASCUNHO.conteudo);
      expect(campo<HTMLInputElement>('dataSessao').value).toBe('2026-11-02');
      expect(campo('tipo')).toBeNull();
      expect(document.activeElement).toBe(campo('conteudo'));
      expect(el().querySelector('label[for="de-conteudo"]')?.textContent).toBe('Texto');
      expect(el().querySelector('label[for="de-dataSessao"]')?.textContent).toBe(
        'Data da sessão (opcional)',
      );
      await clicar('Cancelar');
      await clicar('Editar');
      ctrl.expectNone(URL_PACIENTE);
    });

    it('textarea sem corretor e sem autocompletar; contador acompanha', async () => {
      await montar({ ...RASCUNHO, conteudo: 'abc' });
      await abrirEdicao();
      const t = campo<HTMLTextAreaElement>('conteudo');
      expect(t.getAttribute('spellcheck')).toBe('false');
      expect(t.getAttribute('autocomplete')).toBe('off');
      expect(texto('[data-teste="contador"]')).toBe('3 de 20.000 caracteres');
      await digitar('conteudo', 'a'.repeat(1234));
      expect(texto('[data-teste="contador"]')).toBe('1.234 de 20.000 caracteres');
      expect(t.getAttribute('aria-describedby')).toContain('de-conteudo-contador');
    });

    it('validacao igual a de criar: vazio, so espacos e 20.001 nao enviam; foco no 1o erro', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('conteudo', '');
      await submeter();
      expect(campo('conteudo').getAttribute('aria-invalid')).toBe('true');
      expect(texto('#de-conteudo-erro')).toBe('Escreva o texto do documento.');
      expect(document.activeElement).toBe(campo('conteudo'));
      await digitar('conteudo', '  \n\t ');
      await submeter();
      expect(texto('#de-conteudo-erro')).toBe('Escreva o texto do documento.');
      await digitar('conteudo', 'a'.repeat(20001));
      await submeter();
      expect(texto('#de-conteudo-erro')).toContain('até 20.000 caracteres');
      expect(el().querySelector('[data-teste="contador"]')?.classList).toContain('acima');
      await digitar('conteudo', 'ok');
      await digitar('dataSessao', '9999-01-01');
      await submeter();
      expect(texto('#de-dataSessao-erro')).toBe('A data da sessão não pode ser no futuro.');
      expect(document.activeElement).toBe(campo('dataSessao'));
      await digitar('dataSessao', '1899-12-31');
      await submeter();
      expect(texto('#de-dataSessao-erro')).toBe('Informe uma data de sessão a partir de 1900.');
      ctrl.expectNone(URL);
    });

    it('PATCH so com o texto quando so o texto mudou (sem aparar)', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('conteudo', '  texto novo  \n');
      await submeter();
      const r = ctrl.expectOne(URL);
      expect(r.request.method).toBe('PATCH');
      expect(r.request.body).toEqual({ conteudo: '  texto novo  \n' });
      await flush(r, { ...RASCUNHO, conteudo: '  texto novo  \n' });
    });

    it('PATCH so com a data quando so a data mudou; limpar a data envia null', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('dataSessao', '2026-11-01');
      await submeter();
      let r = ctrl.expectOne(URL);
      expect(r.request.body).toEqual({ dataSessao: '2026-11-01' });
      await flush(r, { ...RASCUNHO, dataSessao: '2026-11-01' });
      await clicar('Editar');
      await digitar('dataSessao', '');
      await submeter();
      r = ctrl.expectOne(URL);
      expect(r.request.body).toEqual({ dataSessao: null });
      await flush(r, { ...RASCUNHO, dataSessao: null });
      expect(texto('dl')).toContain('Não informada');
    });

    it('sem mudanca nao chama a API: so avisa e sai da edicao', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await submeter();
      ctrl.expectNone(URL);
      expect(el().querySelector('form')).toBeNull();
      expect(texto('[data-teste="mensagem"]')).toBe('Nenhuma alteração para salvar.');
    });

    it('sucesso: mostra o texto novo, confirma, volta a leitura e devolve o foco a Editar', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('conteudo', 'versao 2');
      await submeter();
      await flush(ctrl.expectOne(URL), { ...RASCUNHO, conteudo: 'versao 2' });
      expect(el().querySelector('form')).toBeNull();
      expect(texto('[data-teste="texto"]')).toBe('versao 2');
      expect(texto('[data-teste="mensagem"]')).toBe('Alterações salvas.');
      expect(document.activeElement).toBe(botao('Editar'));
    });

    it('sem duplo envio e botao mostra progresso', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('conteudo', 'x');
      await submeter();
      await submeter();
      const b = el().querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(b.disabled).toBeTrue();
      expect(b.textContent?.trim()).toBe('Salvando…');
      await flush(ctrl.expectOne(URL), { ...RASCUNHO, conteudo: 'x' });
    });

    it('Cancelar descarta o que foi digitado, nao chama a API e devolve o foco a Editar', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('conteudo', 'rascunho abandonado');
      await clicar('Cancelar');
      ctrl.expectNone(URL);
      expect(el().querySelector('form')).toBeNull();
      expect(el().querySelector('[data-teste="texto"]')?.textContent).toBe(RASCUNHO.conteudo);
      expect(fixture.componentInstance.form.controls.conteudo.value).toBe('');
      expect(document.activeElement).toBe(botao('Editar'));
    });

    it('409 (aprovado por fora): avisa, recarrega e a tela vira somente leitura', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('conteudo', 'tarde demais');
      await submeter();
      await flush(
        ctrl.expectOne(URL),
        { statusCode: 409, message: 'Documento aprovado nao pode ser editado' },
        409,
      );
      expect(texto('[data-teste="erro-geral"]')).toBe('Documento aprovado não pode ser editado.');
      expect(fixture.componentInstance.form.controls.conteudo.value).toBe('');
      const r = ctrl.expectOne(URL);
      expect(r.request.method).toBe('GET');
      await flush(r, APROVADO);
      expect(el().querySelector('form')).toBeNull();
      expect(el().querySelector('[data-teste="faixa"]')).not.toBeNull();
      expect(botao('Editar')).toBeNull();
    });

    it('404 ao salvar: volta ao paciente com o aviso fixo', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('conteudo', 'x');
      await submeter();
      await flush(ctrl.expectOne(URL), { statusCode: 404 }, 404);
      expect(navegar).toHaveBeenCalledWith(`/pacientes/${PID}`, {
        state: { aviso: 'documento-nao-encontrado' },
      });
    });

    for (const [status, nome] of [
      [400, '400'],
      [503, '503'],
      [0, 'rede'],
    ] as const) {
      it(`${nome}: mensagem na tela, continua editando com o texto preservado e botao liberado`, async () => {
        await montar(RASCUNHO);
        await abrirEdicao();
        await digitar('conteudo', 'meu texto');
        await submeter();
        const r = ctrl.expectOne(URL);
        if (status === 0) r.error(new ProgressEvent('error'));
        else await flush(r, { statusCode: status }, status);
        await fixture.whenStable();
        expect(texto('[data-teste="erro-geral"]')).not.toBe('');
        expect(campo<HTMLTextAreaElement>('conteudo').value).toBe('meu texto');
        expect(
          (el().querySelector('button[type="submit"]') as HTMLButtonElement).disabled,
        ).toBeFalse();
        expect(navegar).not.toHaveBeenCalled();
      });
    }

    it('aviso de dado identificavel tambem na edicao (nome vem do paciente), sem bloquear', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      await digitar('conteudo', 'Maria disse que o CPF e 529.982.247-25');
      const a = texto('[data-teste="aviso-identificacao"]')!;
      expect(a).toContain('(CPF, nome do paciente)');
      expect(a).not.toContain('529');
      await submeter();
      expect(ctrl.expectOne(URL).request.body.conteudo).toContain('Maria');
    });

    it('com consentimento revogado a edicao continua (a tela nao depende do consentimento)', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      expect(campo('conteudo')).not.toBeNull();
    });
  });

  describe('marcas de IA e cartao "Gerar com IA" (itens 20 e 21)', () => {
    const IA = { ...RASCUNHO, geradoPorIa: true };

    it('rascunho gerado por IA: faixa "Revise antes de aprovar" e pill IA com nome para leitor de tela', async () => {
      await montar(IA);
      expect(texto('[data-teste="faixa-ia"]')).toBe(
        'Rascunho gerado por IA. Revise antes de aprovar.',
      );
      const pills = Array.from(el().querySelectorAll('app-pill')).map((p) =>
        p.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(pills).toEqual(['Rascunho', 'IA, gerado por inteligência artificial']);
      expect(el().querySelector('app-pill .so-leitor')).not.toBeNull();
    });

    it('a faixa continua durante a edicao', async () => {
      await montar(IA);
      await abrirEdicao();
      expect(el().querySelector('[data-teste="faixa-ia"]')).not.toBeNull();
    });

    it('documento comum: sem faixa nem pill IA', async () => {
      await montar(RASCUNHO);
      expect(el().querySelector('[data-teste="faixa-ia"]')).toBeNull();
      expect(texto('dl')).not.toContain('IA');
    });

    it('aprovado gerado por IA: sem a faixa de revisao (ja foi revisado), pill IA fica', async () => {
      await montar({ ...APROVADO, geradoPorIa: true });
      expect(el().querySelector('[data-teste="faixa-ia"]')).toBeNull();
      expect(el().querySelectorAll('app-pill').length).toBe(2);
    });

    it('nota bruta mostra o cartao Gerar com IA (que consulta o uso); outros tipos nao', async () => {
      await montar({ ...RASCUNHO, tipo: 'NOTA_BRUTA' });
      expect(el().querySelector('app-ia-cartao')).not.toBeNull();
      ctrl
        .expectOne('/api/ia/uso')
        .flush({ habilitada: false, limite: 20, usadas: 0, renovaEm: '2026-11-05T03:00:00.000Z' });
      await fixture.whenStable();
      expect(texto('app-ia-cartao')).toContain('A IA está desligada neste ambiente.');
    });

    it('evolucao nao mostra o cartao nem chama /ia/uso', async () => {
      await montar(RASCUNHO);
      expect(el().querySelector('app-ia-cartao')).toBeNull();
      ctrl.expectNone('/api/ia/uso');
    });

    it('o cartao some durante a edicao da nota', async () => {
      await montar({ ...RASCUNHO, tipo: 'NOTA_BRUTA' });
      ctrl
        .expectOne('/api/ia/uso')
        .flush({ habilitada: false, limite: 20, usadas: 0, renovaEm: 'x' });
      await fixture.whenStable();
      await abrirEdicao();
      expect(el().querySelector('app-ia-cartao')).toBeNull();
    });
  });

  describe('aprovar (item 15)', () => {
    it('Aprovar documento abre a confirmacao inline com o aviso de irreversivel, foco em Cancelar, sem chamar a API', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      const c = texto('[data-teste="confirmacao"]')!;
      expect(c).toContain('Aprovar é irreversível');
      expect(c).toContain('não pode mais ser editado nem apagado');
      expect(c).toContain('novo documento ligado a este');
      expect(document.activeElement).toBe(el().querySelector('#de-cancelar-aprovacao'));
      expect(botao('Confirmar aprovação')).not.toBeNull();
      ctrl.expectNone(`${URL}/aprovar`);
    });

    it('Escape cancela, sem POST, e o foco volta ao botao Aprovar documento', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      await escape();
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(document.activeElement).toBe(botao('Aprovar documento'));
      ctrl.expectNone(`${URL}/aprovar`);
    });

    it('Cancelar cancela, sem POST, e o foco volta ao botao Aprovar documento', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      await clicar('Cancelar');
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(document.activeElement).toBe(botao('Aprovar documento'));
      ctrl.expectNone(`${URL}/aprovar`);
    });

    it('Confirmar: POST sem corpo, vira aprovado e somente leitura, com faixa e sem Editar nem Aprovar', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      await clicar('Confirmar aprovação');
      const r = ctrl.expectOne(`${URL}/aprovar`);
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toBeNull();
      await flush(r, APROVADO);
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(texto('[data-teste="mensagem"]')).toBe('Documento aprovado.');
      expect(texto('[data-teste="faixa"]')).toMatch(/^Aprovado em 04\/11\/2026, \d{2}:\d{2}\./);
      expect(texto('app-pill')).toBe('Aprovado');
      expect(botao('Editar')).toBeNull();
      expect(botao('Aprovar documento')).toBeNull();
      expect(el().querySelector('textarea, input, select, form')).toBeNull();
      expect(document.activeElement).toBe(el().querySelector('#de-faixa'));
    });

    it('mostra o texto que o servidor devolveu na aprovacao (nao o que estava na tela)', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      await clicar('Confirmar aprovação');
      await flush(ctrl.expectOne(`${URL}/aprovar`), { ...APROVADO, conteudo: 'texto do servidor' });
      expect(texto('[data-teste="texto"]')).toBe('texto do servidor');
    });

    it('sem duplo clique em Confirmar e progresso no botao', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      await clicar('Confirmar aprovação');
      expect(botao('Aprovando…')).not.toBeNull();
      (botao('Aprovando…') as HTMLButtonElement).click();
      await fixture.whenStable();
      await flush(ctrl.expectOne(`${URL}/aprovar`), APROVADO);
    });

    it('409 (ja aprovado por fora): avisa sem derrubar nada e recarrega', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      await clicar('Confirmar aprovação');
      await flush(
        ctrl.expectOne(`${URL}/aprovar`),
        { statusCode: 409, message: 'Documento ja aprovado' },
        409,
      );
      expect(texto('[data-teste="erro-geral"]')).toBe(
        'Este documento já foi aprovado. Atualizei a tela.',
      );
      await flush(ctrl.expectOne(URL), APROVADO);
      expect(el().querySelector('[data-teste="faixa"]')).not.toBeNull();
      expect(navegar).not.toHaveBeenCalled();
    });

    it('404 ao aprovar: volta ao paciente com o aviso fixo', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      await clicar('Confirmar aprovação');
      await flush(ctrl.expectOne(`${URL}/aprovar`), { statusCode: 404 }, 404);
      expect(navegar).toHaveBeenCalledWith(`/pacientes/${PID}`, {
        state: { aviso: 'documento-nao-encontrado' },
      });
    });

    it('503: erro na tela, confirmacao fecha e o rascunho continua aprovavel', async () => {
      await montar(RASCUNHO);
      await clicar('Aprovar documento');
      await clicar('Confirmar aprovação');
      await flush(ctrl.expectOne(`${URL}/aprovar`), { statusCode: 503 }, 503);
      expect(texto('[data-teste="erro-geral"]')).not.toBe('');
      expect(el().querySelector('[data-teste="confirmacao"]')).toBeNull();
      expect(botao('Aprovar documento')).not.toBeNull();
      expect(texto('app-pill')).toBe('Rascunho');
    });

    it('nao aprova durante a edicao (botao some enquanto edita)', async () => {
      await montar(RASCUNHO);
      await abrirEdicao();
      expect(botao('Aprovar documento')).toBeNull();
    });
  });

  describe('aprovado e correcao (item 15)', () => {
    it('aprovado: faixa, somente leitura e botao Corrigir com o link da correcao', async () => {
      await montar(APROVADO);
      expect(texto('[data-teste="faixa"]')).toMatch(/^Aprovado em 04\/11\/2026, \d{2}:\d{2}\./);
      expect(botao('Editar')).toBeNull();
      expect(botao('Aprovar documento')).toBeNull();
      expect(el().querySelector('textarea, input, select, form')).toBeNull();
      const corrigir = botao('Corrigir') as HTMLAnchorElement;
      expect(corrigir.tagName).toBe('A');
      expect(corrigir.getAttribute('href')).toBe(
        `/pacientes/${PID}/documentos/novo?corrige=${DID}`,
      );
      expect(el().querySelector('[data-teste="corrige"]')).toBeNull();
    });

    it('rascunho nao mostra faixa nem Corrigir', async () => {
      await montar(RASCUNHO);
      expect(el().querySelector('[data-teste="faixa"]')).toBeNull();
      expect(botao('Corrigir')).toBeNull();
    });

    it('documento que corrige outro: busca o original e mostra "Corrige: <tipo> de <data>" com link', async () => {
      await montar();
      await flush(ctrl.expectOne(URL), { ...RASCUNHO, substituiId: OID });
      await flush(ctrl.expectOne(URL_ORIGINAL), {
        ...APROVADO,
        id: OID,
        tipo: 'NOTA_BRUTA',
        dataSessao: '2026-10-20',
        conteudo: 'texto original que nao deve ficar guardado',
      });
      expect(texto('[data-teste="corrige"]')).toBe('Corrige: Nota bruta de 20/10/2026');
      expect(el().querySelector('[data-teste="corrige"] a')?.getAttribute('href')).toBe(
        `/pacientes/${PID}/documentos/${OID}`,
      );
      expect(JSON.stringify(fixture.componentInstance.original())).not.toContain('texto original');
    });

    it('original sem data de sessao', async () => {
      await montar();
      await flush(ctrl.expectOne(URL), { ...RASCUNHO, substituiId: OID });
      await flush(ctrl.expectOne(URL_ORIGINAL), { ...APROVADO, id: OID, dataSessao: null });
      expect(texto('[data-teste="corrige"]')).toBe('Corrige: Evolução sem data de sessão');
    });

    it('se o original nao carregar, ainda mostra o link "documento anterior"', async () => {
      await montar();
      await flush(ctrl.expectOne(URL), { ...RASCUNHO, substituiId: OID });
      await flush(ctrl.expectOne(URL_ORIGINAL), { statusCode: 503 }, 503);
      expect(texto('[data-teste="corrige"]')).toBe('Corrige: documento anterior');
      expect(el().querySelector('[data-teste="corrige"] a')?.getAttribute('href')).toBe(
        `/pacientes/${PID}/documentos/${OID}`,
      );
    });
  });
});
