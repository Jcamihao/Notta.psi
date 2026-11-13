import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Consentimento } from './consentimento.service';
import { Convite } from './convite-consentimento.service';
import { DocumentoResumo } from '../documentos/documentos.service';
import {
  Evento,
  LinhaDoTempoService,
  PacienteNaoEncontrado,
  agruparPorMes,
  montarLinhaDoTempo,
} from './linha-do-tempo.service';
import { Paciente } from './pacientes.service';

const PID = '11111111-1111-4111-8111-111111111111';
const BASE = `/api/pacientes/${PID}`;

// Datas no fuso local (o agrupamento e pelo fuso do navegador): nao dependem do TZ da maquina.
const local = (ano: number, mes: number, dia: number, hora = 12, min = 0) =>
  new Date(ano, mes - 1, dia, hora, min).toISOString();

const PACIENTE: Paciente = {
  id: PID,
  nome: 'Maria da Silva',
  nascimento: null,
  telefone: null,
  email: null,
  criadoEm: local(2026, 10, 1, 9),
};

const CONSENTIMENTO: Consentimento = {
  estado: 'CONCEDIDO',
  desde: local(2026, 10, 5),
  historico: [
    {
      seq: 1,
      evento: 'CONCEDIDO',
      termoVersao: 'v1-rascunho',
      origem: 'PSICOLOGO',
      em: local(2026, 10, 5, 10),
    },
    {
      seq: 2,
      evento: 'REVOGADO',
      termoVersao: 'v1-rascunho',
      origem: 'PACIENTE',
      em: local(2026, 11, 2, 18),
    },
  ],
};

const convite = (c: Partial<Convite> & Pick<Convite, 'id'>): Convite => ({
  estado: 'PENDENTE',
  expirado: false,
  criadoEm: local(2026, 11, 3, 14),
  expiraEm: local(2026, 11, 10, 14),
  usadoEm: null,
  termoVersao: 'v1-rascunho',
  ...c,
});

const documento = (d: Partial<DocumentoResumo> & Pick<DocumentoResumo, 'id'>): DocumentoResumo => ({
  tipo: 'EVOLUCAO',
  dataSessao: null,
  status: 'APROVADO',
  criadoEm: local(2026, 11, 4, 9),
  aprovadoEm: local(2026, 11, 4, 10),
  substituiId: null,
  geradoPorIa: false,
  descarteEm: null,
  ...d,
});

const entradas = (
  extra: Partial<Parameters<typeof montarLinhaDoTempo>[0]> = {},
): Parameters<typeof montarLinhaDoTempo>[0] => ({
  pacienteId: PID,
  paciente: PACIENTE,
  consentimento: CONSENTIMENTO,
  convites: [],
  aprovados: [],
  rascunhos: [],
  ...extra,
});

// O servico encadeia as chamadas com promises: uma volta do event loop basta para a proxima sair.
const pausa = () => new Promise<void>((r) => setTimeout(r, 0));

describe('montarLinhaDoTempo (funcao pura)', () => {
  it('monta cadastro, consentimento, termos e documentos com os textos certos', () => {
    const eventos = montarLinhaDoTempo(
      entradas({
        convites: [convite({ id: 'c1', estado: 'ACEITO', criadoEm: local(2026, 11, 3, 14) })],
        aprovados: [
          documento({
            id: 'a1',
            tipo: 'ANAMNESE',
            dataSessao: '2026-11-02',
            geradoPorIa: true,
          }),
        ],
        rascunhos: [
          documento({ id: 'r1', tipo: 'NOTA_BRUTA', status: 'RASCUNHO', aprovadoEm: null }),
        ],
      }),
    );
    const achado = (id: string) => eventos.find((e) => e.id === id)!;

    expect(achado('cadastro')).toEqual({
      id: 'cadastro',
      quando: PACIENTE.criadoEm,
      tipo: 'CADASTRO',
      titulo: 'Paciente cadastrado',
    });
    expect(eventos.length).toBe(1 + 2 + 1 + 1 + 1);
  });

  it('consentimento concedido e revogado, com a origem e a versao do termo', () => {
    const eventos = montarLinhaDoTempo(entradas());
    const concedido = eventos.find((e) => e.id === 'consentimento-1')!;
    const revogado = eventos.find((e) => e.id === 'consentimento-2')!;

    expect(concedido.tipo).toBe('CONSENTIMENTO');
    expect(concedido.titulo).toBe('Consentimento concedido');
    expect(concedido.quando).toBe(CONSENTIMENTO.historico[0].em);
    expect(concedido.detalhe).toBe('Registrado pelo psicólogo · Termo v1-rascunho');
    expect(concedido.estado).toBeUndefined();

    expect(revogado.titulo).toBe('Consentimento revogado');
    expect(revogado.detalhe).toBe('Aceito pelo paciente por link · Termo v1-rascunho');
  });

  it('termo enviado por link usa o mesmo rotulo e tom da lista de convites, em cada estado', () => {
    const casos: [Partial<Convite>, string, 'pink' | 'blue' | 'yellow'][] = [
      [{ estado: 'PENDENTE', expirado: false }, 'Pendente', 'yellow'],
      [{ estado: 'PENDENTE', expirado: true }, 'Expirado', 'yellow'],
      [{ estado: 'ACEITO' }, 'Aceito', 'blue'],
      [{ estado: 'RECUSADO' }, 'Recusado', 'pink'],
      [{ estado: 'CANCELADO' }, 'Cancelado', 'yellow'],
    ];
    for (const [parcial, texto, tom] of casos) {
      const [ev] = montarLinhaDoTempo(
        entradas({ convites: [convite({ id: 'x', ...parcial })] }),
      ).filter((e) => e.tipo === 'TERMO');
      expect(ev.titulo).toBe('Termo enviado por link');
      expect(ev.quando).toBe(local(2026, 11, 3, 14));
      expect(ev.estado).withContext(texto).toEqual({ texto, tom });
    }
  });

  it('documento aprovado: data da aprovacao, "Sessão de" so com dataSessao, status, IA e link', () => {
    const [com, sem] = montarLinhaDoTempo(
      entradas({
        aprovados: [
          documento({ id: 'a1', tipo: 'EVOLUCAO', dataSessao: '2026-11-02', geradoPorIa: true }),
          documento({ id: 'a2', tipo: 'NOTA_BRUTA', dataSessao: null, geradoPorIa: false }),
        ],
      }),
    ).filter((e) => e.tipo === 'DOCUMENTO');

    expect(com.titulo).toBe('Evolução aprovada');
    expect(com.quando).toBe(local(2026, 11, 4, 10));
    expect(com.detalhe).toBe('Sessão de 02/11/2026');
    expect(com.estado).toEqual({ texto: 'Aprovado', tom: 'blue' });
    expect(com.ia).toBeTrue();
    expect(com.link).toEqual(['/pacientes', PID, 'documentos', 'a1']);

    expect(sem.titulo).toBe('Nota bruta aprovada');
    expect(sem.detalhe).toBeUndefined();
    expect(sem.ia).toBeFalse();
  });

  it('rascunho entra pela data de criacao, com o tipo em minusculas e pilula Rascunho', () => {
    const [ev] = montarLinhaDoTempo(
      entradas({
        rascunhos: [
          documento({
            id: 'r1',
            tipo: 'ANAMNESE',
            status: 'RASCUNHO',
            aprovadoEm: null,
            criadoEm: local(2026, 11, 6, 8),
            dataSessao: '2026-11-05',
          }),
        ],
      }),
    ).filter((e) => e.tipo === 'DOCUMENTO');
    expect(ev.titulo).toBe('Rascunho de anamnese');
    expect(ev.quando).toBe(local(2026, 11, 6, 8));
    expect(ev.estado).toEqual({ texto: 'Rascunho', tom: 'yellow' });
    expect(ev.detalhe).toBe('Sessão de 05/11/2026');
    expect(ev.link).toEqual(['/pacientes', PID, 'documentos', 'r1']);
  });

  it('nunca carrega texto clinico: o evento so tem os campos do contrato', () => {
    const eventos = montarLinhaDoTempo(
      entradas({
        aprovados: [{ ...documento({ id: 'a1' }), conteudo: 'TEXTO SIGILOSO' } as DocumentoResumo],
      }),
    );
    expect(JSON.stringify(eventos)).not.toContain('TEXTO SIGILOSO');
  });

  it('ordena do mais recente para o mais antigo', () => {
    const eventos = montarLinhaDoTempo(
      entradas({
        convites: [convite({ id: 'c1', criadoEm: local(2026, 11, 3, 14) })],
        rascunhos: [documento({ id: 'r1', status: 'RASCUNHO', criadoEm: local(2026, 11, 9) })],
      }),
    );
    const datas = eventos.map((e) => Date.parse(e.quando));
    expect(datas).toEqual([...datas].sort((a, b) => b - a));
    expect(eventos[0].id).toBe('rascunho-r1');
    expect(eventos[eventos.length - 1].id).toBe('cadastro');
  });

  it('empate de data mantem a ordem de entrada', () => {
    const mesmo = local(2026, 11, 4, 10);
    const eventos = montarLinhaDoTempo(
      entradas({
        consentimento: { historico: [] },
        aprovados: [
          documento({ id: 'primeiro', aprovadoEm: mesmo }),
          documento({ id: 'segundo', aprovadoEm: mesmo }),
        ],
        rascunhos: [],
        paciente: { criadoEm: mesmo },
      }),
    );
    // Os tres com a mesma data ficam juntos, na ordem em que entraram (cadastro, depois aprovados).
    expect(eventos.map((e) => e.id)).toEqual(['cadastro', 'aprovado-primeiro', 'aprovado-segundo']);
  });

  it('data invalida ou ausente vai para o fim, sem quebrar, e mantem a ordem entre elas', () => {
    const eventos = montarLinhaDoTempo(
      entradas({
        aprovados: [
          documento({ id: 'sem-data', aprovadoEm: null }),
          documento({ id: 'ruim', aprovadoEm: 'nao-e-data' }),
          documento({ id: 'ok', aprovadoEm: local(2026, 11, 4) }),
        ],
      }),
    );
    // As duas invalidas ficam no fim, na ordem de entrada; a valida (4/11) vem antes de todas.
    expect(eventos.slice(-2).map((e) => e.id)).toEqual(['aprovado-sem-data', 'aprovado-ruim']);
    expect(eventos[0].id).toBe('aprovado-ok');
  });
});

describe('agruparPorMes (funcao pura)', () => {
  const ev = (id: string, quando: string): Evento => ({
    id,
    quando,
    tipo: 'DOCUMENTO',
    titulo: id,
  });

  it('rotulo do mes em portugues, pelo fuso local', () => {
    const grupos = agruparPorMes([ev('a', local(2026, 11, 13))]);
    expect(grupos.map((g) => g.rotulo)).toEqual(['novembro de 2026']);
    expect(grupos[0].eventos.map((e) => e.id)).toEqual(['a']);
  });

  it('virada de mes: 31/10 a noite e 01/11 de manha ficam em meses diferentes', () => {
    const grupos = agruparPorMes([
      ev('nov', local(2026, 11, 1, 9)),
      ev('out', local(2026, 10, 31, 23)),
    ]);
    expect(grupos.map((g) => g.rotulo)).toEqual(['novembro de 2026', 'outubro de 2026']);
  });

  it('virada de ano: 31/12/2025 e 01/01/2026 viram grupos separados', () => {
    const grupos = agruparPorMes([
      ev('jan', local(2026, 1, 1, 9)),
      ev('dez', local(2025, 12, 31, 20)),
    ]);
    expect(grupos.map((g) => g.rotulo)).toEqual(['janeiro de 2026', 'dezembro de 2025']);
  });

  it('janeiro e o primeiro mes do ano; eventos do mesmo mes ficam juntos e na ordem', () => {
    const grupos = agruparPorMes([ev('x', local(2026, 1, 20)), ev('y', local(2026, 1, 3))]);
    expect(grupos.length).toBe(1);
    expect(grupos[0].rotulo).toBe('janeiro de 2026');
    expect(grupos[0].eventos.map((e) => e.id)).toEqual(['x', 'y']);
  });

  it('data invalida vai para um grupo proprio no fim', () => {
    const grupos = agruparPorMes([ev('ok', local(2026, 11, 4)), ev('ruim', 'nao-e-data')]);
    expect(grupos.map((g) => g.rotulo)).toEqual(['novembro de 2026', 'Data não informada']);
    expect(grupos[1].eventos.map((e) => e.id)).toEqual(['ruim']);
  });

  it('lista vazia nao tem grupos', () => {
    expect(agruparPorMes([])).toEqual([]);
  });
});

describe('LinhaDoTempoService', () => {
  let servico: LinhaDoTempoService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servico = TestBed.inject(LinhaDoTempoService);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('faz as 5 leituras em sequencia: a proxima so sai depois que a anterior termina', async () => {
    const resultado = servico.carregar(PID);

    ctrl.expectOne(BASE).flush(PACIENTE);
    ctrl.expectNone(() => true);
    await pausa();

    ctrl.expectOne(`${BASE}/consentimento`).flush(CONSENTIMENTO);
    ctrl.expectNone(() => true);
    await pausa();

    ctrl.expectOne(`${BASE}/convites-consentimento`).flush([]);
    ctrl.expectNone(() => true);
    await pausa();

    ctrl.expectOne(`${BASE}/documentos?status=APROVADO`).flush([]);
    ctrl.expectNone(() => true);
    await pausa();

    ctrl.expectOne(`${BASE}/documentos?status=RASCUNHO`).flush([]);
    ctrl.expectNone(() => true);

    const { nome, eventos } = await resultado;
    expect(nome).toBe('Maria da Silva');
    expect(eventos.map((e) => e.id)).toEqual(['consentimento-2', 'consentimento-1', 'cadastro']);
  });

  it('nunca ha mais de uma requisicao pendente ao mesmo tempo', async () => {
    const resultado = servico.carregar(PID);
    const pendentes = () => ctrl.match(() => true);
    // Enquanto a primeira espera resposta, nenhuma das outras existe ainda.
    const primeira = ctrl.expectOne(BASE);
    ctrl.expectNone(() => true);
    primeira.flush(PACIENTE);
    await pausa();
    const segunda = ctrl.expectOne(`${BASE}/consentimento`);
    ctrl.expectNone(() => true);
    segunda.flush(CONSENTIMENTO);
    await pausa();
    ctrl.expectOne(`${BASE}/convites-consentimento`).flush([]);
    await pausa();
    ctrl.expectOne(`${BASE}/documentos?status=APROVADO`).flush([]);
    await pausa();
    ctrl.expectOne(`${BASE}/documentos?status=RASCUNHO`).flush([]);
    await resultado;
    expect(pendentes().length).toBe(0);
  });

  it('erro em qualquer etapa propaga e nao dispara as seguintes', async () => {
    const resultado = servico.carregar(PID).catch((e: unknown) => e);
    ctrl.expectOne(BASE).flush(PACIENTE);
    await pausa();
    ctrl.expectOne(`${BASE}/consentimento`).flush(CONSENTIMENTO);
    await pausa();
    ctrl
      .expectOne(`${BASE}/convites-consentimento`)
      .flush({ mensagem: 'corpo sigiloso' }, { status: 500, statusText: 'Erro' });
    ctrl.expectNone(() => true);
    const erro = await resultado;
    expect(erro).toBeInstanceOf(HttpErrorResponse);
    expect((erro as HttpErrorResponse).status).toBe(500);
    expect(erro instanceof PacienteNaoEncontrado).toBeFalse();
  });

  it('erro de documentos (RASCUNHO) tambem propaga', async () => {
    const resultado = servico.carregar(PID).catch((e: unknown) => e);
    ctrl.expectOne(BASE).flush(PACIENTE);
    await pausa();
    ctrl.expectOne(`${BASE}/consentimento`).flush(CONSENTIMENTO);
    await pausa();
    ctrl.expectOne(`${BASE}/convites-consentimento`).flush([]);
    await pausa();
    ctrl.expectOne(`${BASE}/documentos?status=APROVADO`).flush([]);
    await pausa();
    ctrl.expectOne(`${BASE}/documentos?status=RASCUNHO`).flush(null, {
      status: 503,
      statusText: 'Indisponível',
    });
    const erro = await resultado;
    expect(erro).toBeInstanceOf(HttpErrorResponse);
    expect((erro as HttpErrorResponse).status).toBe(503);
  });

  it('404 do paciente vira PacienteNaoEncontrado, distinguivel de outras falhas', async () => {
    const resultado = servico.carregar(PID).catch((e: unknown) => e);
    ctrl.expectOne(BASE).flush(null, { status: 404, statusText: 'Não encontrado' });
    ctrl.expectNone(() => true);
    expect(await resultado).toBeInstanceOf(PacienteNaoEncontrado);
  });

  it('404 de outra etapa NAO e tratado como paciente inexistente', async () => {
    const resultado = servico.carregar(PID).catch((e: unknown) => e);
    ctrl.expectOne(BASE).flush(PACIENTE);
    await pausa();
    ctrl.expectOne(`${BASE}/consentimento`).flush(null, { status: 404, statusText: 'x' });
    const erro = await resultado;
    expect(erro instanceof PacienteNaoEncontrado).toBeFalse();
  });
});
