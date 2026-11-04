import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

// SelahIA FALSO em node:http para os e2e da geracao por IA: guarda cada chamada e responde como o
// teste mandar. Nunca sai da maquina (127.0.0.1, porta efemera).
export type ChamadaFalsa = {
  caminho: string;
  chave: string | undefined;
  fonte: string | undefined;
  corpo: {
    tipoDocumento: string;
    abordagem: string;
    textoAnonimizado: string;
  };
};
export type Resposta = (
  corpo: ChamadaFalsa['corpo'],
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

export const RASCUNHO_PADRAO =
  'Evolucao clinica. [PACIENTE] relatou melhora do sono e segue em acompanhamento.';

export const json = (res: ServerResponse, status: number, corpo: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
};

export const ok =
  (rascunho: string): Resposta =>
  (_c, _r, res) =>
    json(res, 200, {
      provider: 'falso',
      version: '1',
      model: 'falso',
      generatedAt: new Date().toISOString(),
      rascunho,
    });

export const status =
  (codigo: number): Resposta =>
  (_c, _r, res) =>
    json(res, codigo, { message: 'erro do falso' });

// Atrasa a resposta (para sobrepor chamadas e simular IA lenta).
export const depoisDe =
  (ms: number, r: Resposta): Resposta =>
  async (c, q, s) => {
    await new Promise((f) => setTimeout(f, ms));
    await r(c, q, s);
  };

export async function subirSelahiaFalso() {
  const chamadas: ChamadaFalsa[] = [];
  let resposta: Resposta = ok(RASCUNHO_PADRAO);
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => partes.push(p));
    req.on('end', () => {
      const corpo = JSON.parse(
        Buffer.concat(partes).toString('utf8'),
      ) as ChamadaFalsa['corpo'];
      chamadas.push({
        caminho: req.url ?? '',
        chave: req.headers['x-selah-api-key'] as string | undefined,
        fonte: req.headers['x-source-app'] as string | undefined,
        corpo,
      });
      void Promise.resolve(resposta(corpo, req, res)).catch(() =>
        res.destroy(),
      );
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((f) => server.listen(0, '127.0.0.1', f));
  const porta = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${porta}`,
    chamadas,
    responder: (r: Resposta) => {
      resposta = r;
    },
    zerar: () => {
      chamadas.length = 0;
      resposta = ok(RASCUNHO_PADRAO);
    },
    fechar: () =>
      new Promise<void>((f) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => f());
      }),
  };
}
