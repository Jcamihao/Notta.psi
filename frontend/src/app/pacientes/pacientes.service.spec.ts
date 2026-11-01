import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Paciente, PacientesService } from './pacientes.service';

const P: Paciente = {
  id: '11111111-1111-4111-8111-111111111111',
  nome: 'Maria',
  nascimento: null,
  telefone: null,
  email: null,
  criadoEm: '2026-10-31T10:00:00.000Z',
};

describe('PacientesService', () => {
  let servico: PacientesService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servico = TestBed.inject(PacientesService);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  it('listar: GET /api/pacientes', () => {
    let got: Paciente[] = [];
    servico.listar().subscribe((l) => (got = l));
    const r = ctrl.expectOne('/api/pacientes');
    expect(r.request.method).toBe('GET');
    r.flush([P]);
    expect(got).toEqual([P]);
  });

  it('obter: GET /api/pacientes/:id', () => {
    servico.obter(P.id).subscribe();
    const r = ctrl.expectOne(`/api/pacientes/${P.id}`);
    expect(r.request.method).toBe('GET');
    r.flush(P);
  });

  it('criar: POST /api/pacientes com o corpo dado', () => {
    servico.criar({ nome: 'Maria', telefone: '11 99999-0000' }).subscribe();
    const r = ctrl.expectOne('/api/pacientes');
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ nome: 'Maria', telefone: '11 99999-0000' });
    r.flush(P);
  });

  it('atualizar: PATCH /api/pacientes/:id mandando null para limpar', () => {
    servico
      .atualizar(P.id, { nome: 'Maria', nascimento: null, telefone: null, email: null })
      .subscribe();
    const r = ctrl.expectOne(`/api/pacientes/${P.id}`);
    expect(r.request.method).toBe('PATCH');
    expect(r.request.body).toEqual({
      nome: 'Maria',
      nascimento: null,
      telefone: null,
      email: null,
    });
    r.flush(P);
  });
});
