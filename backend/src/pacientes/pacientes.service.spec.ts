import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CriptografiaService } from '../criptografia/criptografia.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PacientesService } from './pacientes.service';

// Banco FALSO sem RLS: prova o filtro por clinicaId E psicologoId NO CODIGO (no e2e a RLS mascararia).
const user = {
  psicologoId: randomUUID(),
  clinicaId: randomUUID(),
  papel: 'ADMIN' as const,
  senhaProvisoria: false,
};

type Linha = Prisma.PacienteUncheckedCreateInput & {
  criadoEm: Date;
  atualizadoEm: Date;
};

function montar() {
  process.env.NOTTA_MASTER_KEY = '0123456789abcdef'.repeat(4);
  const cripto = new CriptografiaService();
  const linhas: Linha[] = [];
  const tx = {
    paciente: {
      create: jest.fn(
        ({ data }: { data: Prisma.PacienteUncheckedCreateInput }) => {
          const l = {
            nascimentoCifrado: null,
            telefoneCifrado: null,
            emailCifrado: null,
            ...data,
            criadoEm: new Date('2026-10-31T12:00:00Z'),
            atualizadoEm: new Date('2026-10-31T12:00:00Z'),
          } as Linha;
          linhas.push(l);
          return Promise.resolve(l);
        },
      ),
      findMany: jest
        .fn<Promise<Linha[]>, [Prisma.PacienteFindManyArgs]>()
        .mockImplementation(() => Promise.resolve(linhas)),
      findFirst: jest
        .fn<Promise<Linha | null>, [Prisma.PacienteFindFirstArgs]>()
        .mockImplementation((args) =>
          Promise.resolve(
            linhas.find((l) => l.id === (args.where as { id: string }).id) ??
              null,
          ),
        ),
      updateMany: jest.fn(
        ({ where, data }: { where: { id: string }; data: Partial<Linha> }) => {
          const l = linhas.find((x) => x.id === where.id);
          if (l) Object.assign(l, data);
          return Promise.resolve({ count: l ? 1 : 0 });
        },
      ),
    },
  };
  const tenant = {
    runComoUsuario: jest.fn(
      (_u: object, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
  const service = new PacientesService(
    tenant as unknown as TenantPrismaService,
    cripto,
  );
  return { tx, tenant, service, cripto, linhas };
}

describe('PacientesService.criar', () => {
  it('cifra os 4 campos (sem texto puro), usa clinica e psicologo do token e devolve o paciente decifrado', async () => {
    const { tx, tenant, service } = montar();
    const r = await service.criar(user, {
      nome: 'Maria da Silva',
      nascimento: '1990-05-17',
      telefone: '+55 (11) 99999-0000',
      email: 'maria@x.com',
    });
    expect(tenant.runComoUsuario).toHaveBeenCalledWith(
      user,
      expect.any(Function),
    );
    const { data } = tx.paciente.create.mock.calls[0][0];
    expect(data.clinicaId).toBe(user.clinicaId);
    expect(data.psicologoId).toBe(user.psicologoId);
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
    const guardado = JSON.stringify(data);
    for (const puro of ['Maria', '1990', '99999', 'maria@x.com']) {
      expect(guardado).not.toContain(puro);
    }
    expect(data.nomeCifrado).toMatch(/^v1\.k1\./);
    expect(r).toEqual({
      id: data.id,
      nome: 'Maria da Silva',
      nascimento: '1990-05-17',
      telefone: '+55 (11) 99999-0000',
      email: 'maria@x.com',
      criadoEm: new Date('2026-10-31T12:00:00Z'),
    });
    expect(Object.keys(r).some((k) => k.endsWith('Cifrado'))).toBe(false);
  });

  it('campos opcionais ausentes viram null e nao sao cifrados', async () => {
    const { tx, service } = montar();
    const r = await service.criar(user, { nome: 'So Nome' });
    const { data } = tx.paciente.create.mock.calls[0][0];
    expect(data.nascimentoCifrado).toBeUndefined();
    expect(r).toMatchObject({
      nome: 'So Nome',
      nascimento: null,
      telefone: null,
      email: null,
    });
  });
});

describe('PacientesService.listar', () => {
  it('filtra por clinicaId e psicologoId do token, teto 500 e ordena por nome pt-BR depois de decifrar', async () => {
    const { tx, service } = montar();
    for (const nome of ['Zélia', 'ana', 'Édson', 'Bruno']) {
      await service.criar(user, { nome });
    }
    const lista = await service.listar(user);
    const args = tx.paciente.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
    });
    expect(args.take).toBe(500);
    expect(lista.map((p) => p.nome)).toEqual([
      'ana',
      'Bruno',
      'Édson',
      'Zélia',
    ]);
  });
});

describe('PacientesService.obter', () => {
  it('where com id, clinicaId e psicologoId do token; inexistente = 404 generico', async () => {
    const { tx, service } = montar();
    const { id } = await service.criar(user, { nome: 'Ana' });
    await expect(service.obter(user, id)).resolves.toMatchObject({
      nome: 'Ana',
    });
    expect(tx.paciente.findFirst.mock.calls[0][0].where).toEqual({
      id,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
    });
    await expect(service.obter(user, randomUUID())).rejects.toEqual(
      new NotFoundException('Paciente nao encontrado'),
    );
  });

  it('falha ao decifrar = 500 generico, log sem texto da coluna', async () => {
    const { service, linhas } = montar();
    const a = await service.criar(user, { nome: 'Ana Secreta' });
    const b = await service.criar(user, { nome: 'Bia' });
    // cifrado de outro paciente na mesma linha: o AAD (id) nao confere
    linhas.find((l) => l.id === a.id)!.nomeCifrado = linhas.find(
      (l) => l.id === b.id,
    )!.nomeCifrado;
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await expect(service.obter(user, a.id)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    const logado = JSON.stringify(log.mock.calls);
    expect(logado).not.toContain('Ana');
    expect(logado).not.toContain('Bia');
    log.mockRestore();
  });
});

describe('PacientesService.atualizar', () => {
  it('cifra so o que veio, null limpa o opcional, filtra por dono no updateMany', async () => {
    const { tx, service } = montar();
    const { id } = await service.criar(user, {
      nome: 'Ana',
      telefone: '11 99999-0000',
      email: 'a@x.com',
    });
    const r = await service.atualizar(user, id, {
      telefone: null,
      email: 'novo@x.com',
    });
    const args = tx.paciente.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({
      id,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
    });
    expect(Object.keys(args.data).sort()).toEqual([
      'emailCifrado',
      'telefoneCifrado',
    ]);
    expect(args.data.telefoneCifrado).toBeNull();
    expect(r).toMatchObject({
      nome: 'Ana',
      telefone: null,
      email: 'novo@x.com',
    });
  });

  it('corpo vazio = 400; id alheio/inexistente = 404', async () => {
    const { service } = montar();
    const { id } = await service.criar(user, { nome: 'Ana' });
    await expect(service.atualizar(user, id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.atualizar(user, randomUUID(), { nome: 'X' }),
    ).rejects.toEqual(new NotFoundException('Paciente nao encontrado'));
  });
});
