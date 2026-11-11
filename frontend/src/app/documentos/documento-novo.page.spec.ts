import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { hojeLocal } from '../core/formulario';
import { DocumentoNovoPage } from './documento-novo.page';

const PID = '11111111-1111-4111-8111-111111111111';
const URL = `/api/pacientes/${PID}/documentos`;
const URL_PACIENTE = `/api/pacientes/${PID}`;
const PACIENTE = {
  id: PID,
  nome: 'Maria da Silva',
  nascimento: null,
  telefone: null,
  email: null,
  criadoEm: '2026-11-01T10:00:00.000Z',
};
const SEGREDO = 'Paciente relatou insonia e conflito com o pai.';

describe('DocumentoNovoPage', () => {
  let fixture: ComponentFixture<DocumentoNovoPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [DocumentoNovoPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: { get: () => PID }, queryParamMap: { get: () => null } },
          },
        },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(DocumentoNovoPage);
    await fixture.whenStable();
    ctrl.expectOne(URL_PACIENTE).flush(PACIENTE);
    await fixture.whenStable();
  });
  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const campo = <T extends HTMLElement>(nome: string) => el().querySelector(`#dc-${nome}`) as T;
  const preencher = (nome: string, valor: string) => {
    const c = campo<HTMLInputElement>(nome);
    c.value = valor;
    c.dispatchEvent(new Event(nome === 'tipo' ? 'change' : 'input'));
    c.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  };
  const enviar = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const botao = () => el().querySelector('button[type="submit"]') as HTMLButtonElement;
  const invalido = (nome: string) => campo(nome).getAttribute('aria-invalid') === 'true';
  const mensagem = (nome: string) => el().querySelector(`#dc-${nome}-erro`)?.textContent?.trim();
  const alerta = () => el().querySelector('[data-teste="erro-geral"]')?.textContent?.trim() ?? '';
  const falhar = async (r: TestRequest, status: number, message = 'x') => {
    r.flush({ statusCode: status, message }, { status, statusText: 'Erro' });
    await fixture.whenStable();
  };
  const valido = (tipo = 'EVOLUCAO', conteudo = SEGREDO) => {
    preencher('tipo', tipo);
    preencher('conteudo', conteudo);
  };

  it('ao abrir so busca o paciente (nome para o detector); nao chama a lista de documentos; titulo, labels e opcoes dos tres tipos', () => {
    ctrl.expectNone(URL);
    expect(el().querySelector('h1')?.textContent).toBe('Novo documento');
    expect(el().querySelector('label[for="dc-tipo"]')?.textContent).toBe('Tipo');
    expect(el().querySelector('label[for="dc-dataSessao"]')?.textContent).toBe(
      'Data da sessão (opcional)',
    );
    expect(el().querySelector('label[for="dc-conteudo"]')?.textContent).toBe('Texto');
    const opcoes = Array.from(campo<HTMLSelectElement>('tipo').options).map((o) => o.textContent);
    expect(opcoes).toEqual(['Selecione', 'Nota bruta', 'Evolução', 'Anamnese']);
  });

  it('explica que rascunho sem edicao e apagado e que aprovar guarda (sem numero de dias)', () => {
    const lead = el().querySelector('.documento-lead')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(lead).toContain('Rascunho sem edição é apagado automaticamente; aprove para guardar.');
    expect(lead).not.toMatch(/\b7\b/);
  });

  it('textarea sem corretor e sem autocompletar', () => {
    const t = campo<HTMLTextAreaElement>('conteudo');
    expect(t.getAttribute('spellcheck')).toBe('false');
    expect(t.getAttribute('autocomplete')).toBe('off');
  });

  it('contador acompanha o texto e usa o limite de 20.000', () => {
    expect(el().querySelector('[data-teste="contador"]')?.textContent?.trim()).toBe(
      '0 de 20.000 caracteres',
    );
    preencher('conteudo', 'a'.repeat(1234));
    expect(el().querySelector('[data-teste="contador"]')?.textContent?.trim()).toBe(
      '1.234 de 20.000 caracteres',
    );
    expect(campo('conteudo').getAttribute('aria-describedby')).toContain('dc-conteudo-contador');
  });

  it('vazio: bloqueia, foca o tipo (primeiro erro), mostra erros ligados aos campos e nao envia', async () => {
    await enviar();
    ctrl.expectNone(URL);
    expect(document.activeElement).toBe(campo('tipo'));
    expect(invalido('tipo')).toBeTrue();
    expect(invalido('conteudo')).toBeTrue();
    expect(mensagem('tipo')).toBe('Escolha o tipo do documento.');
    expect(mensagem('conteudo')).toBe('Escreva o texto do documento.');
    expect(campo('tipo').getAttribute('aria-describedby')).toBe('dc-tipo-erro');
  });

  it('texto so com espacos e quebras e vazio', async () => {
    valido('NOTA_BRUTA', '  \n\t  ');
    await enviar();
    ctrl.expectNone(URL);
    expect(invalido('conteudo')).toBeTrue();
    expect(document.activeElement).toBe(campo('conteudo'));
  });

  it('20.000 caracteres passa; 20.001 bloqueia com mensagem e contador marcado', async () => {
    valido('EVOLUCAO', 'a'.repeat(20001));
    await enviar();
    ctrl.expectNone(URL);
    expect(mensagem('conteudo')).toContain('até 20.000 caracteres');
    expect(el().querySelector('[data-teste="contador"]')?.classList).toContain('acima');
    preencher('conteudo', 'a'.repeat(20000));
    await enviar();
    ctrl.expectOne(URL).flush({}, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
  });

  it('data da sessao: futura e anterior a 1900 bloqueiam; hoje e 1900-01-01 passam', async () => {
    valido();
    preencher('dataSessao', '9999-01-01');
    await enviar();
    ctrl.expectNone(URL);
    expect(mensagem('dataSessao')).toBe('A data da sessão não pode ser no futuro.');
    preencher('dataSessao', '1899-12-31');
    await enviar();
    ctrl.expectNone(URL);
    expect(mensagem('dataSessao')).toBe('Informe uma data de sessão a partir de 1900.');
    preencher('dataSessao', '1900-01-01');
    expect(invalido('dataSessao')).toBeFalse();
    preencher('dataSessao', hojeLocal());
    expect(invalido('dataSessao')).toBeFalse();
    expect(campo('dataSessao').getAttribute('max')).toBe(hojeLocal());
  });

  it('envio sem data: POST so com tipo e conteudo, SEM aparar o texto, depois volta ao paciente', async () => {
    const texto = `  ${SEGREDO}\n\nSegunda linha.  `;
    valido('NOTA_BRUTA', texto);
    await enviar();
    const r = ctrl.expectOne(URL);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ tipo: 'NOTA_BRUTA', conteudo: texto });
    r.flush({ id: 'x' }, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(navegar).toHaveBeenCalledOnceWith(`/pacientes/${PID}`, {
      state: { aviso: 'documento-criado' },
    });
  });

  it('envio com data: POST inclui dataSessao', async () => {
    valido('ANAMNESE');
    preencher('dataSessao', '2026-11-02');
    await enviar();
    const r = ctrl.expectOne(URL);
    expect(r.request.body).toEqual({
      tipo: 'ANAMNESE',
      dataSessao: '2026-11-02',
      conteudo: SEGREDO,
    });
    r.flush({}, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
  });

  it('o state da navegacao leva so um codigo fixo, nunca o texto', async () => {
    valido();
    await enviar();
    ctrl.expectOne(URL).flush({}, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(JSON.stringify(navegar.calls.allArgs())).not.toContain('insonia');
  });

  it('sem duplo envio e botao mostra progresso', async () => {
    valido();
    await enviar();
    await enviar();
    fixture.detectChanges();
    expect(botao().disabled).toBeTrue();
    expect(botao().textContent?.trim()).toBe('Salvando…');
    ctrl.expectOne(URL).flush({}, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
  });

  it('403 "Consentimento nao concedido": avisa (volta ao paciente com codigo fixo) e limpa o texto', async () => {
    valido();
    await enviar();
    await falhar(ctrl.expectOne(URL), 403, 'Consentimento nao concedido');
    expect(navegar).toHaveBeenCalledOnceWith(`/pacientes/${PID}`, {
      state: { aviso: 'sem-consentimento' },
    });
    expect(campo<HTMLTextAreaElement>('conteudo').value).toBe('');
  });

  it('404 (paciente nao e seu): vai para a lista com "nao encontrado" e limpa o texto', async () => {
    valido();
    await enviar();
    await falhar(ctrl.expectOne(URL), 404);
    expect(navegar).toHaveBeenCalledOnceWith('/pacientes', { state: { aviso: 'nao-encontrado' } });
    expect(campo<HTMLTextAreaElement>('conteudo').value).toBe('');
  });

  for (const [status, nome] of [
    [400, '400'],
    [503, '503'],
    [0, 'rede'],
    [401, '401'],
  ] as const) {
    it(`${nome}: mensagem na tela, sem navegar, texto digitado preservado e botao liberado`, async () => {
      valido();
      await enviar();
      const r = ctrl.expectOne(URL);
      if (status === 0) r.error(new ProgressEvent('error'));
      else await falhar(r, status);
      fixture.detectChanges();
      expect(alerta()).not.toBe('');
      expect(navegar).not.toHaveBeenCalled();
      expect(campo<HTMLTextAreaElement>('conteudo').value).toBe(SEGREDO);
      expect(botao().disabled).toBeFalse();
    });
  }

  it('403 de outro motivo nao e tratado como falta de consentimento', async () => {
    valido();
    await enviar();
    await falhar(ctrl.expectOne(URL), 403, 'Forbidden');
    expect(navegar).not.toHaveBeenCalled();
    expect(alerta()).not.toBe('');
  });

  it('ao sair da pagina o texto e limpo do formulario', () => {
    valido();
    expect(fixture.componentInstance.form.controls.conteudo.value).toBe(SEGREDO);
    fixture.destroy();
    expect(fixture.componentInstance.form.controls.conteudo.value).toBe('');
  });

  it('nao guarda nada em storage nem escreve no console', async () => {
    const antes = [localStorage.length, sessionStorage.length];
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      spyOn(console, m),
    );
    valido();
    await enviar();
    ctrl.expectOne(URL).flush({}, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect([localStorage.length, sessionStorage.length]).toEqual(antes);
    for (const e of espioes) expect(e).not.toHaveBeenCalled();
  });

  describe('aviso de dado que identifica (item 13)', () => {
    const aviso = () =>
      el().querySelector('[data-teste="aviso-identificacao"]')?.textContent?.replace(/\s+/g, ' ');
    const digitar = async (texto: string) => {
      preencher('conteudo', texto);
      await fixture.whenStable();
    };

    it('mostra o nome do paciente carregado', () => {
      expect(el().querySelector('[data-teste="paciente"]')?.textContent).toBe(
        'Paciente: Maria da Silva',
      );
    });

    it('texto limpo nao avisa', async () => {
      await digitar(SEGREDO);
      expect(aviso()).toBeUndefined();
    });

    it('CPF, e-mail e nome do paciente avisam so o tipo, nunca o trecho', async () => {
      await digitar('Maria contou. CPF 529.982.247-25, escreve de maria@exemplo.com');
      const a = aviso()!;
      expect(a).toContain('(CPF, e-mail, nome do paciente)');
      expect(a).not.toContain('529');
      expect(a).not.toContain('exemplo.com');
      expect(a).toContain('Considere remover.');
    });

    it('nao bloqueia: com aviso na tela o rascunho salva normalmente', async () => {
      valido('EVOLUCAO', 'CPF 529.982.247-25');
      await fixture.whenStable();
      expect(aviso()).toContain('CPF');
      await enviar();
      const r = ctrl.expectOne(URL);
      expect(r.request.body.conteudo).toBe('CPF 529.982.247-25');
      r.flush({}, { status: 201, statusText: 'Created' });
      await fixture.whenStable();
    });

    it('dispensar esconde o aviso e devolve o foco ao texto', async () => {
      await digitar('fone (11) 91234-5678');
      (
        el().querySelector('[data-teste="aviso-identificacao"] button') as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      expect(aviso()).toBeUndefined();
      expect(document.activeElement).toBe(campo('conteudo'));
    });

    it('apagar o dado faz o aviso sumir', async () => {
      await digitar('fone (11) 91234-5678');
      expect(aviso()).toContain('telefone');
      await digitar('fone omitido');
      expect(aviso()).toBeUndefined();
    });

    it('a regiao do aviso e polite', async () => {
      await digitar('a@b.com');
      expect(
        el().querySelector('[data-teste="aviso-identificacao"]')?.closest('[aria-live="polite"]'),
      ).not.toBeNull();
    });

    it('sem console, storage nem state do router com o trecho', async () => {
      const antes = [localStorage.length, sessionStorage.length];
      const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        spyOn(console, m),
      );
      await digitar('CPF 529.982.247-25 maria@exemplo.com');
      expect([localStorage.length, sessionStorage.length]).toEqual(antes);
      for (const e of espioes) expect(e).not.toHaveBeenCalled();
      expect(JSON.stringify(navegar.calls.allArgs())).not.toContain('529');
    });
  });

  it('se o paciente nao carregar, o detector segue sem o nome e salvar funciona', async () => {
    ctrl.verify();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DocumentoNovoPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: { get: () => PID }, queryParamMap: { get: () => null } },
          },
        },
      ],
    });
    const c = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(DocumentoNovoPage);
    await f.whenStable();
    c.expectOne(URL_PACIENTE).flush({ statusCode: 503 }, { status: 503, statusText: 'x' });
    await f.whenStable();
    const area = f.nativeElement.querySelector('#dc-conteudo') as HTMLTextAreaElement;
    area.value = 'Maria da Silva chegou';
    area.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(f.nativeElement.querySelector('[data-teste="aviso-identificacao"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-teste="paciente"]')).toBeNull();
    c.verify();
  });
});

describe('DocumentoNovoPage (correcao, ?corrige=)', () => {
  const OID = '33333333-3333-4333-8333-333333333333';
  const URL_ORIGINAL = `${URL}/${OID}`;
  const ORIGINAL = {
    id: OID,
    pacienteId: PID,
    tipo: 'ANAMNESE',
    dataSessao: '2026-10-20',
    conteudo: 'Texto aprovado que sera corrigido.',
    status: 'APROVADO',
    criadoEm: '2026-10-20T10:00:00.000Z',
    atualizadoEm: '2026-10-20T10:00:00.000Z',
    aprovadoEm: '2026-10-21T10:00:00.000Z',
    substituiId: null,
    geradoPorIa: false,
    descarteEm: null,
  };
  let fixture: ComponentFixture<DocumentoNovoPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [DocumentoNovoPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => PID },
              queryParamMap: { get: (k: string) => (k === 'corrige' ? OID : null) },
            },
          },
        },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(DocumentoNovoPage);
    await fixture.whenStable();
  });
  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const texto = (sel: string) => el().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const campo = <T extends HTMLElement>(nome: string) => el().querySelector(`#dc-${nome}`) as T;
  const flush = async (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    await fixture.whenStable();
  };
  const abrir = async (original: object = ORIGINAL) => {
    await flush(ctrl.expectOne(URL_ORIGINAL), original);
    await flush(ctrl.expectOne(URL_PACIENTE), PACIENTE);
  };
  const enviar = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  it('busca o aprovado, e so depois o paciente (em sequencia), e mostra carregando sem formulario', async () => {
    expect(texto('[role="status"]')).toBe('Carregando o documento a corrigir…');
    expect(el().querySelector('form')).toBeNull();
    const r = ctrl.expectOne(URL_ORIGINAL);
    expect(r.request.method).toBe('GET');
    ctrl.expectNone(URL_PACIENTE);
    await flush(r, ORIGINAL);
    await flush(ctrl.expectOne(URL_PACIENTE), PACIENTE);
  });

  it('pre-preenche tipo, data e texto so em memoria e mostra o que esta sendo corrigido', async () => {
    await abrir();
    expect(texto('h1')).toBe('Corrigir documento');
    expect(campo<HTMLSelectElement>('tipo').value).toBe('ANAMNESE');
    expect(campo<HTMLInputElement>('dataSessao').value).toBe('2026-10-20');
    expect(campo<HTMLTextAreaElement>('conteudo').value).toBe(ORIGINAL.conteudo);
    expect(texto('[data-teste="corrigindo"]')).toContain('Corrigindo: Anamnese de 20/10/2026');
    expect(texto('[data-teste="contador"]')).toBe('34 de 20.000 caracteres');
    expect(JSON.stringify(fixture.componentInstance.original())).not.toContain('Texto aprovado');
  });

  it('enviar: POST com substituiId e o conteudo do formulario, e volta ao paciente sem texto no state', async () => {
    await abrir();
    const c = campo<HTMLTextAreaElement>('conteudo');
    c.value = 'Texto corrigido pelo psicologo.';
    c.dispatchEvent(new Event('input'));
    await enviar();
    const r = ctrl.expectOne(URL);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({
      tipo: 'ANAMNESE',
      dataSessao: '2026-10-20',
      conteudo: 'Texto corrigido pelo psicologo.',
      substituiId: OID,
    });
    await flush(r, {}, 201);
    expect(navegar).toHaveBeenCalledOnceWith(`/pacientes/${PID}`, {
      state: { aviso: 'documento-criado' },
    });
    expect(JSON.stringify(navegar.calls.allArgs())).not.toContain('Texto');
  });

  it('valida igual ao criar (texto vazio nao envia)', async () => {
    await abrir();
    const c = campo<HTMLTextAreaElement>('conteudo');
    c.value = '   ';
    c.dispatchEvent(new Event('input'));
    await enviar();
    ctrl.expectNone(URL);
    expect(campo('conteudo').getAttribute('aria-invalid')).toBe('true');
  });

  it('o aviso de dado identificavel tambem vale na correcao', async () => {
    await abrir({ ...ORIGINAL, conteudo: 'Maria passou o CPF 529.982.247-25.' });
    expect(texto('[data-teste="aviso-identificacao"]')).toContain('(CPF, nome do paciente)');
  });

  it('original ainda RASCUNHO: explica, nao mostra formulario e oferece link ao documento', async () => {
    await flush(ctrl.expectOne(URL_ORIGINAL), {
      ...ORIGINAL,
      status: 'RASCUNHO',
      aprovadoEm: null,
    });
    expect(texto('[data-teste="erro-original"]')).toContain(
      'Só documento aprovado pode ser corrigido.',
    );
    expect(el().querySelector('form')).toBeNull();
    expect(el().querySelector('[data-teste="erro-original"] a')?.getAttribute('href')).toBe(
      `/pacientes/${PID}/documentos/${OID}`,
    );
    expect(fixture.componentInstance.form.controls.conteudo.value).toBe('');
    await flush(ctrl.expectOne(URL_PACIENTE), PACIENTE);
  });

  it('404 do original: volta ao paciente com o aviso fixo', async () => {
    await flush(ctrl.expectOne(URL_ORIGINAL), { statusCode: 404 }, 404);
    expect(navegar).toHaveBeenCalledOnceWith(`/pacientes/${PID}`, {
      state: { aviso: 'documento-nao-encontrado' },
    });
  });

  it('503 do original: alerta com "Tentar de novo" que refaz a busca', async () => {
    await flush(ctrl.expectOne(URL_ORIGINAL), { statusCode: 503 }, 503);
    expect(texto('[data-teste="erro-original"]')).toContain('Não foi possível carregar');
    expect(el().querySelector('form')).toBeNull();
    (el().querySelector('[data-teste="erro-original"] button') as HTMLButtonElement).click();
    await fixture.whenStable();
    await abrir();
    expect(el().querySelector('form')).not.toBeNull();
  });

  it('409 ao enviar (original mudou): mensagem na tela e o texto digitado e mantido', async () => {
    await abrir();
    await enviar();
    await flush(
      ctrl.expectOne(URL),
      { statusCode: 409, message: 'So documento aprovado pode ser corrigido' },
      409,
    );
    expect(texto('[data-teste="erro-geral"]')).toContain(
      'Só documento aprovado pode ser corrigido.',
    );
    expect(campo<HTMLTextAreaElement>('conteudo').value).toBe(ORIGINAL.conteudo);
    expect(navegar).not.toHaveBeenCalled();
  });

  it('403 sem consentimento: avisa no paciente e limpa o texto', async () => {
    await abrir();
    await enviar();
    await flush(
      ctrl.expectOne(URL),
      { statusCode: 403, message: 'Consentimento nao concedido' },
      403,
    );
    expect(navegar).toHaveBeenCalledOnceWith(`/pacientes/${PID}`, {
      state: { aviso: 'sem-consentimento' },
    });
    expect(campo<HTMLTextAreaElement>('conteudo').value).toBe('');
  });

  it('ao sair o texto do original sai do formulario; nada em storage nem console', async () => {
    const antes = [localStorage.length, sessionStorage.length];
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      spyOn(console, m),
    );
    await abrir();
    expect(fixture.componentInstance.form.controls.conteudo.value).toBe(ORIGINAL.conteudo);
    fixture.destroy();
    expect(fixture.componentInstance.form.controls.conteudo.value).toBe('');
    expect([localStorage.length, sessionStorage.length]).toEqual(antes);
    for (const e of espioes) expect(e).not.toHaveBeenCalled();
  });
});
