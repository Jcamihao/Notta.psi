import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TermoPublico, TermoService } from './termo.service';

const TOKEN = 'abc_DEF-123';
const BASE = `/api/publico/consentimento/${TOKEN}`;
const TERMO: TermoPublico = {
  clinica: 'Clinica Demo',
  psicologo: 'Dra. Ana',
  termo: { versao: 'v1-rascunho', texto: 'linha 1\nlinha 2' },
  expiraEm: '2026-11-10T10:00:00.000Z',
};

describe('TermoService', () => {
  let servico: TermoService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servico = TestBed.inject(TermoService);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  it('abrir: GET /api/publico/consentimento/:token', () => {
    let got: TermoPublico | undefined;
    servico.abrir(TOKEN).subscribe((t) => (got = t));
    const r = ctrl.expectOne(BASE);
    expect(r.request.method).toBe('GET');
    r.flush(TERMO);
    expect(got).toEqual(TERMO);
  });

  it('aceitar: POST /aceitar com {aceito: true}', () => {
    servico.aceitar(TOKEN).subscribe();
    const r = ctrl.expectOne(`${BASE}/aceitar`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ aceito: true });
    r.flush({ ok: true });
  });

  it('recusar: POST /recusar sem dados', () => {
    servico.recusar(TOKEN).subscribe();
    const r = ctrl.expectOne(`${BASE}/recusar`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({});
    r.flush({ ok: true });
  });

  it('o token vai codificado no caminho (nunca no corpo nem na query)', () => {
    servico.abrir('a/b?c').subscribe();
    const r = ctrl.expectOne('/api/publico/consentimento/a%2Fb%3Fc');
    expect(r.request.params.keys().length).toBe(0);
    r.flush(TERMO);
  });
});
