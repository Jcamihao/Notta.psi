import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { DocumentoLeituraPage } from './documento-leitura.page';
import { Documento } from './documentos.service';

const PID = '11111111-1111-4111-8111-111111111111';
const DID = '22222222-2222-4222-8222-222222222222';
const URL = `/api/pacientes/${PID}/documentos/${DID}`;
const DOC: Documento = {
  id: DID,
  pacienteId: PID,
  tipo: 'EVOLUCAO',
  dataSessao: '2026-11-02',
  conteudo: 'Linha 1\nLinha 2\n\n<b>nao e html</b> <img src=x onerror=alert(1)>',
  status: 'RASCUNHO',
  criadoEm: '2026-11-03T13:00:00.000Z',
  atualizadoEm: '2026-11-03T13:00:00.000Z',
};

describe('DocumentoLeituraPage', () => {
  let fixture: ComponentFixture<DocumentoLeituraPage>;
  let ctrl: HttpTestingController;
  let navegar: jasmine.Spy;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [DocumentoLeituraPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: { get: (k: string) => (k === 'id' ? PID : DID) } },
          },
        },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    navegar = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(DocumentoLeituraPage);
    await fixture.whenStable();
  });
  afterEach(() => ctrl.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const texto = (sel: string) => el().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const flush = async (r: TestRequest, corpo: object, status = 200) => {
    r.flush(corpo, { status, statusText: 'x' });
    await fixture.whenStable();
  };

  it('uma chamada so (GET do documento) e mostra carregando', async () => {
    expect(texto('[role="status"]')).toBe('Carregando o documento…');
    const r = ctrl.expectOne(URL);
    expect(r.request.method).toBe('GET');
    await flush(r, DOC);
  });

  it('mostra tipo, status em pill com texto, data da sessao e criado em', async () => {
    await flush(ctrl.expectOne(URL), DOC);
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
    await flush(ctrl.expectOne(URL), { ...DOC, dataSessao: null });
    expect(texto('dl')).toContain('Não informada');
  });

  it('preserva quebras de linha (pre-wrap) e mostra o texto exato', async () => {
    await flush(ctrl.expectOne(URL), DOC);
    const p = el().querySelector('[data-teste="texto"]') as HTMLElement;
    expect(p.textContent).toBe(DOC.conteudo);
    expect(getComputedStyle(p).whiteSpace).toBe('pre-wrap');
  });

  it('nunca interpreta o texto como HTML', async () => {
    await flush(ctrl.expectOne(URL), DOC);
    const p = el().querySelector('[data-teste="texto"]') as HTMLElement;
    expect(p.querySelector('b, img')).toBeNull();
    expect(p.children.length).toBe(0);
  });

  it('nao tem campo de edicao nem botao de salvar', async () => {
    await flush(ctrl.expectOne(URL), DOC);
    expect(el().querySelector('textarea, input, select, form')).toBeNull();
  });

  it('link para voltar ao paciente', async () => {
    await flush(ctrl.expectOne(URL), DOC);
    expect(el().querySelector('a')?.getAttribute('href')).toBe(`/pacientes/${PID}`);
  });

  it('404: volta ao paciente com o aviso fixo, sem mostrar texto', async () => {
    await flush(ctrl.expectOne(URL), { statusCode: 404, message: 'Documento nao encontrado' }, 404);
    expect(navegar).toHaveBeenCalledWith(`/pacientes/${PID}`, {
      state: { aviso: 'documento-nao-encontrado' },
    });
    expect(el().querySelector('[data-teste="texto"]')).toBeNull();
  });

  it('503/rede/400: alerta com "Tentar de novo", sem navegar; refaz a chamada', async () => {
    await flush(ctrl.expectOne(URL), { statusCode: 503 }, 503);
    expect(texto('[role="alert"]')).toContain('Não foi possível carregar o documento');
    expect(navegar).not.toHaveBeenCalled();
    (el().querySelector('[role="alert"] button') as HTMLButtonElement).click();
    await fixture.whenStable();
    await flush(ctrl.expectOne(URL), DOC);
    expect(el().querySelector('[data-teste="texto"]')).not.toBeNull();
  });

  it('ao sair da pagina o texto sai da memoria', async () => {
    await flush(ctrl.expectOne(URL), DOC);
    expect(fixture.componentInstance.documento()).not.toBeNull();
    fixture.destroy();
    expect(fixture.componentInstance.documento()).toBeNull();
  });

  it('nao guarda nada em localStorage nem sessionStorage e nao poe texto no console', async () => {
    const antes = [localStorage.length, sessionStorage.length];
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      spyOn(console, m),
    );
    await flush(ctrl.expectOne(URL), DOC);
    expect([localStorage.length, sessionStorage.length]).toEqual(antes);
    for (const e of espioes) expect(e).not.toHaveBeenCalled();
  });
});
