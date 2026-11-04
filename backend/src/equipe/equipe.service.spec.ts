import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
          Promise<{ id: string; ativo: boolean; desativadoEm: Date | null }>,
          [{ data: Prisma.PsicologoUncheckedCreateInput; select: object }]
        >()
        .mockResolvedValue({ id: 'novo-id', ativo: true, desativadoEm: null }),
      updateMany: jest
        .fn<Promise<{ count: number }>, [Prisma.PsicologoUpdateManyArgs]>()
        .mockResolvedValue({ count: 1 }),
      findFirst: jest
        .fn<Promise<object | null>, [Prisma.PsicologoFindFirstArgs]>()
        .mockResolvedValue(null),
      findFirstOrThrow: jest
        .fn<Promise<object>, [Prisma.PsicologoFindFirstOrThrowArgs]>()
        .mockResolvedValue({ id: 'x' }),
    },
  };
  const tenant = {
    run: jest.fn((_id: string, fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    runComoUsuario: jest.fn(
      (_u: object, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
  const auditoria = {
    registrar: jest.fn<Promise<void>, unknown[]>().mockResolvedValue(),
  };
  const service = new EquipeService(
    tenant as unknown as TenantPrismaService,
    auditoria,
  );
  return { tx, tenant, auditoria, service };
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
        ativo: false,
        desativadoEm: criadoEm,
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
        ativo: false,
        desativadoEm: criadoEm,
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
      ativo: true,
      desativadoEm: null,
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
    expect(select).toEqual({ id: true, ativo: true, desativadoEm: true });
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

describe('EquipeService.desativar', () => {
  const alvo = randomUUID();

  it('UPDATE atomico no WHERE (id, clinicaId, PSICOLOGO, ativo) como o ADMIN, e audita DESATIVOU na mesma tx', async () => {
    const { tx, tenant, auditoria, service } = montar();
    await service.desativar(user, alvo);
    expect(tenant.runComoUsuario).toHaveBeenCalledWith(
      user,
      expect.any(Function),
    );
    const { where, data } = tx.psicologo.updateMany.mock.calls[0][0];
    expect(where).toEqual({
      id: alvo,
      clinicaId: user.clinicaId,
      papel: 'PSICOLOGO',
      ativo: true,
    });
    expect(data).toEqual({
      ativo: false,
      desativadoEm: expect.any(Date) as Date,
    });
    expect(auditoria.registrar).toHaveBeenCalledWith(
      tx,
      user,
      'DESATIVOU',
      'Psicologo',
      alvo,
    );
    const { where: w2 } = tx.psicologo.findFirstOrThrow.mock.calls[0][0];
    expect(w2).toEqual({ id: alvo, clinicaId: user.clinicaId });
  });

  it('0 linhas: inexistente = 404; ja desativado = 409; ativo (proprio ou ADMIN) = 409 outro texto; nada auditado', async () => {
    const { tx, auditoria, service } = montar();
    tx.psicologo.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.desativar(user, alvo)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    tx.psicologo.findFirst.mockResolvedValue({ ativo: false });
    await expect(service.desativar(user, alvo)).rejects.toEqual(
      new ConflictException('Psicologo ja desativado'),
    );
    tx.psicologo.findFirst.mockResolvedValue({ ativo: true });
    await expect(service.desativar(user, alvo)).rejects.toEqual(
      new ConflictException('Nao e possivel desativar este usuario'),
    );
    expect(tx.psicologo.findFirst.mock.calls[0][0].where).toEqual({
      id: alvo,
      clinicaId: user.clinicaId,
    });
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('falha da auditoria sobe (a transacao desfaz a desativacao)', async () => {
    const { auditoria, service } = montar();
    auditoria.registrar.mockRejectedValueOnce(new Error('trilha'));
    await expect(service.desativar(user, alvo)).rejects.toThrow('trilha');
  });
});
