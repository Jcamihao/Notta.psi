import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerException } from '@nestjs/throttler';
import { relogio } from '../comum/relogio';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  JwtAuthGuard,
  PermiteSenhaProvisoria,
  Publico,
  RECUSA_ATRASO_MS,
  TETO_SIMULTANEAS,
} from './jwt-auth.guard';
import { opcoesJwt } from './jwt.config';

// Banco FALSO sem RLS: prova a camada do codigo sozinha (filtro por clinicaId no where).
const A = randomUUID();
const B = randomUUID();
const psicologoA = randomUUID();
const psicologoProvisorio = randomUUID();
const psicologoDesativado = randomUUID();
const linhas = [
  {
    id: psicologoA,
    clinicaId: A,
    papel: 'PSICOLOGO',
    senhaProvisoria: false,
    tokenVersao: 3,
    ativo: true,
  },
  {
    id: psicologoProvisorio,
    clinicaId: A,
    papel: 'PSICOLOGO',
    senhaProvisoria: true,
    tokenVersao: 0,
    ativo: true,
  },
  {
    id: psicologoDesativado,
    clinicaId: A,
    papel: 'PSICOLOGO',
    senhaProvisoria: false,
    tokenVersao: 0,
    ativo: false,
  },
];

// Sessoes (item 46). O `sid` padrao de cada psicologo e a sessao ATIVA dele.
const SID = {
  a: randomUUID(),
  provisorio: randomUUID(),
  desativado: randomUUID(),
  revogada: randomUUID(),
  vencida: randomUUID(),
  deOutro: randomUUID(),
};
const AGORA = new Date('2026-11-08T12:00:00.000Z');
const FUTURO = new Date('2026-11-15T12:00:00.000Z');
const sessoes: Record<string, unknown>[] = [
  {
    id: SID.a,
    psicologoId: psicologoA,
    clinicaId: A,
    familia: 'fam-a',
    revogadaEm: null,
    absolutaAte: FUTURO,
    ultimoUsoEm: AGORA,
  },
  {
    id: SID.provisorio,
    psicologoId: psicologoProvisorio,
    clinicaId: A,
    familia: 'fam-p',
    revogadaEm: null,
    absolutaAte: FUTURO,
    ultimoUsoEm: AGORA,
  },
  {
    id: SID.desativado,
    psicologoId: psicologoDesativado,
    clinicaId: A,
    familia: 'fam-d',
    revogadaEm: null,
    absolutaAte: FUTURO,
    ultimoUsoEm: AGORA,
  },
  {
    id: SID.revogada,
    psicologoId: psicologoA,
    clinicaId: A,
    familia: 'fam-r',
    revogadaEm: new Date('2026-11-08T11:00:00.000Z'),
    absolutaAte: FUTURO,
    ultimoUsoEm: AGORA,
  },
  {
    id: SID.vencida,
    psicologoId: psicologoA,
    clinicaId: A,
    familia: 'fam-v',
    revogadaEm: null,
    absolutaAte: new Date('2026-11-08T11:59:59.999Z'),
    ultimoUsoEm: AGORA,
  },
  {
    id: SID.deOutro,
    psicologoId: psicologoProvisorio,
    clinicaId: A,
    familia: 'fam-o',
    revogadaEm: null,
    absolutaAte: FUTURO,
    ultimoUsoEm: AGORA,
  },
];
const gravacoes: Record<string, unknown>[] = [];
const casa = (l: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => l[k] === v);

const tenant = {
  run: (
    clinicaId: string,
    fn: (tx: unknown) => Promise<unknown>,
    opcoes?: { psicologoId?: string },
  ) =>
    fn({
      sessao: {
        // Simula a RLS da Sessao: so as linhas do psicologo do contexto (sem contexto = nenhuma).
        findFirst: ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            sessoes.find(
              (l) =>
                l.psicologoId === opcoes?.psicologoId &&
                l.clinicaId === clinicaId &&
                casa(l, where),
            ) ?? null,
          ),
        updateMany: (args: Record<string, unknown>) => {
          gravacoes.push(args);
          return Promise.resolve({ count: 1 });
        },
      },
      psicologo: {
        findFirst: ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            linhas.find((l) =>
              Object.entries(where).every(
                ([k, v]) => l[k as keyof typeof l] === v,
              ),
            ) ?? null,
          ),
      },
    }),
} as unknown as TenantPrismaService;

const jwt = new JwtService(
  opcoesJwt({
    PRAXIS_JWT_SECRET: 'segredo-unitario-'.repeat(3),
    PRAXIS_PERMITE_SEGREDO_DE_TESTE: '1',
  }),
);
// Assina com o `sid` da sessao ativa do `sub` (salvo se o teste passar outro, ou `sid: undefined`).
const SID_DO: Record<string, string> = {
  [psicologoA]: SID.a,
  [psicologoProvisorio]: SID.provisorio,
  [psicologoDesativado]: SID.desativado,
};
const assinar = (claims: { sub: string } & Record<string, unknown>) =>
  jwt.signAsync({ sid: SID_DO[claims.sub], ...claims });

beforeEach(() => {
  jest.spyOn(relogio, 'agora').mockReturnValue(AGORA);
  gravacoes.length = 0;
});
afterEach(() => jest.restoreAllMocks());
// Storage FALSO do throttler (contagem simples, sem timers): bloqueia acima do limite.
function storageFalso() {
  const hits = new Map<string, number>();
  return {
    hits,
    increment: (key: string, ttl: number, limit: number) => {
      const n = (hits.get(key) ?? 0) + 1;
      hits.set(key, n);
      return Promise.resolve({
        totalHits: n,
        timeToExpire: ttl / 1000,
        isBlocked: n > limit,
        timeToBlockExpire: n > limit ? 60 : 0,
      });
    },
  };
}
const novoGuard = (t: TenantPrismaService = tenant, s = storageFalso()) =>
  new JwtAuthGuard(new Reflector(), jwt, t, s);
const guard = novoGuard();

// Handlers e classe falsos com os metadados que o Reflector le.
const rotaComum = () => {};
const rotaLiberada = () => {};
PermiteSenhaProvisoria()(rotaLiberada);
const rotaPublica = () => {};
Publico()(rotaPublica);
class Comum {}

// Toda resposta criada no teste "fecha" no fim (libera o teto de simultaneas do guard).
const respostas: EventEmitter[] = [];
afterEach(() => {
  respostas.forEach((r) => r.emit('close'));
  respostas.length = 0;
});

function contexto(
  token: string,
  handler: () => void = rotaComum,
  classe: object = Comum,
) {
  const req: { headers: Record<string, string>; user?: unknown } = {
    headers: { authorization: `Bearer ${token}` },
  };
  const headers: Record<string, string> = {};
  // EventEmitter: o guard libera a vaga de requisicao simultanea no 'close' da resposta.
  const res = Object.assign(new EventEmitter(), {
    header: (k: string, v: string) => (headers[k] = v),
  });
  const ctx = {
    getHandler: () => handler,
    getClass: () => classe,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  respostas.push(res);
  return { ctx, req, headers, res };
}

describe('JwtAuthGuard (camada do codigo)', () => {
  it('psicologo desativado (item 58) = 401, mesmo com token valido e tv certo', async () => {
    const { ctx, req } = contexto(
      await assinar({ sub: psicologoDesativado, clinicaId: A, tv: 0 }),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
  });

  it('token valido: request.user com papel lido do banco', async () => {
    const { ctx, req } = contexto(
      await assinar({ sub: psicologoA, clinicaId: A, tv: 3 }),
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({
      psicologoId: psicologoA,
      clinicaId: A,
      papel: 'PSICOLOGO',
      senhaProvisoria: false,
    });
  });

  it.each([
    ['tv desatualizado', { tv: 2 }],
    ['tv do futuro', { tv: 4 }],
    ['sem tv', {}],
    ['tv texto', { tv: '3' }],
  ])('%s: 401', async (_n, extra) => {
    const { ctx, req } = contexto(
      await assinar({ sub: psicologoA, clinicaId: A, ...extra }),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
  });

  it('sub valido com clinicaId de outra clinica: 401 mesmo sem RLS', async () => {
    const { ctx, req } = contexto(
      await assinar({ sub: psicologoA, clinicaId: B, tv: 3 }),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
  });
});

describe('JwtAuthGuard: senha provisoria', () => {
  const token = () =>
    assinar({ sub: psicologoProvisorio, clinicaId: A, tv: 0 });

  it('rota comum: 403 "Troca de senha obrigatoria" (corpo do contrato)', async () => {
    const { ctx } = contexto(await token());
    const erro = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect((erro as ForbiddenException).getResponse()).toEqual({
      statusCode: 403,
      message: 'Troca de senha obrigatoria',
      error: 'Forbidden',
    });
  });

  it('rota com @PermiteSenhaProvisoria(): passa, request.user com senhaProvisoria true', async () => {
    const { ctx, req } = contexto(await token(), rotaLiberada);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toMatchObject({
      psicologoId: psicologoProvisorio,
      senhaProvisoria: true,
    });
  });

  it('@PermiteSenhaProvisoria() na classe vale para os metodos', async () => {
    @PermiteSenhaProvisoria()
    class Toda {}
    const { ctx } = contexto(await token(), rotaComum, Toda);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('senha definitiva: rota comum passa', async () => {
    const { ctx } = contexto(
      await assinar({ sub: psicologoA, clinicaId: A, tv: 3 }),
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('@Publico(): passa sem token nem banco', async () => {
    const { ctx } = contexto('', rotaPublica);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('JwtAuthGuard: 401 x 503', () => {
  // Banco/pool fora (ex.: P2028 sem conexao livre): NAO e problema do token.
  const quebrado = novoGuard({
    run: () => Promise.reject(new Error('P2028 Unable to start a transaction')),
  } as unknown as TenantPrismaService);

  it('erro de infraestrutura com token valido: 503 fixo + Retry-After 2', async () => {
    const { ctx, req, headers } = contexto(
      await assinar({ sub: psicologoA, clinicaId: A, tv: 3 }),
    );
    const erro = await quebrado.canActivate(ctx).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ServiceUnavailableException);
    expect((erro as ServiceUnavailableException).getResponse()).toEqual({
      statusCode: 503,
      message: 'Servico indisponivel',
    });
    expect(headers['Retry-After']).toBe('2');
    expect(req.user).toBeUndefined();
  });

  it.each([
    ['token lixo', 'lixo.lixo.lixo'],
    ['outro segredo', 'x'],
  ])('%s com banco fora continua 401 (nem chega no banco)', async (_n, t) => {
    const token =
      t === 'x'
        ? await new JwtService({
            secret: 'outro-segredo-'.repeat(4),
          }).signAsync({ sub: psicologoA, clinicaId: A })
        : t;
    const { ctx } = contexto(token);
    await expect(quebrado.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

// I-2 da 2a revisao: o limite por psicologo conta ANTES do banco. Uma requisicao barrada
// nao pode gastar conexao do pool (senao um usuario derruba as outras clinicas).
describe('JwtAuthGuard: limite api e teto de simultaneas ANTES do banco', () => {
  // A recusa 429 espera RECUSA_ATRASO_MS (tarpit): relogio falso so para timers; setImmediate
  // fica real (o helper `ate` precisa dele).
  beforeEach(() =>
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }),
  );
  afterEach(() => jest.useRealTimers());

  // Roda ate o fim da recusa (atraso do tarpit) e devolve o erro.
  async function recusada(p: Promise<boolean>) {
    const r = p.catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(RECUSA_ATRASO_MS);
    return r;
  }

  const tokenA = () => assinar({ sub: psicologoA, clinicaId: A, tv: 3 });

  // Espera a condicao (verifyAsync e o banco falso sao assincronos), sem relogio.
  async function ate(cond: () => boolean) {
    for (let i = 0; i < 1000 && !cond(); i++) {
      await new Promise((ok) => setImmediate(ok));
    }
    expect(cond()).toBe(true);
  }

  function tenantContado() {
    const t = {
      chamadas: 0,
      run: (
        c: string,
        fn: (tx: unknown) => Promise<unknown>,
        opcoes?: { psicologoId?: string },
      ) => {
        t.chamadas++;
        return tenant.run(c, fn, opcoes);
      },
    };
    return t;
  }

  it('301a requisicao do psicologo = 429 + Retry-After, sem tocar o banco', async () => {
    const t = tenantContado();
    const g = novoGuard(t as unknown as TenantPrismaService);
    const token = await tokenA();
    for (let i = 0; i < 300; i++) {
      const { ctx, res } = contexto(token);
      await g.canActivate(ctx);
      res.emit('close');
    }
    expect(t.chamadas).toBe(300);
    const { ctx, headers } = contexto(token);
    const erro = await recusada(g.canActivate(ctx));
    expect(erro).toBeInstanceOf(ThrottlerException);
    expect((erro as ThrottlerException).getStatus()).toBe(429);
    expect((erro as ThrottlerException).message).toBe(
      'Muitas tentativas. Tente mais tarde.',
    );
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
    expect(t.chamadas).toBe(300);
  });

  it('recusa 429 espera o atraso (tarpit, segura a rajada) e sai na hora se o cliente desiste', async () => {
    const s = storageFalso();
    const g = novoGuard(tenant, s);
    const token = await tokenA();
    s.hits.set(`api:${psicologoA}`, 300);
    let fim: unknown;
    const { ctx } = contexto(token);
    const p = g.canActivate(ctx).catch((e: unknown) => (fim = e));
    await ate(() => s.hits.get(`api:${psicologoA}`) === 301);
    await jest.advanceTimersByTimeAsync(RECUSA_ATRASO_MS - 1);
    expect(fim).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(fim).toBeInstanceOf(ThrottlerException);

    // Cliente desiste no meio da espera: o timer e liberado e a recusa termina sem esperar.
    const outro = contexto(token);
    const q = g.canActivate(outro.ctx).catch((e: unknown) => e);
    await ate(() => s.hits.get(`api:${psicologoA}`) === 302);
    outro.res.emit('close');
    expect(await q).toBeInstanceOf(ThrottlerException);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('chave api:<sub> somada entre rotas; token invalido nao conta nem toca o banco', async () => {
    const s = storageFalso();
    const t = tenantContado();
    const g = novoGuard(t as unknown as TenantPrismaService, s);
    await expect(
      g.canActivate(contexto('lixo.lixo.lixo').ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(s.hits.size).toBe(0);
    expect(t.chamadas).toBe(0);
    await g.canActivate(contexto(await tokenA()).ctx);
    expect([...s.hits]).toEqual([[`api:${psicologoA}`, 1]]);
  });

  it(`acima de ${TETO_SIMULTANEAS} simultaneas do mesmo psicologo = 429 imediato, sem banco; libera no close`, async () => {
    let chamadas = 0;
    const presos: (() => void)[] = [];
    // Banco que so responde quando mandamos: segura as requisicoes "em andamento".
    const lento = {
      run: (
        c: string,
        fn: (tx: unknown) => Promise<unknown>,
        opcoes?: { psicologoId?: string },
      ) => {
        chamadas++;
        return new Promise((ok) =>
          presos.push(() => ok(tenant.run(c, fn, opcoes))),
        );
      },
    } as unknown as TenantPrismaService;
    const g = novoGuard(lento);
    const token = await tokenA();
    const abertas = Array.from({ length: TETO_SIMULTANEAS }, () =>
      contexto(token),
    );
    const pendentes = abertas.map((c) => g.canActivate(c.ctx));
    await ate(() => chamadas === TETO_SIMULTANEAS);

    const extra = contexto(token);
    const erro = await recusada(g.canActivate(extra.ctx));
    expect(erro).toBeInstanceOf(ThrottlerException);
    expect((erro as ThrottlerException).getStatus()).toBe(429);
    expect(extra.headers['Retry-After']).toBe('1');
    expect(chamadas).toBe(TETO_SIMULTANEAS);

    // Outro psicologo nao divide o teto.
    const outro = contexto(
      await assinar({ sub: psicologoProvisorio, clinicaId: A, tv: 0 }),
      rotaLiberada,
    );
    const pOutro = g.canActivate(outro.ctx);
    await ate(() => chamadas === TETO_SIMULTANEAS + 1);

    // Terminou uma (resposta fechada, com sucesso, erro ou desconexao): abre uma vaga.
    presos.forEach((p) => p());
    await Promise.all([...pendentes, pOutro]);
    abertas[0].res.emit('close');
    const depois = contexto(token);
    const pDepois = g.canActivate(depois.ctx);
    await ate(() => chamadas === TETO_SIMULTANEAS + 2);
    presos.at(-1)!();
    await expect(pDepois).resolves.toBe(true);
  });
});

describe('opcoesJwt', () => {
  const PUBLICADO = 'troque-isto-por-um-segredo-longo-e-aleatorio-fake';
  it.each([
    ['ausente', undefined],
    ['curta', 'z'.repeat(31)],
    // Valor publicado no .env.example antigo (esta no historico do git).
    ['do .env.example', PUBLICADO],
    ['do .env.example com espaco no fim', `${PUBLICADO} `],
    ['do .env.example com espaco no comeco', `  ${PUBLICADO}`],
    ['do .env.example em maiusculas', PUBLICADO.toUpperCase()],
    ['do .env.example com sufixo', `${PUBLICADO}2`],
    ['0123456789abcdef x2', '0123456789abcdef0123456789abcdef'],
    ['0123456789abcdef x2 com sufixo', '0123456789abcdef0123456789abcdefXYZ'],
    ['de tutorial', 'my-super-secret-jwt-key-for-production'],
    ['de tutorial em maiusculas', 'MY-SUPER-SECRET-JWT-KEY-FOR-PRODUCTION'],
    ['todos iguais', 'a'.repeat(64)],
    ['15 caracteres distintos', 'abcdefghijklmno'.repeat(4)],
    [
      '31 uteis + espaco nas pontas (32 com espaco)',
      ' abcdefghijklmnopqrstuvwxyz01234 ',
    ],
    [
      'de teste das suites (sem a variavel de teste)',
      'segredo-unitario-'.repeat(3),
    ],
    [
      'de teste e2e (sem a variavel de teste)',
      'segredo-jwt-so-de-teste-e2e-'.repeat(2),
    ],
  ])('PRAXIS_JWT_SECRET %s lanca sem ecoar', (_n, valor) => {
    let msg = '';
    try {
      opcoesJwt({ PRAXIS_JWT_SECRET: valor });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/PRAXIS_JWT_SECRET/);
    if (valor) expect(msg).not.toContain(valor.trim());
  });

  it('aceita segredo com 16 caracteres distintos e >= 32', () => {
    expect(() =>
      opcoesJwt({ PRAXIS_JWT_SECRET: 'abcdefghijklmnop'.repeat(2) }),
    ).not.toThrow();
  });

  it('segredo de teste conhecido so passa com PRAXIS_PERMITE_SEGREDO_DE_TESTE=1', () => {
    const PRAXIS_JWT_SECRET = 'segredo-unitario-'.repeat(3);
    expect(() => opcoesJwt({ PRAXIS_JWT_SECRET })).toThrow();
    expect(() =>
      opcoesJwt({ PRAXIS_JWT_SECRET, PRAXIS_PERMITE_SEGREDO_DE_TESTE: '1' }),
    ).not.toThrow();
    // A variavel nao libera segredo fraco comum.
    expect(() =>
      opcoesJwt({
        PRAXIS_JWT_SECRET: 'a'.repeat(64),
        PRAXIS_PERMITE_SEGREDO_DE_TESTE: '1',
      }),
    ).toThrow();
  });
});

describe('JwtAuthGuard: sessao e cookie (item 46)', () => {
  const comHeaders = (headers: Record<string, string>) => {
    const { ctx, req } = contexto('x');
    req.headers = headers;
    return { ctx, req };
  };
  // Sem argumento = a sessao ativa; `jwtDe(undefined)` = JWT sem sid.
  const jwtDe = (...sid: (string | undefined)[]) =>
    assinar({
      sub: psicologoA,
      clinicaId: A,
      tv: 3,
      sid: sid.length ? sid[0] : SID.a,
    });

  it('JWT valido com sessao ativa: user + sessao { id, familia } no request', async () => {
    const { ctx, req } = contexto(await jwtDe());
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req as unknown as { sessao: unknown }).sessao).toEqual({
      id: SID.a,
      familia: 'fam-a',
    });
  });

  it.each([
    ['sem sid', undefined],
    ['sid que nao e uuid', 'nao-uuid'],
    ['sid inexistente', randomUUID()],
    ['sessao REVOGADA (JWT ainda valido)', SID.revogada],
    ['sessao acima do limite absoluto de 7 dias', SID.vencida],
    ['sessao de OUTRO psicologo', SID.deOutro],
  ])('%s: 401, sem user', async (_n, sid) => {
    const { ctx, req } = contexto(await jwtDe(sid));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
  });

  it('o limite absoluto usa o relogio do app (agora == absolutaAte ja e 401)', async () => {
    jest
      .spyOn(relogio, 'agora')
      .mockReturnValue(new Date('2026-11-15T12:00:00.000Z'));
    const { ctx } = contexto(await jwtDe());
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('cookie de acesso e aceito quando nao ha Authorization', async () => {
    const { ctx, req } = comHeaders({
      cookie: `outro=1; praxis_acesso=${await jwtDe()}; x=2`,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toMatchObject({ psicologoId: psicologoA });
  });

  it('Authorization presente mas torto = 401 e NUNCA cai para o cookie', async () => {
    const { ctx } = comHeaders({
      authorization: 'Basic abc',
      cookie: `praxis_acesso=${await jwtDe()}`,
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('Bearer vence o cookie (cookie invalido nao atrapalha)', async () => {
    const { ctx } = comHeaders({
      authorization: `Bearer ${await jwtDe()}`,
      cookie: 'praxis_acesso=lixo',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('sem Authorization nem cookie = 401', async () => {
    const { ctx } = comHeaders({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('ultimoUsoEm: grava quando passou mais de 1 min; nao grava antes', async () => {
    jest
      .spyOn(relogio, 'agora')
      .mockReturnValue(new Date(AGORA.getTime() + 61_000));
    await guard.canActivate(contexto(await jwtDe()).ctx);
    expect(gravacoes).toEqual([
      {
        where: { id: SID.a, revogadaEm: null },
        data: { ultimoUsoEm: new Date(AGORA.getTime() + 61_000) },
      },
    ]);
    gravacoes.length = 0;
    jest
      .spyOn(relogio, 'agora')
      .mockReturnValue(new Date(AGORA.getTime() + 59_000));
    await guard.canActivate(contexto(await jwtDe()).ctx);
    expect(gravacoes).toEqual([]);
  });
});
