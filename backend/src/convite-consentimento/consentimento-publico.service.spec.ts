import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { relogio } from '../comum/relogio';
import type { ConsentimentoService } from '../consentimento/consentimento.service';
import { TERMO_VIGENTE } from '../consentimento/termo-consentimento';
import type { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ConsentimentoPublicoService } from './consentimento-publico.service';
import { gerarToken, hashToken, LINK_INVALIDO } from './convite.token';

const AGORA = new Date('2026-11-05T12:00:00.000Z');
const convite = {
  id: randomUUID(),
  clinicaId: randomUUID(),
  psicologoId: randomUUID(),
  pacienteId: randomUUID(),
};

afterEach(() => jest.restoreAllMocks());

// Banco FALSO sem RLS. `runConvite` chama fn com o tx falso e um `assumirDono` que registra a ordem.
function montar(opts: { count?: number; psicologo?: boolean } = {}) {
  jest.spyOn(relogio, 'agora').mockReturnValue(AGORA);
  const chamadas: string[] = [];
  const tx = {
    conviteConsentimento: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          ...convite,
          expiraEm: new Date('2026-11-12T12:00:00.000Z'),
        }),
      ),
      findFirstOrThrow: jest.fn(() => Promise.resolve(convite)),
      updateMany: jest.fn<Promise<{ count: number }>, [object]>(() => {
        chamadas.push('virar');
        return Promise.resolve({ count: opts.count ?? 1 });
      }),
    },
    psicologo: {
      findFirst: jest.fn<Promise<object | null>, [object]>(() =>
        Promise.resolve(
          opts.psicologo === false
            ? null
            : { nome: 'Ana Teste', clinica: { nome: 'Clinica Teste' } },
        ),
      ),
    },
  };
  const hashes: string[] = [];
  const tenant = {
    runConvite: jest.fn(
      (
        hash: string,
        fn: (
          t: typeof tx,
          assumir: (d: object) => Promise<void>,
        ) => Promise<unknown>,
      ) => {
        hashes.push(hash);
        return fn(tx, () => {
          chamadas.push('assumirDono');
          return Promise.resolve();
        });
      },
    ),
  };
  const registrar = jest.fn((...a: unknown[]) => {
    chamadas.push(`auditoria:${String(a[2])}`);
    return Promise.resolve();
  });
  const concederPorConvite = jest.fn(() => {
    chamadas.push('conceder');
    return Promise.resolve(true);
  });
  const service = new ConsentimentoPublicoService(
    tenant as unknown as TenantPrismaService,
    { registrar },
    { concederPorConvite } as unknown as ConsentimentoService,
  );
  return { tx, service, registrar, concederPorConvite, chamadas, hashes };
}

const VALIDO = (hash: string) => ({
  tokenHash: hash,
  estado: 'PENDENTE',
  expiraEm: { gt: AGORA },
  termoVersao: TERMO_VIGENTE.versao,
});

describe('ConsentimentoPublicoService.aceitar', () => {
  it('UPDATE condicional: PENDENTE, nao expirado e termo vigente, pelo hash (nunca pelo token cru)', async () => {
    const token = gerarToken();
    const { tx, service, hashes } = montar();
    await service.aceitar(token);
    expect(hashes).toEqual([hashToken(token)]);
    expect(tx.conviteConsentimento.updateMany.mock.calls[0][0]).toEqual({
      where: VALIDO(hashToken(token)),
      data: { estado: 'ACEITO', usadoEm: AGORA },
    });
    expect(
      JSON.stringify(tx.conviteConsentimento.updateMany.mock.calls),
    ).not.toContain(token);
  });

  it('ordem: convite ACEITO -> dono assumido -> evento -> auditoria; auditoria em nome do DONO do convite', async () => {
    const { service, registrar, concederPorConvite, chamadas } = montar();
    await expect(service.aceitar(gerarToken())).resolves.toEqual({ ok: true });
    expect(chamadas).toEqual([
      'virar',
      'assumirDono',
      'conceder',
      'auditoria:PACIENTE_ACEITOU_TERMO',
    ]);
    expect(concederPorConvite.mock.calls[0] as unknown[]).toEqual([
      expect.anything(),
      convite,
      convite.pacienteId,
      convite.id,
    ]);
    expect(registrar.mock.calls[0].slice(1)).toEqual([
      convite,
      'PACIENTE_ACEITOU_TERMO',
      'Consentimento',
      convite.pacienteId,
    ]);
  });

  it('0 linhas atualizadas (usado, expirado, cancelado, desconhecido) = 404 generico e NADA mais acontece', async () => {
    const { service, registrar, concederPorConvite, chamadas } = montar({
      count: 0,
    });
    await expect(service.aceitar(gerarToken())).rejects.toEqual(
      new NotFoundException(LINK_INVALIDO),
    );
    expect(chamadas).toEqual(['virar']);
    expect(concederPorConvite).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('psicologo desativado = 404 generico (a transacao desfaz o UPDATE)', async () => {
    const { service, concederPorConvite } = montar({ psicologo: false });
    await expect(service.aceitar(gerarToken())).rejects.toEqual(
      new NotFoundException(LINK_INVALIDO),
    );
    expect(concederPorConvite).not.toHaveBeenCalled();
  });

  it('colisao de seq (registro manual no mesmo instante): tenta UMA vez de novo', async () => {
    const { Prisma } =
      jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
    const { service, concederPorConvite } = montar();
    concederPorConvite.mockImplementationOnce(() =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      ),
    );
    await expect(service.aceitar(gerarToken())).resolves.toEqual({ ok: true });
    expect(concederPorConvite).toHaveBeenCalledTimes(2);
  });

  it('colisao persistente sobe depois de 2 tentativas; outro erro sobe na hora', async () => {
    const { Prisma } =
      jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
    const dup = () =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
    const a = montar();
    a.concederPorConvite.mockImplementation(dup);
    await expect(a.service.aceitar(gerarToken())).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(a.concederPorConvite).toHaveBeenCalledTimes(2);
    const b = montar();
    b.concederPorConvite.mockImplementation(() =>
      Promise.reject(new Error('banco caiu')),
    );
    await expect(b.service.aceitar(gerarToken())).rejects.toThrow('banco caiu');
    expect(b.concederPorConvite).toHaveBeenCalledTimes(1);
  });
});

describe('ConsentimentoPublicoService.recusar', () => {
  it('convite RECUSADO (condicional), nenhum Consentimento, auditoria PACIENTE_RECUSOU_TERMO', async () => {
    const token = gerarToken();
    const { tx, service, registrar, concederPorConvite, chamadas } = montar();
    await expect(service.recusar(token)).resolves.toEqual({ ok: true });
    expect(tx.conviteConsentimento.updateMany.mock.calls[0][0]).toEqual({
      where: VALIDO(hashToken(token)),
      data: { estado: 'RECUSADO', usadoEm: AGORA },
    });
    expect(concederPorConvite).not.toHaveBeenCalled();
    expect(chamadas).toEqual([
      'virar',
      'assumirDono',
      'auditoria:PACIENTE_RECUSOU_TERMO',
    ]);
    expect(registrar.mock.calls[0].slice(1)).toEqual([
      convite,
      'PACIENTE_RECUSOU_TERMO',
      'Consentimento',
      convite.pacienteId,
    ]);
  });

  it('0 linhas = 404 generico sem auditar', async () => {
    const { service, registrar } = montar({ count: 0 });
    await expect(service.recusar(gerarToken())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('ConsentimentoPublicoService.abrir', () => {
  it('devolve clinica, psicologo, termo vigente e expiracao: nada do paciente; nao audita nem grava', async () => {
    const { tx, service, registrar } = montar();
    const r = await service.abrir(gerarToken());
    expect(r).toEqual({
      clinica: 'Clinica Teste',
      psicologo: 'Ana Teste',
      termo: { versao: TERMO_VIGENTE.versao, texto: TERMO_VIGENTE.texto },
      expiraEm: '2026-11-12T12:00:00.000Z',
    });
    expect(JSON.stringify(r)).not.toContain(convite.pacienteId);
    expect(tx.conviteConsentimento.updateMany).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
    expect(tx.conviteConsentimento.findFirst.mock.calls[0]).toBeDefined();
  });

  it('o filtro do convite e o mesmo de aceitar (PENDENTE, prazo, termo vigente)', async () => {
    const token = gerarToken();
    const { tx, service } = montar();
    await service.abrir(token);
    expect(
      (
        tx.conviteConsentimento.findFirst.mock.calls[0] as unknown as [
          { where: object },
        ]
      )[0].where,
    ).toEqual(VALIDO(hashToken(token)));
  });

  it('convite que nao vale ou psicologo desativado = o MESMO 404', async () => {
    const a = montar();
    a.tx.conviteConsentimento.findFirst.mockResolvedValueOnce(null as never);
    await expect(a.service.abrir(gerarToken())).rejects.toEqual(
      new NotFoundException(LINK_INVALIDO),
    );
    const b = montar({ psicologo: false });
    await expect(b.service.abrir(gerarToken())).rejects.toEqual(
      new NotFoundException(LINK_INVALIDO),
    );
  });
});
