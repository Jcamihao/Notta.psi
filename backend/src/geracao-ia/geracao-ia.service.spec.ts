import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConsentimentoService } from '../consentimento/consentimento.service';
import { CriptografiaService } from '../criptografia/criptografia.service';
import type { DocumentosService } from '../documentos/documentos.service';
import type { IaConfig } from '../ia/ia.config';
import type { PacientesService } from '../pacientes/pacientes.service';
import type { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { GeracaoIaExecutor } from './geracao-ia.executor';
import { GeracaoIaService } from './geracao-ia.service';

// Banco FALSO sem RLS: prova o filtro por clinicaId E psicologoId NO CODIGO (no e2e a RLS
// mascararia), a ordem dos erros e que nada e criado/enviado quando falta consentimento.
const user = {
  psicologoId: randomUUID(),
  clinicaId: randomUUID(),
  papel: 'ADMIN' as const,
  senhaProvisoria: false,
};
const dono = { clinicaId: user.clinicaId, psicologoId: user.psicologoId };
const pacienteId = randomUUID();
const origemId = randomUUID();
const config: IaConfig = {
  habilitada: true,
  url: 'http://x',
  apiKey: 'k',
  timeoutMs: 1000,
  limiteDiario: 2,
};

function montar(
  opcoes: { consentimento?: 'ok' | 'nao'; usadas?: number } = {},
) {
  process.env.NOTTA_MASTER_KEY = '0123456789abcdef'.repeat(4);
  const cripto = new CriptografiaService();
  const tx = {
    paciente: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: pacienteId, ...dono, nomeCifrado: 'x' }),
    },
    documento: {
      findFirst: jest.fn().mockResolvedValue({
        id: origemId,
        ...dono,
        tipo: 'NOTA_BRUTA',
        conteudoCifrado: 'x',
      }),
    },
    psicologo: {
      findFirstOrThrow: jest.fn().mockResolvedValue({ abordagemPadrao: 'TCC' }),
    },
    geracaoIa: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(opcoes.usadas ?? 0),
    },
  };
  const tenant = {
    runComoUsuario: (_u: unknown, fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
  } as unknown as TenantPrismaService;
  const consentimento = {
    exigirConcedido: jest.fn(() =>
      opcoes.consentimento === 'nao'
        ? Promise.reject(new ForbiddenException('Consentimento nao concedido'))
        : Promise.resolve(),
    ),
  };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const executor = { executar: jest.fn().mockResolvedValue(undefined) };
  const service = new GeracaoIaService(
    tenant,
    cripto,
    auditoria,
    consentimento as unknown as ConsentimentoService,
    { textoDe: () => 'nota de Ana' } as unknown as DocumentosService,
    { nomeDe: () => 'Ana' } as unknown as PacientesService,
    executor as unknown as GeracaoIaExecutor,
    config,
  );
  return { tx, service, consentimento, auditoria, executor };
}

describe('GeracaoIaService.previa', () => {
  it('filtra paciente e nota por clinicaId E psicologoId do token', async () => {
    const { tx, service } = montar();
    await service.previa(user, pacienteId, origemId, {
      tipoDocumento: 'EVOLUCAO',
    });
    expect(tx.paciente.findFirst).toHaveBeenCalledWith({
      where: { id: pacienteId, ...dono },
    });
    expect(tx.documento.findFirst).toHaveBeenCalledWith({
      where: { id: origemId, pacienteId, ...dono },
    });
    expect(tx.geracaoIa.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ...dono,
        pacienteId,
        origemId,
        estado: 'PREVIA',
        abordagem: 'TCC',
      }) as object,
    });
  });

  it('sem consentimento: 403 e nada e criado nem auditado (o consentimento e conferido)', async () => {
    const { tx, service, consentimento, auditoria } = montar({
      consentimento: 'nao',
    });
    await expect(
      service.previa(user, pacienteId, origemId, { tipoDocumento: 'EVOLUCAO' }),
    ).rejects.toThrow(ForbiddenException);
    expect(consentimento.exigirConcedido).toHaveBeenCalledWith(
      tx,
      user,
      pacienteId,
    );
    expect(tx.geracaoIa.create).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('paciente que nao e seu: 404 antes do consentimento', async () => {
    const { tx, service, consentimento } = montar();
    tx.paciente.findFirst.mockResolvedValue(null);
    await expect(
      service.previa(user, pacienteId, origemId, { tipoDocumento: 'EVOLUCAO' }),
    ).rejects.toThrow(NotFoundException);
    expect(consentimento.exigirConcedido).not.toHaveBeenCalled();
  });

  it('IA desligada: 503 sem tocar no banco', async () => {
    const { tx } = montar();
    const off = new GeracaoIaService(
      { runComoUsuario: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { ...config, habilitada: false },
    );
    await expect(
      off.previa(user, pacienteId, origemId, { tipoDocumento: 'EVOLUCAO' }),
    ).rejects.toThrow('IA indisponivel');
    expect(tx.paciente.findFirst).not.toHaveBeenCalled();
  });
});

describe('GeracaoIaService.confirmar', () => {
  const id = randomUUID();
  const linha = (estado: string, extra: object = {}) => ({
    id,
    ...dono,
    estado,
    expiraEm: new Date(Date.now() + 60_000),
    retentavel: null,
    avisos: [],
    ...extra,
  });

  it('so o vencedor do UPDATE condicional dispara o executor, e so com consulta/UPDATE filtrados pelo dono', async () => {
    const { tx, service, executor, auditoria } = montar();
    tx.geracaoIa.findFirst.mockResolvedValue(linha('PREVIA'));
    const r = await service.confirmar(user, id);
    expect(r).toEqual({ status: 202, corpo: { id, estado: 'PENDENTE' } });
    const where = (
      tx.geracaoIa.updateMany.mock.calls as { where: object }[][]
    ).find((c) => 'OR' in c[0].where)![0].where;
    expect(where).toMatchObject({ id, ...dono });
    expect(auditoria.registrar).toHaveBeenCalledWith(
      tx,
      user,
      'ENVIOU_IA',
      'GeracaoIa',
      id,
    );
    expect(executor.executar).toHaveBeenCalledWith(id, dono);
  });

  it('perdeu a corrida (0 linhas) e o pedido ja esta PENDENTE: 202 sem disparar nem auditar', async () => {
    const { tx, service, executor, auditoria } = montar();
    tx.geracaoIa.findFirst
      .mockResolvedValueOnce(linha('PREVIA'))
      .mockResolvedValueOnce(linha('PENDENTE'));
    tx.geracaoIa.updateMany.mockResolvedValueOnce({ count: 0 }); // expirarPendentes
    tx.geracaoIa.updateMany.mockResolvedValueOnce({ count: 0 }); // transicao
    const r = await service.confirmar(user, id);
    expect(r.status).toBe(202);
    expect(executor.executar).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('PRONTO: 200 sem disparar; PENDENTE: 202 sem disparar', async () => {
    for (const [estado, status] of [
      ['PRONTO', 200],
      ['PENDENTE', 202],
    ] as const) {
      const { tx, service, executor } = montar();
      tx.geracaoIa.findFirst.mockResolvedValue(linha(estado));
      expect((await service.confirmar(user, id)).status).toBe(status);
      expect(executor.executar).not.toHaveBeenCalled();
    }
  });

  it('limite diario: usadas >= limite = 429 com corpo e Retry-After, sem UPDATE de transicao', async () => {
    const { tx, service, executor } = montar({ usadas: 2 });
    tx.geracaoIa.findFirst.mockResolvedValue(linha('PREVIA'));
    const erro = await service.confirmar(user, id).catch((e: unknown) => e);
    expect(erro).toMatchObject({
      retryAfterSeg: expect.any(Number) as number,
      response: { limite: 2, usadas: 2 },
    });
    expect(tx.geracaoIa.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ ...dono, estado: 'PRONTO' }) as object,
    });
    expect(
      (tx.geracaoIa.updateMany.mock.calls as { where: object }[][]).some(
        (c) => 'OR' in c[0].where,
      ),
    ).toBe(false);
    expect(executor.executar).not.toHaveBeenCalled();
  });

  it('FALHOU nao retentavel = 409; previa expirada = 409; nada dispara', async () => {
    for (const l of [
      linha('FALHOU', { retentavel: false }),
      linha('PREVIA', { expiraEm: new Date(Date.now() - 1000) }),
    ]) {
      const { tx, service, executor } = montar();
      tx.geracaoIa.findFirst.mockResolvedValue(l);
      await expect(service.confirmar(user, id)).rejects.toMatchObject({
        status: 409,
      });
      expect(executor.executar).not.toHaveBeenCalled();
    }
  });
});
