import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TETO_SIMULTANEAS } from '../src/auth/jwt-auth.guard';
import {
  apagarClinicas,
  corpoClinica,
  criarApp,
  criarAppSemLimite,
} from './criar-app-sem-limite';
import { CLIENTE_API } from './cliente-api';

// I-2 da 2a revisao: um usuario autenticado (com clinica propria, cadastro e gratis) em
// rajada NAO pode degradar OUTRA clinica. O limite por psicologo e o teto de simultaneas
// contam antes do banco: requisicao barrada nao gasta conexao do pool.
// O atacante roda numa worker thread (event loop proprio): mede o servidor, nao o cliente.
const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `cc-${n}-${sufixo}@teste.local`;
const SENHA = 'senha-forte-123';
const criadas: string[] = [];
const tokens: Record<string, string> = {};

beforeAll(async () => {
  const setup = await criarAppSemLimite();
  const http = setup.getHttpServer();
  for (const n of ['atacante', 'vitima', 'rajada']) {
    const res = await request(http)
      .post('/clinicas')
      .set(CLIENTE_API)
      .send(corpoClinica(email(n), { senha: SENHA }))
      .expect(201);
    criadas.push((res.body as { clinicaId: string }).clinicaId);
    const login = await request(http)
      .post('/auth/login')
      .set(CLIENTE_API)
      .send({ email: email(n), senha: SENHA })
      .expect(200);
    tokens[n] = (login.body as { token: string }).token;
  }
  await setup.close();
});

afterAll(async () => {
  const limpar = await criarAppSemLimite();
  await apagarClinicas(limpar, criadas);
  await limpar.close();
});

// C conexoes keep-alive, cada uma em laco GET /eu ate o prazo. Devolve a contagem de status.
const ATAQUE = `
const http = require('node:http');
const { workerData, parentPort } = require('node:worker_threads');
const { url, token, conexoes, ms } = workerData;
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
const fim = Date.now() + ms;
const cont = {};
const get = () => new Promise((ok) => {
  const q = http.get(url, { agent, headers: { authorization: 'Bearer ' + token } }, (s) => {
    s.resume();
    s.on('end', () => ok(s.statusCode));
  });
  q.on('error', () => ok('ERR'));
});
async function laco() {
  while (Date.now() < fim) {
    const s = await get();
    cont[s] = (cont[s] || 0) + 1;
  }
}
Promise.all(Array.from({ length: conexoes }, laco)).then(() => {
  agent.destroy();
  parentPort.postMessage(cont);
});
`;

function atacar(url: string, token: string, conexoes: number, ms: number) {
  return new Promise<Record<string, number>>((ok, erro) => {
    const w = new Worker(ATAQUE, {
      eval: true,
      workerData: { url, token, conexoes, ms },
    });
    w.once('message', (m: Record<string, number>) => {
      void w.terminate();
      ok(m);
    });
    w.once('error', erro);
  });
}

const contar = (xs: (number | string)[]) =>
  xs.reduce<Record<string, number>>(
    (m, x) => ((m[x] = (m[x] ?? 0) + 1), m),
    {},
  );

describe('rajada de um usuario nao degrada outra clinica', () => {
  let app: NestExpressApplication;
  let url: string;
  beforeAll(async () => {
    app = await criarApp();
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/eu`;
  });
  afterAll(() => app.close());

  it('500 conexoes do atacante por 4 s: vitima (1 req a cada 100 ms) com p95 < 300 ms e zero 401', async () => {
    // Aquece a conexao keep-alive da vitima: ela ja existe quando a rajada de 500 conexoes
    // novas enche a fila de accept (medimos a requisicao, nao o handshake em fila).
    await (
      await fetch(url, {
        headers: { Authorization: `Bearer ${tokens.vitima}` },
      })
    ).arrayBuffer();
    const ataque = atacar(url, tokens.atacante, 500, 4000);
    await new Promise((ok) => setTimeout(ok, 300)); // deixa a rajada subir
    const fim = Date.now() + 3500;
    const status: number[] = [];
    const ms: number[] = [];
    while (Date.now() < fim) {
      const t0 = performance.now();
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${tokens.vitima}` },
      });
      await r.arrayBuffer();
      ms.push(performance.now() - t0);
      status.push(r.status);
      await new Promise((ok) => setTimeout(ok, 100));
    }
    const doAtacante = await ataque;
    ms.sort((a, b) => a - b);
    const p = (q: number) => Math.round(ms[Math.floor(ms.length * q)]);
    console.log(
      `carga-clinicas: atacante ${JSON.stringify(doAtacante)}; vitima ${JSON.stringify(contar(status))} p50 ${p(0.5)} ms p95 ${p(0.95)} ms max ${Math.round(ms.at(-1)!)} ms`,
    );
    // A rajada aconteceu de verdade (o atacante foi barrado) e ninguem foi deslogado.
    expect(doAtacante['429']).toBeGreaterThan(300);
    expect(doAtacante['401']).toBeUndefined();
    expect(status.length).toBeGreaterThan(20);
    expect(status.every((s) => s === 200)).toBe(true);
    expect(p(0.95)).toBeLessThan(300);
  });
});

describe(`teto de ${TETO_SIMULTANEAS} requisicoes simultaneas por psicologo`, () => {
  it('acima do teto = 429 + Retry-After 1 na hora; a vaga volta ao terminar (tambem em desconexao)', async () => {
    const app = await criarApp();
    try {
      await app.listen(0, '127.0.0.1');
      const url = `${await app.getUrl()}/eu`;
      const get = (signal?: AbortSignal) =>
        fetch(url, {
          headers: { Authorization: `Bearer ${tokens.rajada}` },
          signal,
        });
      const r = await Promise.all(Array.from({ length: 30 }, () => get()));
      const recusada = r.find((x) => x.status === 429);
      expect(contar(r.map((x) => x.status))['200']).toBeGreaterThanOrEqual(
        TETO_SIMULTANEAS,
      );
      expect(recusada?.headers.get('retry-after')).toBe('1');
      expect(await recusada!.json()).toEqual({
        statusCode: 429,
        message: 'Muitas requisicoes simultaneas',
      });
      await Promise.all(r.map((x) => x.arrayBuffer().catch(() => null)));

      // Clientes que desistem no meio: o contador nao pode vazar.
      await Promise.all(
        Array.from({ length: 20 }, () =>
          get(AbortSignal.timeout(2)).catch(() => null),
        ),
      );
      await new Promise((ok) => setTimeout(ok, 200));
      const depois = await Promise.all(
        Array.from({ length: TETO_SIMULTANEAS }, () => get()),
      );
      expect(depois.map((x) => x.status)).toEqual(
        Array(TETO_SIMULTANEAS).fill(200),
      );
    } finally {
      await app.close();
    }
  });
});
