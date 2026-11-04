import { Logger } from '@nestjs/common';
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { TextoIaInvalidoError } from './anonimizador';
import { IaConfig } from './ia.config';
import {
  IaDesabilitadaError,
  IaIndisponivelError,
  IaRecusadaError,
  PedidoRascunho,
  SelahIaClient,
} from './selahia.client';

const CHAVE = 'chave-secreta-do-selahia-zQ81xK';
const TEXTO = 'TEXTO-CLINICO-ANONIMIZADO [PACIENTE] relatou algo sigiloso';
const CORPO_SECRETO = 'CORPO-DA-RESPOSTA-SECRETO';
const pedido: PedidoRascunho = {
  tipoDocumento: 'evolucao',
  abordagem: 'TCC',
  textoAnonimizado: TEXTO,
};

type Tratador = (
  req: IncomingMessage,
  res: ServerResponse,
  corpo: string,
) => void;

let server: Server;
let porta: number;
let tratador: Tratador;
let chamadas: {
  url?: string;
  method?: string;
  headers: IncomingMessage['headers'];
  corpo: string;
}[];

const responder =
  (status: number, corpo: string, tipo = 'application/json'): Tratador =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': tipo });
    res.end(corpo);
  };
const ok = (extra: Record<string, unknown> = {}) =>
  responder(
    200,
    JSON.stringify({
      provider: 'gemini',
      version: '2.7.9',
      model: 'gemini-x',
      generatedAt: '2026-11-05T00:00:00Z',
      rascunho: 'Rascunho gerado',
      ...extra,
    }),
  );

beforeEach(async () => {
  Logger.overrideLogger(false);
  chamadas = [];
  tratador = ok();
  server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c: Buffer) => (corpo += c.toString()));
    req.on('end', () => {
      chamadas.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        corpo,
      });
      tratador(req, res, corpo);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  porta = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  jest.restoreAllMocks();
});

const cliente = (extra: Partial<IaConfig> = {}) =>
  new SelahIaClient({
    habilitada: true,
    url: `http://127.0.0.1:${porta}`,
    apiKey: CHAVE,
    timeoutMs: 2000,
    ...extra,
  });

async function falha(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as Error & {
      retentavel?: boolean;
      motivo?: string;
      status?: number;
    };
  }
  throw new Error('deveria falhar');
}

describe('SelahIaClient: sucesso', () => {
  it('chama o endpoint certo, com chave e corpo certos', async () => {
    const r = await cliente().gerarRascunho(pedido);
    expect(r).toEqual({
      rascunho: 'Rascunho gerado',
      model: 'gemini-x',
      provider: 'gemini',
    });
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0];
    expect(c.method).toBe('POST');
    expect(c.url).toBe('/v1/adapters/psicologia/rascunho/gerar');
    expect(c.headers['x-selah-api-key']).toBe(CHAVE);
    expect(c.headers['x-source-app']).toBe('NottaPsiBack');
    expect(c.headers['content-type']).toBe('application/json');
    expect(JSON.parse(c.corpo)).toEqual({
      tipoDocumento: 'evolucao',
      abordagem: 'TCC',
      textoAnonimizado: TEXTO,
    });
  });

  it('aceita 201 (Nest responde 201 em POST)', async () => {
    tratador = responder(201, JSON.stringify({ rascunho: 'ok' }));
    expect(await cliente().gerarRascunho(pedido)).toEqual({
      rascunho: 'ok',
      model: '',
      provider: '',
    });
  });

  it('respeita prefixo de caminho na URL', async () => {
    await cliente({ url: `http://127.0.0.1:${porta}/api` }).gerarRascunho(
      pedido,
    );
    expect(chamadas[0].url).toBe('/api/v1/adapters/psicologia/rascunho/gerar');
  });
});

describe('SelahIaClient: antes de chamar', () => {
  it('desabilitada: IaDesabilitadaError e nenhuma chamada', async () => {
    const e = await falha(cliente({ habilitada: false }).gerarRascunho(pedido));
    expect(e).toBeInstanceOf(IaDesabilitadaError);
    expect(chamadas).toHaveLength(0);
  });

  it('texto vazio ou acima de 8000: erro tipado e nenhuma chamada', async () => {
    for (const t of ['', '  \n', 'a'.repeat(8001)]) {
      const e = await falha(
        cliente().gerarRascunho({ ...pedido, textoAnonimizado: t }),
      );
      expect(e).toBeInstanceOf(TextoIaInvalidoError);
    }
    expect(chamadas).toHaveLength(0);
  });
});

describe('SelahIaClient: erros tipados', () => {
  it.each([
    [400, IaRecusadaError, false, 'PEDIDO_INVALIDO'],
    [422, IaRecusadaError, false, 'PEDIDO_INVALIDO'],
    [401, IaRecusadaError, false, 'CHAVE_INVALIDA'],
    [403, IaRecusadaError, false, 'CHAVE_INVALIDA'],
    [404, IaRecusadaError, false, 'CONFIG'],
    [429, IaIndisponivelError, true, 'LIMITE'],
    [408, IaIndisponivelError, true, 'TIMEOUT'],
    [500, IaIndisponivelError, true, 'ERRO_DA_IA'],
    [502, IaIndisponivelError, true, 'RESPOSTA_INVALIDA'],
    [503, IaIndisponivelError, true, 'ERRO_DA_IA'],
    [504, IaIndisponivelError, true, 'ERRO_DA_IA'],
  ])(
    'status %i vira %p retentavel=%p motivo=%s',
    async (status, classe, retentavel, motivo) => {
      tratador = responder(status, JSON.stringify({ message: CORPO_SECRETO }));
      const e = await falha(cliente().gerarRascunho(pedido));
      expect(e).toBeInstanceOf(classe);
      expect(e.retentavel).toBe(retentavel);
      expect(e.motivo).toBe(motivo);
      expect(e.status).toBe(status);
      expect(e.message).not.toContain(CORPO_SECRETO);
    },
  );

  it('401 NAO e retentavel', async () => {
    tratador = responder(401, '{}');
    const e = await falha(cliente().gerarRascunho(pedido));
    expect(e).toBeInstanceOf(IaRecusadaError);
    expect(e.retentavel).toBe(false);
  });

  it.each([
    ['nao e JSON', 'isto nao e json'],
    ['JSON nulo', 'null'],
    ['array', '[]'],
    ['sem rascunho', '{"model":"x"}'],
    ['rascunho numero', '{"rascunho":42}'],
    ['rascunho vazio', '{"rascunho":""}'],
    ['rascunho so espacos', '{"rascunho":"  \\n "}'],
    ['corpo vazio', ''],
  ])(
    '200 com corpo invalido (%s) = RESPOSTA_INVALIDA retentavel',
    async (_n, corpo) => {
      tratador = responder(200, corpo);
      const e = await falha(cliente().gerarRascunho(pedido));
      expect(e).toBeInstanceOf(IaIndisponivelError);
      expect(e.retentavel).toBe(true);
      expect(e.motivo).toBe('RESPOSTA_INVALIDA');
      expect(e.message).not.toContain(corpo || 'nunca-vazio');
    },
  );

  it('corpo gigante (3 MB) e recusado como RESPOSTA_INVALIDA', async () => {
    tratador = responder(
      200,
      JSON.stringify({ rascunho: 'x'.repeat(3 * 1024 * 1024) }),
    );
    const e = await falha(cliente().gerarRascunho(pedido));
    expect(e).toBeInstanceOf(IaIndisponivelError);
    expect(e.motivo).toBe('RESPOSTA_INVALIDA');
  });

  it('timeout sem resposta = TIMEOUT retentavel (timeout curto injetado)', async () => {
    tratador = () => undefined;
    const ini = Date.now();
    const e = await falha(cliente({ timeoutMs: 150 }).gerarRascunho(pedido));
    expect(e).toBeInstanceOf(IaIndisponivelError);
    expect(e.motivo).toBe('TIMEOUT');
    expect(e.retentavel).toBe(true);
    expect(Date.now() - ini).toBeLessThan(1500);
  });

  it('timeout com cabecalho enviado e corpo parado = TIMEOUT', async () => {
    tratador = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"rascunho":"par');
    };
    const e = await falha(cliente({ timeoutMs: 150 }).gerarRascunho(pedido));
    expect(e.motivo).toBe('TIMEOUT');
    expect(e.retentavel).toBe(true);
  });

  it('conexao recusada = REDE retentavel', async () => {
    const e = await falha(
      cliente({ url: 'http://127.0.0.1:1' }).gerarRascunho(pedido),
    );
    expect(e).toBeInstanceOf(IaIndisponivelError);
    expect(e.motivo).toBe('REDE');
    expect(e.retentavel).toBe(true);
  });

  it('conexao derrubada no meio = REDE retentavel', async () => {
    tratador = (req) => req.socket.destroy();
    const e = await falha(cliente().gerarRascunho(pedido));
    expect(e.motivo).toBe('REDE');
    expect(e.retentavel).toBe(true);
  });

  it('nao segue redirecionamento (a chave nao pode ir para outro host)', async () => {
    let chegouNoDestino = false;
    tratador = (req, res) => {
      if (req.url === '/roubo') {
        chegouNoDestino = true;
        res.end('{}');
        return;
      }
      res.writeHead(307, { location: `http://127.0.0.1:${porta}/roubo` });
      res.end();
    };
    const e = await falha(cliente().gerarRascunho(pedido));
    expect(e.motivo).toBe('REDE');
    expect(chegouNoDestino).toBe(false);
    expect(chamadas).toHaveLength(1);
  });

  it('nenhum erro carrega texto, chave ou corpo (message, stack, JSON)', async () => {
    const respostas: Tratador[] = [
      responder(500, CORPO_SECRETO),
      responder(401, CORPO_SECRETO),
      responder(200, CORPO_SECRETO),
      (req) => req.socket.destroy(),
    ];
    for (const t of respostas) {
      tratador = t;
      const e = await falha(cliente().gerarRascunho(pedido));
      const tudo = `${e.message}|${e.stack}|${JSON.stringify(e)}|${String(e)}`;
      for (const proibido of [TEXTO, 'sigiloso', CHAVE, CORPO_SECRETO]) {
        expect(tudo).not.toContain(proibido);
      }
    }
  });
});

describe('SelahIaClient: logs', () => {
  function capturar() {
    const linhas: string[] = [];
    const guardar = (...a: unknown[]) =>
      void linhas.push(a.map(String).join(' '));
    for (const m of [
      'log',
      'warn',
      'error',
      'debug',
      'verbose',
      'fatal',
    ] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation(guardar);
    }
    for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      jest.spyOn(console, m).mockImplementation(guardar);
    }
    return linhas;
  }

  it('sucesso loga so status, latencia e inputChars', async () => {
    const linhas = capturar();
    await cliente().gerarRascunho(pedido);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatch(
      new RegExp(`^selahia ok status=200 ms=\\d+ inputChars=${TEXTO.length}$`),
    );
  });

  it('falhas logam so status, motivo, latencia e inputChars', async () => {
    const linhas = capturar();
    for (const t of [
      responder(500, CORPO_SECRETO),
      responder(401, CORPO_SECRETO),
      responder(200, CORPO_SECRETO),
      (req: IncomingMessage) => req.socket.destroy(),
    ]) {
      tratador = t;
      await falha(cliente().gerarRascunho(pedido));
    }
    expect(linhas).toHaveLength(4);
    for (const l of linhas) {
      expect(l).toMatch(
        new RegExp(
          `^selahia falhou motivo=[A-Z_]+ status=(\\d+|-) ms=\\d+ inputChars=${TEXTO.length}$`,
        ),
      );
    }
    const tudo = linhas.join('\n');
    for (const proibido of [TEXTO, 'sigiloso', CHAVE, CORPO_SECRETO]) {
      expect(tudo).not.toContain(proibido);
    }
  });
});
