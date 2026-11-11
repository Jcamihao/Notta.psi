import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConsentimentoService } from '../consentimento/consentimento.service';
import {
  aadDe,
  CriptografiaService,
} from '../criptografia/criptografia.service';
import { aadGeracao } from '../geracao-ia/geracao-ia.tipos';
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
  const registrar = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());
  const estadosDe = jest.fn<Promise<Map<string, 'CONCEDIDO'>>, unknown[]>(() =>
    Promise.resolve(new Map()),
  );
  const estadoDe = jest.fn<Promise<'NENHUM' | 'CONCEDIDO'>, unknown[]>(() =>
    Promise.resolve('NENHUM'),
  );
  const service = new PacientesService(
    tenant as unknown as TenantPrismaService,
    cripto,
    { registrar },
    { estadosDe, estadoDe } as unknown as ConsentimentoService,
  );
  return {
    tx,
    tenant,
    service,
    cripto,
    linhas,
    registrar,
    estadosDe,
    estadoDe,
  };
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
      excluidoEm: null,
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

describe('PacientesService: consentimento na lista e no detalhe', () => {
  it('lista: UMA consulta de estados para todos os ids; sem registro = NENHUM', async () => {
    const { service, estadosDe } = montar();
    const a = await service.criar(user, { nome: 'Ana' });
    const b = await service.criar(user, { nome: 'Bia' });
    estadosDe.mockResolvedValueOnce(new Map([[a.id, 'CONCEDIDO']]));
    const lista = await service.listar(user);
    expect(estadosDe).toHaveBeenCalledTimes(1);
    expect(estadosDe.mock.calls[0][2]).toEqual([a.id, b.id]);
    expect(lista.map((p) => [p.nome, p.consentimento])).toEqual([
      ['Ana', 'CONCEDIDO'],
      ['Bia', 'NENHUM'],
    ]);
  });

  it('detalhe traz o estado; 404 nao consulta consentimento', async () => {
    const { service, estadoDe } = montar();
    const { id } = await service.criar(user, { nome: 'Ana' });
    estadoDe.mockResolvedValueOnce('CONCEDIDO');
    await expect(service.obter(user, id)).resolves.toMatchObject({
      consentimento: 'CONCEDIDO',
    });
    await expect(service.obter(user, randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(estadoDe).toHaveBeenCalledTimes(1);
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
      excluidoEm: null,
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
      excluidoEm: null,
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

describe('PacientesService: trilha de auditoria', () => {
  it('cada operacao registra a acao certa com a mesma tx; so o id, nunca valor de campo', async () => {
    const { tx, service, registrar } = montar();
    const { id } = await service.criar(user, { nome: 'Ana Secreta' });
    await service.listar(user);
    await service.obter(user, id);
    await service.atualizar(user, id, { nome: 'Outro Nome' });
    expect(registrar.mock.calls).toEqual([
      [tx, user, 'CRIOU', 'Paciente', id],
      [tx, user, 'LISTOU', 'Paciente'],
      [tx, user, 'LEU', 'Paciente', id],
      [tx, user, 'EDITOU', 'Paciente', id],
    ]);
    expect(JSON.stringify(registrar.mock.calls)).not.toContain('Secreta');
  });

  it('404 e 400 nao registram', async () => {
    const { service, registrar } = montar();
    await expect(service.obter(user, randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.atualizar(user, randomUUID(), { nome: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.atualizar(user, randomUUID(), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('falha da auditoria derruba a operacao (a tx desfaz)', async () => {
    const { service, registrar } = montar();
    registrar.mockRejectedValueOnce(new Error('trilha caiu'));
    await expect(service.criar(user, { nome: 'Ana' })).rejects.toThrow(
      'trilha caiu',
    );
  });
});

// Exclusao por anonimizacao (item 26). O tx falso so responde o que excluir() le; a funcao
// anonimizar_paciente e simulada pelo $queryRaw (o e2e prova a funcao de verdade no Postgres).
function montarExcluir(opcoes: {
  pacienteAchado?: boolean;
  docs?: string[];
  geracoes?: string[];
  funcao?: () => Promise<unknown>;
}) {
  process.env.NOTTA_MASTER_KEY = '0123456789abcdef'.repeat(4);
  const cripto = new CriptografiaService();
  const excluidoEm = new Date('2026-11-11T12:00:00Z');
  const chamadaFuncao = jest.fn<Promise<unknown>, unknown[]>(
    opcoes.funcao ?? (() => Promise.resolve([{ excluidoEm }])),
  );
  const tx = {
    paciente: {
      findFirst: jest.fn(() =>
        Promise.resolve(opcoes.pacienteAchado === false ? null : { id: PID }),
      ),
    },
    documento: {
      findMany: jest.fn(() =>
        Promise.resolve((opcoes.docs ?? []).map((id) => ({ id }))),
      ),
    },
    geracaoIa: {
      findMany: jest.fn(() =>
        Promise.resolve((opcoes.geracoes ?? []).map((id) => ({ id }))),
      ),
    },
    $queryRaw: jest.fn(
      (_strings: TemplateStringsArray, ...valores: unknown[]) =>
        chamadaFuncao(...valores),
    ),
  };
  const tenant = {
    runComoUsuario: jest.fn(
      (_u: object, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
  const registrar = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());
  const service = new PacientesService(
    tenant as unknown as TenantPrismaService,
    cripto,
    { registrar },
    {} as ConsentimentoService,
  );
  return { tx, tenant, service, cripto, registrar, chamadaFuncao, excluidoEm };
}

const PID = randomUUID();
const DOC_A = randomUUID();
const DOC_B = randomUUID();
const GER_A = randomUUID();

describe('PacientesService.excluir', () => {
  it('filtra paciente pelo token e so os vivos (excluidoEm null); 1 transacao', async () => {
    const { tx, tenant, service } = montarExcluir({
      docs: [DOC_A],
      geracoes: [GER_A],
    });
    await service.excluir(user, PID);
    expect(tenant.runComoUsuario).toHaveBeenCalledTimes(1);
    expect(tenant.runComoUsuario).toHaveBeenCalledWith(
      user,
      expect.any(Function),
    );
    expect(tx.paciente.findFirst.mock.calls[0][0].where).toEqual({
      id: PID,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
      excluidoEm: null,
    });
    expect(tx.documento.findMany.mock.calls[0][0].where).toEqual({
      pacienteId: PID,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
    });
    expect(tx.geracaoIa.findMany.mock.calls[0][0].where).toEqual({
      pacienteId: PID,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
      estado: { not: 'PRONTO' },
    });
  });

  it('tombstones decifram com o AAD certo de cada coluna (nome, documento, geracao texto e mapa)', async () => {
    const { chamadaFuncao, service, cripto } = montarExcluir({
      docs: [DOC_A, DOC_B],
      geracoes: [GER_A],
    });
    await service.excluir(user, PID);
    const [, nomeT, docsJson, gerJson] = chamadaFuncao.mock.calls[0] as [
      string,
      string,
      string,
      string,
    ];
    const docs = JSON.parse(docsJson) as Record<string, string>;
    const ger = JSON.parse(gerJson) as Record<
      string,
      { texto: string; mapa: string }
    >;
    expect(Object.keys(docs).sort()).toEqual([DOC_A, DOC_B].sort());
    expect(Object.keys(ger)).toEqual([GER_A]);

    const psic = user.psicologoId;
    expect(
      cripto.decifrar(
        user.clinicaId,
        nomeT,
        aadDe('Paciente', 'nomeCifrado', PID, psic),
      ),
    ).toBe('Paciente excluido');
    for (const id of [DOC_A, DOC_B]) {
      expect(
        cripto.decifrar(
          user.clinicaId,
          docs[id],
          aadDe('Documento', 'conteudoCifrado', id, psic),
        ),
      ).toBe('Conteudo excluido a pedido (LGPD)');
    }
    expect(
      cripto.decifrar(
        user.clinicaId,
        ger[GER_A].texto,
        aadGeracao('textoCifrado', GER_A, psic),
      ),
    ).toBe('Conteudo excluido a pedido (LGPD)');
    expect(
      cripto.decifrar(
        user.clinicaId,
        ger[GER_A].mapa,
        aadGeracao('mapaCifrado', GER_A, psic),
      ),
    ).toBe('{}');
    // Tombstone nao decifra com AAD de outra linha (cada um e vinculado a sua linha).
    expect(() =>
      cripto.decifrar(
        user.clinicaId,
        docs[DOC_A],
        aadDe('Documento', 'conteudoCifrado', DOC_B, psic),
      ),
    ).toThrow();
  });

  it('nunca grava texto clinico original: os cifrados enviados nao sao o texto', async () => {
    const { chamadaFuncao, service } = montarExcluir({
      docs: [DOC_A],
      geracoes: [GER_A],
    });
    await service.excluir(user, PID);
    const todos = JSON.stringify(chamadaFuncao.mock.calls[0]);
    expect(todos).not.toMatch(
      /Conteudo excluido a pedido \(LGPD\)|Paciente excluido/,
    );
  });

  it('devolve { excluidoEm } em ISO e audita EXCLUIU na mesma transacao, so quando exclui', async () => {
    const { tx, service, registrar, excluidoEm } = montarExcluir({
      docs: [],
      geracoes: [],
    });
    const r = await service.excluir(user, PID);
    expect(r).toEqual({ excluidoEm: excluidoEm.toISOString() });
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith(
      tx,
      user,
      'EXCLUIU',
      'Paciente',
      PID,
    );
  });

  it('paciente inexistente, alheio ou ja excluido: 404 identico, sem funcao e sem auditoria', async () => {
    const { chamadaFuncao, service, registrar } = montarExcluir({
      pacienteAchado: false,
    });
    const erro = await service.excluir(user, PID).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(NotFoundException);
    expect((erro as NotFoundException).message).toBe('Paciente nao encontrado');
    expect(chamadaFuncao).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('no_data_found da funcao (corrida) vira o mesmo 404', async () => {
    const { service, registrar } = montarExcluir({
      docs: [],
      geracoes: [],
      funcao: () =>
        Promise.reject(erroBruto('P0002', 'Paciente nao encontrado')),
    });
    await expect(service.excluir(user, PID)).rejects.toThrow(
      new NotFoundException('Paciente nao encontrado'),
    );
    expect(registrar).not.toHaveBeenCalled();
  });

  it('tombstone faltando (documento criado no meio) = 409 e nada gravado', async () => {
    const { service, registrar } = montarExcluir({
      docs: [DOC_A],
      geracoes: [],
      funcao: () =>
        Promise.reject(erroBruto('22023', 'Tombstone de documento ausente')),
    });
    await expect(service.excluir(user, PID)).rejects.toThrow(ConflictException);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('erro de banco qualquer sobe como esta (falha fechada, sem auditoria)', async () => {
    const { service, registrar } = montarExcluir({
      docs: [],
      geracoes: [],
      funcao: () => Promise.reject(new Error('banco caiu')),
    });
    await expect(service.excluir(user, PID)).rejects.toThrow('banco caiu');
    expect(registrar).not.toHaveBeenCalled();
  });
});

function erroBruto(codigo: string, mensagem: string) {
  return new Prisma.PrismaClientKnownRequestError(mensagem, {
    code: 'P2010',
    clientVersion: '6.19.3',
    meta: { code: codigo, message: mensagem },
  });
}
