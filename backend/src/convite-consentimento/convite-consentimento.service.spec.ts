import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { relogio } from '../comum/relogio';
import { TERMO_VIGENTE } from '../consentimento/termo-consentimento';
import type { ConsentimentoService } from '../consentimento/consentimento.service';
import type { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ConviteConsentimentoService } from './convite-consentimento.service';
import { hashToken } from './convite.token';

const user = {
  psicologoId: randomUUID(),
  clinicaId: randomUUID(),
  papel: 'PSICOLOGO' as const,
  senhaProvisoria: false,
};
const pacienteId = randomUUID();
const AGORA = new Date('2026-11-05T12:00:00.000Z');
const APP_URL = 'https://app.exemplo.com';
const dono = { clinicaId: user.clinicaId, psicologoId: user.psicologoId };

afterEach(() => jest.restoreAllMocks());

type Linha = {
  id: string;
  estado: string;
  criadoEm: Date;
  expiraEm: Date;
  usadoEm: Date | null;
  termoVersao: string;
};

// Banco FALSO sem RLS: prova o filtro por dono NO CODIGO e a ordem das chamadas.
function montar(
  opts: {
    achaPaciente?: boolean;
    estado?: 'NENHUM' | 'CONCEDIDO' | 'REVOGADO';
    pendente?: { id: string } | null;
    linhas?: Linha[];
    updateCount?: number;
  } = {},
) {
  jest.spyOn(relogio, 'agora').mockReturnValue(AGORA);
  const chamadas: string[] = [];
  const tx = {
    paciente: {
      findFirst: jest.fn<Promise<{ id: string } | null>, [object]>(() =>
        Promise.resolve(
          opts.achaPaciente === false ? null : { id: pacienteId },
        ),
      ),
    },
    conviteConsentimento: {
      findFirst: jest.fn<Promise<{ id: string } | null>, [object]>(() =>
        Promise.resolve(opts.pendente ?? null),
      ),
      findMany: jest.fn<Promise<Linha[]>, [object]>(() =>
        Promise.resolve(opts.linhas ?? []),
      ),
      updateMany: jest.fn<Promise<{ count: number }>, [object]>(() => {
        chamadas.push('update');
        return Promise.resolve({ count: opts.updateCount ?? 1 });
      }),
      create: jest.fn(({ data }: { data: { expiraEm: Date } }) => {
        chamadas.push('create');
        return Promise.resolve({ id: 'conv-novo', expiraEm: data.expiraEm });
      }),
    },
  };
  const tenant = {
    runComoUsuario: jest.fn(
      (_u: object, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
  const registrar = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());
  const consentimento = {
    estadoDe: jest.fn(() => Promise.resolve(opts.estado ?? 'NENHUM')),
  };
  const service = new ConviteConsentimentoService(
    tenant as unknown as TenantPrismaService,
    { registrar },
    consentimento as unknown as ConsentimentoService,
    { appUrl: APP_URL },
  );
  return { tx, service, registrar, chamadas };
}

describe('ConviteConsentimentoService.criar', () => {
  it('grava SO o hash do token, com dono do token, termo vigente e prazo de 7 dias; devolve o link com o token', async () => {
    const { tx, service, registrar } = montar();
    const r = await service.criar(user, pacienteId);
    const data = (
      tx.conviteConsentimento.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    const token = r.link.replace(`${APP_URL}/termo/`, '');
    expect(r.link).toBe(`${APP_URL}/termo/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data).toEqual({
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
      pacienteId,
      tokenHash: hashToken(token),
      termoVersao: TERMO_VIGENTE.versao,
      expiraEm: new Date(AGORA.getTime() + 7 * 24 * 3600 * 1000),
    });
    expect(JSON.stringify(data)).not.toContain(token);
    expect(r).toEqual({
      id: 'conv-novo',
      link: r.link,
      expiraEm: '2026-11-12T12:00:00.000Z',
    });
    expect(registrar).toHaveBeenCalledWith(
      tx,
      user,
      'CRIOU_CONVITE',
      'ConviteConsentimento',
      'conv-novo',
    );
  });

  it('a cada convite um token diferente', async () => {
    const { service } = montar();
    const a = await service.criar(user, pacienteId);
    const b = await service.criar(user, pacienteId);
    expect(a.link).not.toBe(b.link);
  });

  it('where do paciente com o dono do token; 404 sem gravar nem auditar', async () => {
    const { tx, service, registrar } = montar({ achaPaciente: false });
    await expect(service.criar(user, pacienteId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.paciente.findFirst.mock.calls[0][0]).toEqual({
      where: { id: pacienteId, ...dono },
      select: { id: true },
    });
    expect(tx.conviteConsentimento.create).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('consentimento ja CONCEDIDO = 409 e nada gravado', async () => {
    const { tx, service, registrar } = montar({ estado: 'CONCEDIDO' });
    await expect(service.criar(user, pacienteId)).rejects.toMatchObject({
      status: 409,
      message: 'Consentimento ja concedido',
    });
    expect(tx.conviteConsentimento.create).not.toHaveBeenCalled();
    expect(tx.conviteConsentimento.updateMany).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it.each(['NENHUM', 'REVOGADO'] as const)(
    'estado %s permite criar',
    async (estado) => {
      const { service } = montar({ estado });
      await expect(service.criar(user, pacienteId)).resolves.toMatchObject({
        id: 'conv-novo',
      });
    },
  );

  it('substitui o PENDENTE: cancela (condicional, com o dono) ANTES de criar e audita as duas', async () => {
    const { tx, service, registrar, chamadas } = montar({
      pendente: { id: 'conv-velho' },
    });
    await service.criar(user, pacienteId);
    expect(chamadas).toEqual(['update', 'create']);
    expect(tx.conviteConsentimento.findFirst.mock.calls[0][0]).toMatchObject({
      where: { ...dono, pacienteId, estado: 'PENDENTE' },
    });
    expect(tx.conviteConsentimento.updateMany.mock.calls[0][0]).toEqual({
      where: { ...dono, id: 'conv-velho', estado: 'PENDENTE' },
      data: { estado: 'CANCELADO', usadoEm: AGORA },
    });
    expect(registrar.mock.calls.map((c) => [c[2], c[4]])).toEqual([
      ['CANCELOU_CONVITE', 'conv-velho'],
      ['CRIOU_CONVITE', 'conv-novo'],
    ]);
  });

  it('o PENDENTE ja nao esta pendente na hora do cancelamento (paciente aceitou agora): 409, nada criado', async () => {
    const { tx, service } = montar({
      pendente: { id: 'conv-velho' },
      updateCount: 0,
    });
    await expect(service.criar(user, pacienteId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.conviteConsentimento.create).not.toHaveBeenCalled();
  });

  it('colisao do indice unico parcial (2 envios simultaneos) vira 409', async () => {
    const { tx, service } = montar();
    const { Prisma } =
      jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
    tx.conviteConsentimento.create.mockImplementationOnce(() =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      ),
    );
    await expect(service.criar(user, pacienteId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ConviteConsentimentoService.listar', () => {
  const linha = (id: string, estado: string, expiraEm: string): Linha => ({
    id,
    estado,
    criadoEm: new Date('2026-11-01T12:00:00Z'),
    expiraEm: new Date(expiraEm),
    usadoEm: estado === 'PENDENTE' ? null : new Date('2026-11-02T12:00:00Z'),
    termoVersao: 'v1-rascunho',
  });

  it('sem token nem link nem hash; expirado so para PENDENTE vencido; audita LISTOU; ate 20 do dono', async () => {
    const { tx, service, registrar } = montar({
      linhas: [
        linha('a', 'PENDENTE', '2026-11-10T00:00:00Z'),
        linha('b', 'PENDENTE', '2026-11-05T11:59:59Z'),
        linha('c', 'ACEITO', '2026-11-01T00:00:00Z'),
      ],
    });
    const r = await service.listar(user, pacienteId);
    expect(r.map((x) => [x.id, x.estado, x.expirado])).toEqual([
      ['a', 'PENDENTE', false],
      ['b', 'PENDENTE', true],
      ['c', 'ACEITO', false],
    ]);
    expect(Object.keys(r[0]).sort()).toEqual(
      [
        'criadoEm',
        'estado',
        'expirado',
        'expiraEm',
        'id',
        'termoVersao',
        'usadoEm',
      ].sort(),
    );
    expect(JSON.stringify(r)).not.toMatch(/tokenHash|link|token/);
    expect(r[0].usadoEm).toBeNull();
    expect(r[2].usadoEm).toBe('2026-11-02T12:00:00.000Z');
    expect(tx.conviteConsentimento.findMany.mock.calls[0][0]).toMatchObject({
      where: { ...dono, pacienteId },
      orderBy: { criadoEm: 'desc' },
      take: 20,
    });
    const select = (
      tx.conviteConsentimento.findMany.mock.calls[0][0] as { select: object }
    ).select;
    expect(select).not.toHaveProperty('tokenHash');
    expect(registrar).toHaveBeenCalledWith(
      tx,
      user,
      'LISTOU',
      'ConviteConsentimento',
      pacienteId,
    );
  });

  it('paciente alheio = 404 sem auditar', async () => {
    const { service, registrar } = montar({ achaPaciente: false });
    await expect(service.listar(user, pacienteId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('ConviteConsentimentoService.cancelar', () => {
  const id = randomUUID();

  it('UPDATE condicional PENDENTE com o dono do token; audita CANCELOU_CONVITE', async () => {
    const { tx, service, registrar } = montar();
    await expect(service.cancelar(user, pacienteId, id)).resolves.toEqual({
      id,
      estado: 'CANCELADO',
    });
    expect(tx.conviteConsentimento.updateMany.mock.calls[0][0]).toEqual({
      where: { ...dono, id, pacienteId, estado: 'PENDENTE' },
      data: { estado: 'CANCELADO', usadoEm: AGORA },
    });
    expect(registrar).toHaveBeenCalledWith(
      tx,
      user,
      'CANCELOU_CONVITE',
      'ConviteConsentimento',
      id,
    );
  });

  it('existe mas nao esta pendente = 409; inexistente ou alheio = 404; nenhum audita', async () => {
    const a = montar({ updateCount: 0, pendente: { id } });
    await expect(
      a.service.cancelar(user, pacienteId, id),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Convite nao esta pendente',
    });
    expect(a.registrar).not.toHaveBeenCalled();
    const b = montar({ updateCount: 0, pendente: null });
    await expect(
      b.service.cancelar(user, pacienteId, id),
    ).rejects.toMatchObject({ status: 404 });
    expect(b.registrar).not.toHaveBeenCalled();
  });

  it('paciente alheio = 404 antes de tocar no convite', async () => {
    const { tx, service } = montar({ achaPaciente: false });
    await expect(service.cancelar(user, pacienteId, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.conviteConsentimento.updateMany).not.toHaveBeenCalled();
  });
});
