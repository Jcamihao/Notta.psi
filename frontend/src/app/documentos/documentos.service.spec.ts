import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Documento, DocumentoResumo, DocumentosService } from './documentos.service';

const PID = '11111111-1111-4111-8111-111111111111';
const DID = '22222222-2222-4222-8222-222222222222';
const URL = `/api/pacientes/${PID}/documentos`;

const COMPLETO: Documento = {
  id: DID,
  pacienteId: PID,
  tipo: 'EVOLUCAO',
  dataSessao: '2026-11-02',
  conteudo: 'texto',
  status: 'RASCUNHO',
  criadoEm: '2026-11-03T10:00:00.000Z',
  aprovadoEm: null,
  substituiId: null,
  geradoPorIa: false,
  descarteEm: '2026-11-10T10:00:00.000Z',
  atualizadoEm: '2026-11-03T10:00:00.000Z',
};

describe('DocumentosService', () => {
  let servico: DocumentosService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servico = TestBed.inject(DocumentosService);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  it('criar: POST no corpo so com tipo, dataSessao e conteudo', () => {
    let got: Documento | undefined;
    servico
      .criar(PID, { tipo: 'EVOLUCAO', dataSessao: '2026-11-02', conteudo: 'texto' })
      .subscribe((d) => (got = d));
    const r = ctrl.expectOne(URL);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({
      tipo: 'EVOLUCAO',
      dataSessao: '2026-11-02',
      conteudo: 'texto',
    });
    r.flush(COMPLETO, { status: 201, statusText: 'Created' });
    expect(got).toEqual(COMPLETO);
  });

  it('listar: GET so de metadados, sempre com o filtro de status', () => {
    let got: DocumentoResumo[] | undefined;
    servico.listar(PID, 'APROVADO').subscribe((l) => (got = l));
    const r = ctrl.expectOne(`${URL}?status=APROVADO`);
    expect(r.request.method).toBe('GET');
    const lista: DocumentoResumo[] = [
      {
        id: DID,
        tipo: 'ANAMNESE',
        dataSessao: null,
        status: 'APROVADO',
        criadoEm: 'x',
        aprovadoEm: 'y',
        substituiId: null,
        geradoPorIa: false,
        descarteEm: null,
      },
    ];
    r.flush(lista);
    expect(got).toEqual(lista);
  });

  it('listar RASCUNHO usa ?status=RASCUNHO', () => {
    servico.listar(PID, 'RASCUNHO').subscribe();
    ctrl.expectOne(`${URL}?status=RASCUNHO`).flush([]);
  });

  it('criar de correcao envia substituiId', () => {
    servico.criar(PID, { tipo: 'EVOLUCAO', conteudo: 'x', substituiId: DID }).subscribe();
    const r = ctrl.expectOne(URL);
    expect(r.request.body).toEqual({ tipo: 'EVOLUCAO', conteudo: 'x', substituiId: DID });
    r.flush(COMPLETO);
  });

  it('atualizar: PATCH /:id com o corpo parcial recebido, sem acrescentar campos', () => {
    let got: Documento | undefined;
    servico.atualizar(PID, DID, { conteudo: 'novo' }).subscribe((d) => (got = d));
    const r = ctrl.expectOne(`${URL}/${DID}`);
    expect(r.request.method).toBe('PATCH');
    expect(r.request.body).toEqual({ conteudo: 'novo' });
    r.flush({ ...COMPLETO, conteudo: 'novo' });
    expect(got?.conteudo).toBe('novo');
  });

  it('atualizar: dataSessao null vai no corpo (apaga a data)', () => {
    servico.atualizar(PID, DID, { dataSessao: null }).subscribe();
    const r = ctrl.expectOne(`${URL}/${DID}`);
    expect(r.request.body).toEqual({ dataSessao: null });
    r.flush(COMPLETO);
  });

  it('aprovar: POST /:id/aprovar sem corpo', () => {
    let got: Documento | undefined;
    servico.aprovar(PID, DID).subscribe((d) => (got = d));
    const r = ctrl.expectOne(`${URL}/${DID}/aprovar`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toBeNull();
    r.flush({ ...COMPLETO, status: 'APROVADO', aprovadoEm: '2026-11-04T01:00:00.000Z' });
    expect(got?.status).toBe('APROVADO');
  });

  it('obter: GET /:id com o corpo completo', () => {
    let got: Documento | undefined;
    servico.obter(PID, DID).subscribe((d) => (got = d));
    const r = ctrl.expectOne(`${URL}/${DID}`);
    expect(r.request.method).toBe('GET');
    r.flush(COMPLETO);
    expect(got).toEqual(COMPLETO);
  });
});
