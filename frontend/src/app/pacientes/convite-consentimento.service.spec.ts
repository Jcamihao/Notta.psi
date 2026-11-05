import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  Convite,
  ConviteConsentimentoService,
  ConviteCriado,
  convitePendenteVivo,
  rotuloConvite,
} from './convite-consentimento.service';

const ID = '11111111-1111-4111-8111-111111111111';
const CONVITE = '22222222-2222-4222-8222-222222222222';
const BASE = `/api/pacientes/${ID}/convites-consentimento`;

describe('ConviteConsentimentoService', () => {
  let servico: ConviteConsentimentoService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servico = TestBed.inject(ConviteConsentimentoService);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  it('criar: POST sem dados no corpo e devolve o link', () => {
    let got: ConviteCriado | undefined;
    servico.criar(ID).subscribe((c) => (got = c));
    const r = ctrl.expectOne(BASE);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({});
    const criado = { id: CONVITE, link: 'http://x/termo/t', expiraEm: '2026-11-10T10:00:00.000Z' };
    r.flush(criado, { status: 201, statusText: 'Created' });
    expect(got).toEqual(criado);
  });

  it('listar: GET na mesma rota', () => {
    let got: Convite[] | undefined;
    servico.listar(ID).subscribe((l) => (got = l));
    const r = ctrl.expectOne(BASE);
    expect(r.request.method).toBe('GET');
    r.flush([]);
    expect(got).toEqual([]);
  });

  it('cancelar: POST em /:id/cancelar sem corpo util', () => {
    servico.cancelar(ID, CONVITE).subscribe();
    const r = ctrl.expectOne(`${BASE}/${CONVITE}/cancelar`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({});
    r.flush({ id: CONVITE, estado: 'CANCELADO' });
  });

  it('rotuloConvite: "Expirado" sai de PENDENTE + expirado, os outros seguem o estado', () => {
    expect(rotuloConvite({ estado: 'PENDENTE', expirado: false })).toBe('Pendente');
    expect(rotuloConvite({ estado: 'PENDENTE', expirado: true })).toBe('Expirado');
    expect(rotuloConvite({ estado: 'ACEITO', expirado: false })).toBe('Aceito');
    expect(rotuloConvite({ estado: 'RECUSADO', expirado: false })).toBe('Recusado');
    expect(rotuloConvite({ estado: 'CANCELADO', expirado: false })).toBe('Cancelado');
  });

  it('convitePendenteVivo: so PENDENTE nao expirado', () => {
    expect(convitePendenteVivo({ estado: 'PENDENTE', expirado: false })).toBeTrue();
    expect(convitePendenteVivo({ estado: 'PENDENTE', expirado: true })).toBeFalse();
    expect(convitePendenteVivo({ estado: 'ACEITO', expirado: false })).toBeFalse();
  });
});
