import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConsentimentoService, transicaoValida } from './consentimento.service';
import type { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TERMO_V1 } from './termo';

const user = {
  psicologoId: randomUUID(),
  clinicaId: randomUUID(),
  papel: 'PSICOLOGO' as const,
  senhaProvisoria: false,
};
const pacienteId = randomUUID();

describe('transicaoValida (maquina de estados)', () => {
  it.each([
    ['NENHUM', 'CONCEDIDO', true],
    ['REVOGADO', 'CONCEDIDO', true],
    ['CONCEDIDO', 'CONCEDIDO', false],
    ['CONCEDIDO', 'REVOGADO', true],
    ['NENHUM', 'REVOGADO', false],
    ['REVOGADO', 'REVOGADO', false],
  ] as const)('%s --%s--> %s', (estado, evento, ok) => {
    expect(transicaoValida(estado, evento)).toBe(ok);
  });
});

type Linha = {
  seq: number;
  evento: string;
  termoVersao: string;
  termoTexto: string;
  criadoEm: Date;
};

// Banco FALSO sem RLS: prova o filtro por dono NO CODIGO.
function montar(linhas: Linha[] = [], achaPaciente = true) {
  const tx = {
    paciente: {
      findFirst: jest.fn<Promise<{ id: string } | null>, [object]>(() =>
        Promise.resolve(achaPaciente ? { id: pacienteId } : null),
      ),
    },
    consentimento: {
      findFirst: jest.fn<Promise<Linha | null>, [object]>(() =>
        Promise.resolve(linhas[linhas.length - 1] ?? null),
      ),
      findMany: jest.fn<Promise<Linha[]>, [object]>(() =>
        Promise.resolve(linhas),
      ),
      create: jest.fn(({ data }: { data: Linha }) => {
        linhas.push({ ...data, criadoEm: new Date('2026-11-01T12:00:00Z') });
        return Promise.resolve(data);
      }),
    },
  };
  const tenant = {
    runComoUsuario: jest.fn(
      (_u: object, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
  const registrar = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());
  const service = new ConsentimentoService(
    tenant as unknown as TenantPrismaService,
    { registrar },
  );
  return { tx, service, registrar, linhas };
}

const concedido = (seq: number): Linha => ({
  seq,
  evento: 'CONCEDIDO',
  termoVersao: 'antigo-0',
  termoTexto: 'texto antigo',
  criadoEm: new Date('2026-10-31T12:00:00Z'),
});

describe('ConsentimentoService.registrar', () => {
  it('NENHUM -> CONCEDIDO: seq 1, termo do servidor, dono do token, auditoria CONCEDEU', async () => {
    const { tx, service, registrar } = montar();
    const r = await service.registrar(user, pacienteId, 'CONCEDIDO');
    expect(tx.consentimento.create).toHaveBeenCalledWith({
      data: {
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
        pacienteId,
        seq: 1,
        evento: 'CONCEDIDO',
        termoVersao: TERMO_V1.versao,
        termoTexto: TERMO_V1.texto,
      },
    });
    expect(registrar).toHaveBeenCalledWith(
      tx,
      user,
      'CONCEDEU',
      'Consentimento',
      pacienteId,
    );
    expect(r.estado).toBe('CONCEDIDO');
    expect(r.historico).toHaveLength(1);
  });

  it('CONCEDIDO -> REVOGADO: seq+1, repete versao e texto do ultimo concedido, auditoria REVOGOU', async () => {
    const { tx, service, registrar } = montar([concedido(1)]);
    await service.registrar(user, pacienteId, 'REVOGADO');
    expect(tx.consentimento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seq: 2,
        evento: 'REVOGADO',
        termoVersao: 'antigo-0',
        termoTexto: 'texto antigo',
      }) as object,
    });
    expect(registrar).toHaveBeenCalledWith(
      tx,
      user,
      'REVOGOU',
      'Consentimento',
      pacienteId,
    );
  });

  it.each([
    ['CONCEDIDO', 'CONCEDIDO'],
    ['NENHUM', 'REVOGADO'],
    ['REVOGADO', 'REVOGADO'],
  ] as const)('estado %s + %s = 409 e nada gravado', async (estado, evento) => {
    const linhas =
      estado === 'NENHUM'
        ? []
        : [
            estado === 'CONCEDIDO'
              ? concedido(1)
              : { ...concedido(1), evento: 'REVOGADO' },
          ];
    const { tx, service, registrar } = montar(linhas);
    await expect(
      service.registrar(user, pacienteId, evento),
    ).rejects.toMatchObject({ status: 409, message: 'Transicao invalida' });
    expect(tx.consentimento.create).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('paciente inexistente ou alheio = 404, sem gravar nem auditar; where com o dono do token', async () => {
    const { tx, service, registrar } = montar([], false);
    await expect(
      service.registrar(user, pacienteId, 'CONCEDIDO'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.paciente.findFirst.mock.calls[0][0]).toEqual({
      where: {
        id: pacienteId,
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
      },
      select: { id: true },
    });
    expect(tx.consentimento.create).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('colisao de seq (P2002 do unique) vira 409 igual', async () => {
    const { tx, service } = montar();
    const { Prisma } =
      jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
    tx.consentimento.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      service.registrar(user, pacienteId, 'CONCEDIDO'),
    ).rejects.toMatchObject({ status: 409, message: 'Transicao invalida' });
  });
});

describe('ConsentimentoService.obter', () => {
  it('sem linhas: NENHUM, desde null, historico vazio; audita LEU; where com o dono', async () => {
    const { tx, service, registrar } = montar();
    await expect(service.obter(user, pacienteId)).resolves.toEqual({
      estado: 'NENHUM',
      desde: null,
      historico: [],
    });
    expect(registrar).toHaveBeenCalledWith(
      tx,
      user,
      'LEU',
      'Consentimento',
      pacienteId,
    );
    expect(tx.consentimento.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        pacienteId,
        clinicaId: user.clinicaId,
        psicologoId: user.psicologoId,
      },
      orderBy: { seq: 'asc' },
    });
  });

  it('404 nao audita', async () => {
    const { service, registrar } = montar([], false);
    await expect(service.obter(user, pacienteId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('ConsentimentoService.exigirConcedido', () => {
  it('CONCEDIDO passa', async () => {
    const { tx, service } = montar([concedido(1)]);
    await expect(
      service.exigirConcedido(tx as never, user, pacienteId),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['NENHUM', []],
    ['REVOGADO', [{ ...concedido(1), evento: 'REVOGADO' }]],
  ])('%s = 403 "Consentimento nao concedido"', async (_n, linhas) => {
    const { tx, service } = montar(linhas);
    await expect(
      service.exigirConcedido(tx as never, user, pacienteId),
    ).rejects.toEqual(new ForbiddenException('Consentimento nao concedido'));
  });
});
