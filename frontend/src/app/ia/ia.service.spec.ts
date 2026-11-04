import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { classificarErroConfirmar, IaService, mensagemMotivo, Previa, UsoIa } from './ia.service';

const PID = '11111111-1111-4111-8111-111111111111';
const OID = '33333333-3333-4333-8333-333333333333';
const GID = '44444444-4444-4444-8444-444444444444';

const erro = (status: number, error: unknown = null) =>
  new HttpErrorResponse({ status, error, headers: new HttpHeaders() });

describe('IaService', () => {
  let servico: IaService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servico = TestBed.inject(IaService);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  it('uso: GET /api/ia/uso', () => {
    let got: UsoIa | undefined;
    servico.uso().subscribe((u) => (got = u));
    const r = ctrl.expectOne('/api/ia/uso');
    expect(r.request.method).toBe('GET');
    r.flush({ habilitada: true, limite: 20, usadas: 3, renovaEm: '2026-11-05T03:00:00.000Z' });
    expect(got?.usadas).toBe(3);
  });

  it('previa: POST com tipo e termos extras, sem texto', () => {
    let got: Previa | undefined;
    servico.previa(PID, OID, 'EVOLUCAO', ['Joana']).subscribe((p) => (got = p));
    const r = ctrl.expectOne(`/api/pacientes/${PID}/documentos/${OID}/previa-ia`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ tipoDocumento: 'EVOLUCAO', termosExtras: ['Joana'] });
    r.flush({
      id: GID,
      estado: 'PREVIA',
      tipoDocumento: 'EVOLUCAO',
      textoAnonimizado: 'x',
      expiraEm: 'y',
    });
    expect(got?.id).toBe(GID);
  });

  it('previa sem termos: nao manda termosExtras', () => {
    servico.previa(PID, OID, 'ANAMNESE', []).subscribe();
    const r = ctrl.expectOne(`/api/pacientes/${PID}/documentos/${OID}/previa-ia`);
    expect(r.request.body).toEqual({ tipoDocumento: 'ANAMNESE' });
    r.flush({});
  });

  it('confirmar: POST sem corpo (o cliente nunca reenvia texto)', () => {
    servico.confirmar(GID).subscribe();
    const r = ctrl.expectOne(`/api/geracoes-ia/${GID}/confirmar`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toBeNull();
    r.flush({ id: GID, estado: 'PENDENTE' }, { status: 202, statusText: 'Accepted' });
  });

  it('consultar e listar: GET', () => {
    servico.consultar(GID).subscribe();
    const c = ctrl.expectOne(`/api/geracoes-ia/${GID}`);
    expect(c.request.method).toBe('GET');
    c.flush({});
    servico.listar(PID).subscribe();
    const l = ctrl.expectOne(`/api/pacientes/${PID}/geracoes-ia`);
    expect(l.request.method).toBe('GET');
    l.flush([]);
  });

  describe('classificarErroConfirmar', () => {
    it('409 de previa expirada', () => {
      expect(
        classificarErroConfirmar(erro(409, { message: 'Previa expirada, gere outra' })),
      ).toEqual({
        tipo: 'expirada',
      });
    });

    it('409 de falha de configuracao: texto, sem botao de tentar', () => {
      const r = classificarErroConfirmar(
        erro(409, { message: 'Falha de configuracao da IA, avise o suporte' }),
      );
      expect(r.tipo).toBe('texto');
      expect(r.tipo === 'texto' && r.texto).toContain('Avise o suporte');
    });

    it('429 do limite diario usa o corpo (hora de renovar)', () => {
      const r = classificarErroConfirmar(
        erro(429, {
          mensagem: 'Limite diario de geracoes por IA atingido',
          limite: 20,
          usadas: 20,
          renovaEm: '2026-11-05T03:00:00.000Z',
        }),
      );
      expect(r.tipo === 'texto' && r.texto).toMatch(
        /^Limite diário de gerações atingido; renova em 05\/11\/2026, \d{2}:\d{2}\.$/,
      );
    });

    it('429 de geracao em andamento', () => {
      expect(
        classificarErroConfirmar(erro(429, { message: 'Ja ha uma geracao em andamento' })),
      ).toEqual({ tipo: 'andamento' });
    });

    it('429 de outro tipo (throttle) cai na mensagem geral', () => {
      const r = classificarErroConfirmar(erro(429, { message: 'ThrottlerException' }));
      expect(r.tipo === 'texto' && r.texto).toContain('Muitas tentativas');
    });

    it('404, 503 e erro de rede', () => {
      expect(classificarErroConfirmar(erro(404)).tipo).toBe('sumiu');
      const r503 = classificarErroConfirmar(erro(503, { message: 'IA indisponivel' }));
      expect(r503.tipo === 'texto' && r503.texto).toBe('A IA está desligada neste ambiente.');
      const rede = classificarErroConfirmar(erro(0));
      expect(rede.tipo === 'texto' && rede.texto).toContain('Confira sua conexão');
    });
  });

  it('mensagemMotivo: cada motivo conhecido tem texto proprio; desconhecido cai no padrao', () => {
    const motivos = [
      'TIMEOUT',
      'REDE',
      'LIMITE',
      'ERRO_DA_IA',
      'RESPOSTA_INVALIDA',
      'SAIDA_INVALIDA',
      'TEMPO_ESGOTADO',
      'ERRO_INTERNO',
    ];
    const textos = motivos.map(mensagemMotivo);
    expect(new Set(textos).size).toBe(motivos.length);
    expect(textos.every((t) => !t.includes('_'))).toBeTrue();
    expect(mensagemMotivo('NOVO_MOTIVO')).toBe('Não foi possível gerar o rascunho.');
    expect(mensagemMotivo(null)).toBe('Não foi possível gerar o rascunho.');
  });
});
