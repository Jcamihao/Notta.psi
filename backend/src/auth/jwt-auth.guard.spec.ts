import { randomUUID } from 'node:crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
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
  const ctx = {
    getHandler: () => contexto,
    getClass: () => JwtAuthGuard,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
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

describe('opcoesJwt', () => {
  it.each([
    ['ausente', undefined],
    ['curta', 'z'.repeat(31)],
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
});
