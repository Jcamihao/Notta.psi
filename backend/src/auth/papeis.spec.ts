import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Papel } from '@prisma/client';
import { Papeis, PapeisGuard } from './papeis';

// Classes e metodos de teste: o decorator grava metadado, o guard le com o Reflector real.
class SemDecorator {
  rota() {}
}

@Papeis('ADMIN')
class ClasseAdmin {
  rota() {}
  @Papeis('PSICOLOGO')
  rotaPsicologo() {}
}

class Metodos {
  @Papeis('ADMIN')
  soAdmin() {}
  @Papeis('ADMIN', 'PSICOLOGO')
  qualquerPapel() {}
}

const guard = new PapeisGuard(new Reflector());

function pode(
  classe: new () => object,
  metodo: string,
  papel: Papel | undefined,
) {
  const req = { user: papel ? { papel } : undefined };
  const ctx = {
    getHandler: () => (classe.prototype as Record<string, unknown>)[metodo],
    getClass: () => classe,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return guard.canActivate(ctx);
}

describe('PapeisGuard', () => {
  it('sem @Papeis: qualquer autenticado passa (e rota publica, sem user, tambem)', () => {
    expect(pode(SemDecorator, 'rota', 'PSICOLOGO')).toBe(true);
    expect(pode(SemDecorator, 'rota', 'ADMIN')).toBe(true);
    expect(pode(SemDecorator, 'rota', undefined)).toBe(true);
  });

  it("@Papeis('ADMIN') no metodo: ADMIN passa, PSICOLOGO barrado", () => {
    expect(pode(Metodos, 'soAdmin', 'ADMIN')).toBe(true);
    expect(pode(Metodos, 'soAdmin', 'PSICOLOGO')).toBe(false);
  });

  it('varios papeis: qualquer um da lista passa', () => {
    expect(pode(Metodos, 'qualquerPapel', 'ADMIN')).toBe(true);
    expect(pode(Metodos, 'qualquerPapel', 'PSICOLOGO')).toBe(true);
  });

  it('decorator na classe vale para metodo sem decorator', () => {
    expect(pode(ClasseAdmin, 'rota', 'ADMIN')).toBe(true);
    expect(pode(ClasseAdmin, 'rota', 'PSICOLOGO')).toBe(false);
  });

  it('metodo vence a classe', () => {
    expect(pode(ClasseAdmin, 'rotaPsicologo', 'PSICOLOGO')).toBe(true);
    expect(pode(ClasseAdmin, 'rotaPsicologo', 'ADMIN')).toBe(false);
  });

  it('com @Papeis e sem user (nunca deveria chegar): barra, falha fechada', () => {
    expect(pode(Metodos, 'soAdmin', undefined)).toBe(false);
  });
});
