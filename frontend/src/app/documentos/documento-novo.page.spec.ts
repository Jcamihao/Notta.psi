import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { hojeLocal } from '../core/formulario';
import { DocumentoNovoPage } from './documento-novo.page';

const PID = '11111111-1111-4111-8111-111111111111';
const URL = `/api/pacientes/${PID}/documentos`;
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
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => PID } } } },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(DocumentoNovoPage);
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

  it('nao chama a API ao abrir; titulo, labels e opcoes dos tres tipos', () => {
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
});
