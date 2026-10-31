import { randomUUID } from 'node:crypto';
import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { opcoesJwt } from './jwt.config';

// Banco FALSO sem RLS: prova a camada do codigo sozinha (filtro por clinicaId no where).
const A = randomUUID();
const B = randomUUID();
const psicologoA = randomUUID();
const linhas = [{ id: psicologoA, clinicaId: A, papel: 'PSICOLOGO' }];

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

function contexto(token: string) {
  const req: { headers: Record<string, string>; user?: unknown } = {
    headers: { authorization: `Bearer ${token}` },
  };
  const headers: Record<string, string> = {};
  const res = { header: (k: string, v: string) => (headers[k] = v) };
  const ctx = {
    getHandler: () => contexto,
    getClass: () => JwtAuthGuard,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, req, headers };
}

describe('JwtAuthGuard (camada do codigo)', () => {
  it('token valido: request.user com papel lido do banco', async () => {
    const { ctx, req } = contexto(
      await jwt.signAsync({ sub: psicologoA, clinicaId: A }),
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({
      psicologoId: psicologoA,
      clinicaId: A,
      papel: 'PSICOLOGO',
    });
  });

  it('sub valido com clinicaId de outra clinica: 401 mesmo sem RLS', async () => {
    const { ctx, req } = contexto(
      await jwt.signAsync({ sub: psicologoA, clinicaId: B }),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
  });
});

describe('JwtAuthGuard: 401 x 503', () => {
  // Banco/pool fora (ex.: P2028 sem conexao livre): NAO e problema do token.
  const quebrado = new JwtAuthGuard(new Reflector(), jwt, {
    run: () => Promise.reject(new Error('P2028 Unable to start a transaction')),
  } as unknown as TenantPrismaService);

  it('erro de infraestrutura com token valido: 503 fixo + Retry-After 2', async () => {
    const { ctx, req, headers } = contexto(
      await jwt.signAsync({ sub: psicologoA, clinicaId: A }),
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
