import { randomUUID } from 'node:crypto';
import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  JwtAuthGuard,
  PermiteSenhaProvisoria,
  Publico,
} from './jwt-auth.guard';
import { opcoesJwt } from './jwt.config';

// Banco FALSO sem RLS: prova a camada do codigo sozinha (filtro por clinicaId no where).
const A = randomUUID();
const B = randomUUID();
const psicologoA = randomUUID();
const psicologoProvisorio = randomUUID();
const linhas = [
  {
    id: psicologoA,
    clinicaId: A,
    papel: 'PSICOLOGO',
    senhaProvisoria: false,
    tokenVersao: 3,
  },
  {
    id: psicologoProvisorio,
    clinicaId: A,
    papel: 'PSICOLOGO',
    senhaProvisoria: true,
    tokenVersao: 0,
  },
];

const tenant = {
  run: (clinicaId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
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
  opcoesJwt({ NOTTA_JWT_SECRET: 'segredo-unitario-'.repeat(3) }),
);
const guard = new JwtAuthGuard(new Reflector(), jwt, tenant);

// Handlers e classe falsos com os metadados que o Reflector le.
const rotaComum = () => {};
const rotaLiberada = () => {};
PermiteSenhaProvisoria()(rotaLiberada);
const rotaPublica = () => {};
Publico()(rotaPublica);
class Comum {}

function contexto(
  token: string,
  handler: () => void = rotaComum,
  classe: object = Comum,
) {
  const req: { headers: Record<string, string>; user?: unknown } = {
    headers: { authorization: `Bearer ${token}` },
  };
  const headers: Record<string, string> = {};
  const res = { header: (k: string, v: string) => (headers[k] = v) };
  const ctx = {
    getHandler: () => handler,
    getClass: () => classe,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, req, headers };
}

describe('JwtAuthGuard (camada do codigo)', () => {
  it('token valido: request.user com papel lido do banco', async () => {
    const { ctx, req } = contexto(
      await jwt.signAsync({ sub: psicologoA, clinicaId: A, tv: 3 }),
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
      await jwt.signAsync({ sub: psicologoA, clinicaId: A, ...extra }),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
  });

  it('sub valido com clinicaId de outra clinica: 401 mesmo sem RLS', async () => {
    const { ctx, req } = contexto(
      await jwt.signAsync({ sub: psicologoA, clinicaId: B, tv: 3 }),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
  });
});

describe('JwtAuthGuard: senha provisoria', () => {
  const token = () =>
    jwt.signAsync({ sub: psicologoProvisorio, clinicaId: A, tv: 0 });

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
      await jwt.signAsync({ sub: psicologoA, clinicaId: A, tv: 3 }),
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
  const quebrado = new JwtAuthGuard(new Reflector(), jwt, {
    run: () => Promise.reject(new Error('P2028 Unable to start a transaction')),
  } as unknown as TenantPrismaService);

  it('erro de infraestrutura com token valido: 503 fixo + Retry-After 2', async () => {
    const { ctx, req, headers } = contexto(
      await jwt.signAsync({ sub: psicologoA, clinicaId: A, tv: 3 }),
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

describe('opcoesJwt', () => {
  it.each([
    ['ausente', undefined],
    ['curta', 'z'.repeat(31)],
    // Valor publicado no .env.example antigo (esta no historico do git).
    ['do .env.example', 'troque-isto-por-um-segredo-longo-e-aleatorio-fake'],
    ['todos iguais', 'a'.repeat(64)],
    ['9 caracteres distintos', 'abcdefghi'.repeat(8)],
  ])('NOTTA_JWT_SECRET %s lanca sem ecoar', (_n, valor) => {
    let msg = '';
    try {
      opcoesJwt({ NOTTA_JWT_SECRET: valor });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/NOTTA_JWT_SECRET/);
    if (valor) expect(msg).not.toContain(valor);
  });

  it('aceita segredo com 10 caracteres distintos e >= 32', () => {
    expect(() =>
      opcoesJwt({ NOTTA_JWT_SECRET: 'abcdefghij'.repeat(4) }),
    ).not.toThrow();
  });
});
