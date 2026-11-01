import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Consentimento, ConsentimentoService } from './consentimento.service';

const ID = '11111111-1111-4111-8111-111111111111';
const C: Consentimento = {
  estado: 'CONCEDIDO',
  desde: '2026-11-01T14:00:00.000Z',
  historico: [
    { seq: 1, evento: 'CONCEDIDO', termoVersao: 'provisorio-1', em: '2026-11-01T14:00:00.000Z' },
  ],
};

describe('ConsentimentoService', () => {
  let servico: ConsentimentoService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servico = TestBed.inject(ConsentimentoService);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  it('obter: GET /api/pacientes/:id/consentimento', () => {
    let got: Consentimento | undefined;
    servico.obter(ID).subscribe((c) => (got = c));
    const r = ctrl.expectOne(`/api/pacientes/${ID}/consentimento`);
    expect(r.request.method).toBe('GET');
    r.flush(C);
    expect(got).toEqual(C);
  });

  it('registrar: POST com so o evento no corpo', () => {
    let got: Consentimento | undefined;
    servico.registrar(ID, 'REVOGADO').subscribe((c) => (got = c));
    const r = ctrl.expectOne(`/api/pacientes/${ID}/consentimento`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ evento: 'REVOGADO' });
    r.flush(C, { status: 201, statusText: 'Created' });
    expect(got).toEqual(C);
  });
});
