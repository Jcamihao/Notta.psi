import { randomUUID } from 'node:crypto';
import {
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
