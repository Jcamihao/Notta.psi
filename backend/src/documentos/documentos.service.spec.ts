import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConsentimentoService } from '../consentimento/consentimento.service';
import { CriptografiaService } from '../criptografia/criptografia.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { DocumentosService } from './documentos.service';

// Banco FALSO sem RLS: prova o filtro por clinicaId E psicologoId NO CODIGO (no e2e a RLS mascararia).
const user = {
  psicologoId: randomUUID(),
  clinicaId: randomUUID(),
  papel: 'ADMIN' as const,
  senhaProvisoria: false,
};
const pacienteId = randomUUID();

type Linha = Prisma.DocumentoUncheckedCreateInput & {
  status: string;
  criadoEm: Date;
  atualizadoEm: Date;
};

function montar(opcoes: { pacienteExiste?: boolean } = {}) {
  process.env.NOTTA_MASTER_KEY = '0123456789abcdef'.repeat(4);
  const cripto = new CriptografiaService();
  const linhas: Linha[] = [];
  const tx = {
    paciente: {
      findFirst: jest
        .fn<Promise<{ id: string } | null>, [Prisma.PacienteFindFirstArgs]>()
        .mockResolvedValue(
          opcoes.pacienteExiste === false ? null : { id: pacienteId },
        ),
    },
    documento: {
      create: jest.fn(
        ({ data }: { data: Prisma.DocumentoUncheckedCreateInput }) => {
          const l = {
            status: 'RASCUNHO',
            dataSessao: null,
            aprovadoEm: null,
            substituiId: null,
            ...data,
            criadoEm: new Date('2026-11-03T12:00:00Z'),
            atualizadoEm: new Date('2026-11-03T12:00:00Z'),
          } as Linha;
          linhas.push(l);
          return Promise.resolve(l);
        },
      ),
      findMany: jest
        .fn<Promise<Linha[]>, [Prisma.DocumentoFindManyArgs]>()
        .mockImplementation(() => Promise.resolve(linhas)),
      updateMany: jest
        .fn<Promise<{ count: number }>, [Prisma.DocumentoUpdateManyArgs]>()
        .mockImplementation((args) => {
          const alvo = linhas.find(
            (l) =>
              l.id === (args.where as { id: string }).id &&
              l.status === (args.where as { status: string }).status,
          );
          // undefined = nao mexe na coluna (como o Prisma)
          if (alvo)
            Object.assign(
              alvo,
              Object.fromEntries(
                Object.entries(args.data).filter(([, v]) => v !== undefined),
              ),
            );
          return Promise.resolve({ count: alvo ? 1 : 0 });
        }),
      findFirstOrThrow: jest
        .fn<Promise<Linha>, [Prisma.DocumentoFindFirstOrThrowArgs]>()
        .mockImplementation((args) =>
          Promise.resolve(
            linhas.find((l) => l.id === (args.where as { id: string }).id)!,
          ),
        ),
      findFirst: jest
        .fn<Promise<Linha | null>, [Prisma.DocumentoFindFirstArgs]>()
        .mockImplementation((args) =>
          Promise.resolve(
            linhas.find((l) => l.id === (args.where as { id: string }).id) ??
              null,
          ),
        ),
    },
  };
  const tenant = {
    runComoUsuario: jest.fn(
      (_u: object, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
  const registrar = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());
  const exigirConcedido = jest.fn<Promise<void>, unknown[]>(() =>
    Promise.resolve(),
  );
  const service = new DocumentosService(
    tenant as unknown as TenantPrismaService,
    cripto,
    { registrar },
    { exigirConcedido } as unknown as ConsentimentoService,
  );
  return { tx, service, linhas, registrar, exigirConcedido };
}

const corpo = {
  tipo: 'EVOLUCAO' as const,
  dataSessao: '2026-11-02',
  conteudo: '  Paciente relatou ansiedade forte.\n  ',
};

describe('DocumentosService.criar', () => {
  it('cifra o conteudo (sem texto puro), dono do token, nao apara, devolve decifrado sem *Cifrado', async () => {
    const { tx, service } = montar();
    const r = await service.criar(user, pacienteId, corpo);
    const { data } = tx.documento.create.mock.calls[0][0];
    expect(data).toMatchObject({
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
      pacienteId,
      tipo: 'EVOLUCAO',
    });
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(data)).not.toContain('ansiedade');
    expect(data.conteudoCifrado).toMatch(/^v1\.k1\./);
    expect(data.dataSessao).toEqual(new Date('2026-11-02'));
    expect(r).toEqual({
      id: data.id,
      pacienteId,
      tipo: 'EVOLUCAO',
      dataSessao: '2026-11-02',
      conteudo: corpo.conteudo,
      status: 'RASCUNHO',
      aprovadoEm: null,
      substituiId: null,
      criadoEm: new Date('2026-11-03T12:00:00Z'),
      atualizadoEm: new Date('2026-11-03T12:00:00Z'),
    });
  });

  it('sem dataSessao grava null; audita CRIOU Documento com o id novo', async () => {
    const { tx, service, registrar } = montar();
    const r = await service.criar(user, pacienteId, {
      tipo: 'NOTA_BRUTA',
      conteudo: 'x',
    });
    expect(tx.documento.create.mock.calls[0][0].data.dataSessao).toBeNull();
    expect(r.dataSessao).toBeNull();
    expect(registrar).toHaveBeenCalledWith(
      tx,
      user,
      'CRIOU',
      'Documento',
      r.id,
    );
  });

  it('paciente alheio/inexistente = 404 antes do consentimento; nada gravado nem auditado', async () => {
    const { tx, service, exigirConcedido, registrar } = montar({
      pacienteExiste: false,
    });
    await expect(service.criar(user, pacienteId, corpo)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.paciente.findFirst.mock.calls[0][0].where).toEqual({
      id: pacienteId,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
    });
    expect(exigirConcedido).not.toHaveBeenCalled();
    expect(tx.documento.create).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('sem consentimento concedido = 403 e nada gravado nem auditado', async () => {
    const { tx, service, exigirConcedido, registrar } = montar();
    exigirConcedido.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.criar(user, pacienteId, corpo)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(exigirConcedido).toHaveBeenCalledWith(tx, user, pacienteId);
    expect(tx.documento.create).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('DocumentosService.listar', () => {
  it('where com paciente, clinica e psicologo do token; select so metadados; take 200; audita LISTOU com o pacienteId', async () => {
    const { tx, service, registrar } = montar();
    await service.criar(user, pacienteId, corpo);
    const lista = await service.listar(user, pacienteId);
    const args = tx.documento.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      pacienteId,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
    });
    expect(args.take).toBe(200);
    expect(args.orderBy).toEqual({ criadoEm: 'desc' });
    expect(args.select).toEqual({
      id: true,
      tipo: true,
      dataSessao: true,
      status: true,
      aprovadoEm: true,
      substituiId: true,
      criadoEm: true,
    });
    expect(lista).toHaveLength(1);
    expect(registrar).toHaveBeenLastCalledWith(
      tx,
      user,
      'LISTOU',
      'Documento',
      pacienteId,
    );
  });

  it('paciente que nao e seu = 404 sem auditar', async () => {
    const { service, registrar } = montar({ pacienteExiste: false });
    await expect(service.listar(user, pacienteId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('DocumentosService.obter', () => {
  it('where com id, paciente, clinica e psicologo; audita LEU; inexistente = 404 sem auditar', async () => {
    const { tx, service, registrar } = montar();
    const { id } = await service.criar(user, pacienteId, corpo);
    registrar.mockClear();
    await expect(service.obter(user, pacienteId, id)).resolves.toMatchObject({
      id,
      conteudo: corpo.conteudo,
    });
    expect(tx.documento.findFirst.mock.calls[0][0].where).toEqual({
      id,
      pacienteId,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
    });
    expect(registrar).toHaveBeenCalledWith(tx, user, 'LEU', 'Documento', id);
    registrar.mockClear();
    await expect(
      service.obter(user, pacienteId, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('falha de decifra = 500 generico e o log nao carrega o texto', async () => {
    const { linhas, service } = montar();
    const a = await service.criar(user, pacienteId, corpo);
    const b = await service.criar(user, pacienteId, {
      ...corpo,
      conteudo: 'segredo do outro',
    });
    // cifrado copiado de outra linha: o AAD (id) nao confere
    linhas[0].conteudoCifrado = linhas[1].conteudoCifrado;
    const erro = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    await expect(service.obter(user, pacienteId, a.id)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    const logado = JSON.stringify(erro.mock.calls);
    expect(logado).not.toContain('segredo');
    expect(logado).not.toContain('ansiedade');
    erro.mockRestore();
    expect(b.id).not.toBe(a.id);
  });
});

describe('DocumentosService.editar', () => {
  it('UPDATE atomico com status RASCUNHO + dono no where; recifra; audita EDITOU; devolve decifrado', async () => {
    const { tx, service, registrar } = montar();
    const { id } = await service.criar(user, pacienteId, corpo);
    const antes = tx.documento.create.mock.calls[0][0].data.conteudoCifrado;
    registrar.mockClear();
    const r = await service.editar(user, pacienteId, id, {
      conteudo: 'texto novo',
    });
    const args = tx.documento.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({
      id,
      pacienteId,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
      status: 'RASCUNHO',
    });
    const novo = (args.data as { conteudoCifrado: string }).conteudoCifrado;
    expect(novo).toMatch(/^v1\.k1\./);
    expect(novo).not.toBe(antes);
    expect(JSON.stringify(args)).not.toContain('texto novo');
    expect(r.conteudo).toBe('texto novo'); // mesmo AAD: decifra igual
    expect(registrar).toHaveBeenCalledWith(tx, user, 'EDITOU', 'Documento', id);
  });

  it('dataSessao null apaga a data; so dataSessao nao recifra', async () => {
    const { tx, service } = montar();
    const { id } = await service.criar(user, pacienteId, corpo);
    await service.editar(user, pacienteId, id, { dataSessao: null });
    expect(tx.documento.updateMany.mock.calls[0][0].data).toEqual({
      conteudoCifrado: undefined,
      dataSessao: null,
    });
  });

  it('corpo vazio = 400 antes de tocar o banco', async () => {
    const { tx, service } = montar();
    await expect(
      service.editar(user, pacienteId, randomUUID(), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.documento.updateMany).not.toHaveBeenCalled();
  });

  it('aprovado = 409 e inexistente = 404, sem auditar', async () => {
    const { linhas, service, registrar } = montar();
    const { id } = await service.criar(user, pacienteId, corpo);
    linhas[0].status = 'APROVADO';
    registrar.mockClear();
    await expect(
      service.editar(user, pacienteId, id, { conteudo: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.editar(user, pacienteId, randomUUID(), { conteudo: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('DocumentosService.aprovar', () => {
  it('UPDATE atomico com status RASCUNHO no where; grava APROVADO + aprovadoEm; audita APROVOU', async () => {
    const { tx, service, registrar } = montar();
    const { id } = await service.criar(user, pacienteId, corpo);
    registrar.mockClear();
    const r = await service.aprovar(user, pacienteId, id);
    const args = tx.documento.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({
      id,
      pacienteId,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
      status: 'RASCUNHO',
    });
    expect(args.data).toEqual({
      status: 'APROVADO',
      aprovadoEm: expect.any(Date) as Date,
    });
    expect(r.status).toBe('APROVADO');
    expect(r.conteudo).toBe(corpo.conteudo);
    expect(registrar).toHaveBeenCalledWith(
      tx,
      user,
      'APROVOU',
      'Documento',
      id,
    );
  });

  it('nao consulta consentimento; ja aprovado = 409; inexistente = 404; sem auditar', async () => {
    const { service, registrar, exigirConcedido } = montar();
    const { id } = await service.criar(user, pacienteId, corpo);
    await service.aprovar(user, pacienteId, id);
    registrar.mockClear();
    exigirConcedido.mockClear();
    await expect(service.aprovar(user, pacienteId, id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      service.aprovar(user, pacienteId, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(registrar).not.toHaveBeenCalled();
    expect(exigirConcedido).not.toHaveBeenCalled();
  });
});

describe('DocumentosService.criar com substituiId', () => {
  it('so de aprovado do mesmo paciente e dono: rascunho = 409, inexistente = 404, nada gravado; aprovado liga', async () => {
    const { tx, service, linhas } = montar();
    const rascunho = await service.criar(user, pacienteId, corpo);
    tx.documento.create.mockClear();
    await expect(
      service.criar(user, pacienteId, { ...corpo, substituiId: rascunho.id }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.criar(user, pacienteId, { ...corpo, substituiId: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.documento.create).not.toHaveBeenCalled();
    linhas[0].status = 'APROVADO';
    const r = await service.criar(user, pacienteId, {
      ...corpo,
      substituiId: rascunho.id,
    });
    expect(r.substituiId).toBe(rascunho.id);
    expect(tx.documento.findFirst.mock.calls.at(-1)?.[0].where).toEqual({
      id: rascunho.id,
      pacienteId,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
    });
  });

  it('a checagem vem depois do consentimento (403 antes)', async () => {
    const { service, exigirConcedido } = montar();
    exigirConcedido.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.criar(user, pacienteId, { ...corpo, substituiId: randomUUID() }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DocumentosService.listar com filtro', () => {
  it('status entra no where so quando informado', async () => {
    const { tx, service } = montar();
    await service.listar(user, pacienteId, 'APROVADO');
    expect(tx.documento.findMany.mock.calls[0][0].where).toEqual({
      pacienteId,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
      status: 'APROVADO',
    });
  });
});
