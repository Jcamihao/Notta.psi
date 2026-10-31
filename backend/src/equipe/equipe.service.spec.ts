import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EquipeService } from './equipe.service';

// Banco FALSO sem RLS: prova o filtro por clinicaId NO CODIGO (no e2e a RLS mascararia).
const user = {
  psicologoId: randomUUID(),
  clinicaId: randomUUID(),
  papel: 'ADMIN' as const,
  senhaProvisoria: false,
};

function montar() {
  const tx = {
    psicologo: {
      findMany: jest
        .fn<Promise<object[]>, [Prisma.PsicologoFindManyArgs]>()
        .mockResolvedValue([]),
      create: jest
        .fn<
          Promise<{ id: string }>,
          [{ data: Prisma.PsicologoUncheckedCreateInput; select: object }]
        >()
        .mockResolvedValue({ id: 'novo-id' }),
    },
  };
  const tenant = {
    run: jest.fn((_id: string, fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const service = new EquipeService(tenant as unknown as TenantPrismaService);
  return { tx, tenant, service };
}

const dto = {
  nome: 'Novo',
  email: '  Novo@Clinica.COM ',
  senha: 'senha-forte-123',
  abordagemPadrao: 'TCC' as const,
};

describe('EquipeService.listar', () => {
  it('filtra por clinicaId do usuario no where, ordena por createdAt e nao pede senhaHash', async () => {
    const { tx, tenant, service } = montar();
    await service.listar(user);
    expect(tenant.run).toHaveBeenCalledWith(
      user.clinicaId,
      expect.any(Function),
    );
    const args = tx.psicologo.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ clinicaId: user.clinicaId });
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
    expect(args.select).toBeDefined();
    expect(args.select?.senhaHash).toBeUndefined();
  });

  it('mapeia id -> psicologoId e createdAt -> criadoEm', async () => {
    const { tx, service } = montar();
    const criadoEm = new Date('2026-10-30T12:00:00Z');
    tx.psicologo.findMany.mockResolvedValue([
      {
        id: 'p1',
        nome: 'Ana',
        email: 'ana@x.com',
        papel: 'ADMIN',
        abordagemPadrao: 'TCC',
        createdAt: criadoEm,
      },
    ]);
    await expect(service.listar(user)).resolves.toEqual([
      {
        psicologoId: 'p1',
        nome: 'Ana',
        email: 'ana@x.com',
        papel: 'ADMIN',
        abordagemPadrao: 'TCC',
        criadoEm,
      },
    ]);
  });
});

describe('EquipeService.criar', () => {
  it('cria na clinica do usuario, papel PSICOLOGO, senha provisoria, e-mail normalizado, hash bcrypt custo 12', async () => {
    const { tx, tenant, service } = montar();
    await expect(service.criar(user, dto)).resolves.toEqual({
      psicologoId: 'novo-id',
    });
    expect(tenant.run.mock.calls[0][0]).toBe(user.clinicaId);
    const { data, select } = tx.psicologo.create.mock.calls[0][0];
    expect(data).toMatchObject({
      clinicaId: user.clinicaId,
      nome: 'Novo',
      email: 'novo@clinica.com',
      abordagemPadrao: 'TCC',
      papel: 'PSICOLOGO',
      senhaProvisoria: true,
    });
    expect(data.senhaHash).toMatch(/^\$2[aby]\$12\$/);
    expect(select).toEqual({ id: true });
  });

  it('P2002 -> 409 "E-mail ja cadastrado"; outro erro -> 500 generico', async () => {
    const { tenant, service } = montar();
    tenant.run.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(service.criar(user, dto)).rejects.toEqual(
      new ConflictException('E-mail ja cadastrado'),
    );
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    tenant.run.mockRejectedValueOnce(new Error('qualquer'));
    await expect(service.criar(user, dto)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(log).toHaveBeenCalledWith('falha ao criar psicologo: Error');
    log.mockRestore();
  });
});
