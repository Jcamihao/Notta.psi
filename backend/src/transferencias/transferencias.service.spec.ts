import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  aadDe,
  CriptografiaService,
} from '../criptografia/criptografia.service';
import { aadGeracao } from '../geracao-ia/geracao-ia.tipos';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TransferenciasService } from './transferencias.service';

// Banco FALSO (sem RLS): o teste prova o recifrar, a montagem do payload, a trilha e a traducao de erro.
// As decisoes de autorizacao sao do banco (e2e). Cifra REAL, com chave de teste propria.
const DESTINO = {
  clinicaId: randomUUID(),
  psicologoId: randomUUID(),
  papel: 'PSICOLOGO' as const,
  senhaProvisoria: false,
};
const ORIGEM = randomUUID();
const PEDIDO = randomUUID();
const PACIENTE = randomUUID();
const DOC = randomUUID();
const GER = randomUUID();
const TEXTO_NOME = 'Nome Secreto Da Paciente';
const TEXTO_NASC = '1990-05-17';
const TEXTO_TEL = '(11) 99999-0000';
const TEXTO_DOC = 'CONTEUDO CLINICO SECRETO';
const TEXTO_TEXTO_GER = 'PREVIA ANONIMIZADA SECRETA';
const TEXTO_MAPA_GER = '[{"codigo":"X","original":"Nome Secreto"}]';

type Chamada = { sql: string; valores: unknown[] };

// Fake do $queryRaw / $executeRaw: responde pelo trecho da funcao chamada e guarda o que foi passado.
function montar(
  opcoes: {
    origem?: object;
    aplicar?: object;
    erroNoExecutar?: Error;
    erroNaOrigem?: Error;
  } = {},
) {
  process.env.PRAXIS_MASTER_KEY = '0123456789abcdef'.repeat(4);
  const cripto = new CriptografiaService();
  const chamadas: Chamada[] = [];
  const dados = opcoes.origem ?? {
    origemId: ORIGEM,
    destinoId: DESTINO.psicologoId,
    pacientes: [
      {
        id: PACIENTE,
        nomeCifrado: cripto.cifrar(
          DESTINO.clinicaId,
          TEXTO_NOME,
          aadDe('Paciente', 'nomeCifrado', PACIENTE, ORIGEM),
        ),
        nascimentoCifrado: cripto.cifrar(
          DESTINO.clinicaId,
          TEXTO_NASC,
          aadDe('Paciente', 'nascimentoCifrado', PACIENTE, ORIGEM),
        ),
        telefoneCifrado: cripto.cifrar(
          DESTINO.clinicaId,
          TEXTO_TEL,
          aadDe('Paciente', 'telefoneCifrado', PACIENTE, ORIGEM),
        ),
        emailCifrado: null,
      },
    ],
    documentos: [
      {
        id: DOC,
        pacienteId: PACIENTE,
        conteudoCifrado: cripto.cifrar(
          DESTINO.clinicaId,
          TEXTO_DOC,
          aadDe('Documento', 'conteudoCifrado', DOC, ORIGEM),
        ),
      },
    ],
    geracoes: [
      {
        id: GER,
        pacienteId: PACIENTE,
        textoCifrado: cripto.cifrar(
          DESTINO.clinicaId,
          TEXTO_TEXTO_GER,
          aadGeracao('textoCifrado', GER, ORIGEM),
        ),
        mapaCifrado: cripto.cifrar(
          DESTINO.clinicaId,
          TEXTO_MAPA_GER,
          aadGeracao('mapaCifrado', GER, ORIGEM),
        ),
      },
      {
        id: randomUUID(),
        pacienteId: PACIENTE,
        textoCifrado: null,
        mapaCifrado: null,
      },
    ],
    restantes: 0,
  };
  const sqlDe = (strings: TemplateStringsArray) => strings.join('?');
  const tx = {
    $queryRaw: jest.fn(
      (strings: TemplateStringsArray, ...valores: unknown[]) => {
        const sql = sqlDe(strings);
        chamadas.push({ sql, valores });
        if (sql.includes('transferencia_origem')) {
          return opcoes.erroNaOrigem
            ? Promise.reject(opcoes.erroNaOrigem)
            : Promise.resolve([{ dados }]);
        }
        if (sql.includes('transferencia_aplicar')) {
          return Promise.resolve([
            { resultado: opcoes.aplicar ?? { transferidos: 1, restantes: 0 } },
          ]);
        }
        if (sql.includes('pedidos_transferencia_visiveis')) {
          return Promise.resolve([
            {
              id: PEDIDO,
              origem_id: ORIGEM,
              origem_nome: 'Origem',
              destino_id: DESTINO.psicologoId,
              destino_nome: 'Destino',
              criado_por_id: randomUUID(),
              estado: 'PENDENTE',
              criado_em: new Date(),
              expira_em: new Date(),
              concluido_em: null,
              total: 2,
            },
          ]);
        }
        return Promise.resolve([]);
      },
    ),
    $executeRaw: jest.fn(
      (strings: TemplateStringsArray, ...valores: unknown[]) => {
        chamadas.push({ sql: sqlDe(strings), valores });
        if (opcoes.erroNoExecutar) {
          return Promise.reject(opcoes.erroNoExecutar);
        }
        return Promise.resolve(1);
      },
    ),
    auditoria: { create: jest.fn(() => Promise.resolve({})) },
  };
  const tenant = {
    runComoUsuario: jest.fn(
      (_u: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx),
    ),
  } as unknown as TenantPrismaService;
  const auditoria = new AuditoriaService();
  const registrar = jest.spyOn(auditoria, 'registrar');
  const service = new TransferenciasService(tenant, cripto, auditoria);
  return { service, tx, chamadas, cripto, registrar, dados };
}

// Erro SQL como o Prisma entrega: PrismaClientKnownRequestError com o SQLSTATE em meta.code.
const erroSql = (codigo: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: codigo, message: 'mensagem interna do banco' },
  });

describe('TransferenciasService.executar: recifragem do lote', () => {
  it('decifra com o AAD da ORIGEM e recifra com o AAD do DESTINO, em CADA coluna (o antigo nao decifra mais)', async () => {
    const { service, chamadas, cripto } = montar();
    await service.executar(DESTINO, PEDIDO);
    const aplicar = chamadas.find((c) =>
      c.sql.includes('transferencia_aplicar'),
    )!;
    const payload = JSON.parse(aplicar.valores[1] as string) as {
      pacientes: {
        id: string;
        nomeCifrado: string;
        nascimentoCifrado: string;
        telefoneCifrado: string;
        emailCifrado: null;
      }[];
      documentos: { id: string; conteudoCifrado: string }[];
      geracoes: {
        id: string;
        textoCifrado: string | null;
        mapaCifrado: string | null;
      }[];
    };
    const p = payload.pacientes[0];
    const novo = (valor: string, aad: string) =>
      cripto.decifrar(DESTINO.clinicaId, valor, aad);
    expect(
      novo(
        p.nomeCifrado,
        aadDe('Paciente', 'nomeCifrado', PACIENTE, DESTINO.psicologoId),
      ),
    ).toBe(TEXTO_NOME);
    expect(
      novo(
        p.nascimentoCifrado,
        aadDe('Paciente', 'nascimentoCifrado', PACIENTE, DESTINO.psicologoId),
      ),
    ).toBe(TEXTO_NASC);
    expect(
      novo(
        p.telefoneCifrado,
        aadDe('Paciente', 'telefoneCifrado', PACIENTE, DESTINO.psicologoId),
      ),
    ).toBe(TEXTO_TEL);
    // Com o AAD ANTIGO (origem), o novo cifrado NAO decifra: a troca de dono foi feita.
    for (const [valor, col] of [
      [p.nomeCifrado, 'nomeCifrado'],
      [p.nascimentoCifrado, 'nascimentoCifrado'],
      [p.telefoneCifrado, 'telefoneCifrado'],
    ] as const) {
      expect(() =>
        novo(valor, aadDe('Paciente', col, PACIENTE, ORIGEM)),
      ).toThrow();
    }
    // Outro paciente (AAD de outra linha) tambem nao decifra.
    expect(() =>
      novo(
        p.nomeCifrado,
        aadDe('Paciente', 'nomeCifrado', randomUUID(), DESTINO.psicologoId),
      ),
    ).toThrow();
    expect(p.emailCifrado).toBeNull();

    const d = payload.documentos[0];
    expect(
      novo(
        d.conteudoCifrado,
        aadDe('Documento', 'conteudoCifrado', DOC, DESTINO.psicologoId),
      ),
    ).toBe(TEXTO_DOC);
    expect(() =>
      novo(
        d.conteudoCifrado,
        aadDe('Documento', 'conteudoCifrado', DOC, ORIGEM),
      ),
    ).toThrow();

    const g = payload.geracoes[0];
    expect(
      novo(
        g.textoCifrado!,
        aadGeracao('textoCifrado', GER, DESTINO.psicologoId),
      ),
    ).toBe(TEXTO_TEXTO_GER);
    expect(
      novo(g.mapaCifrado!, aadGeracao('mapaCifrado', GER, DESTINO.psicologoId)),
    ).toBe(TEXTO_MAPA_GER);
    expect(() =>
      novo(g.textoCifrado!, aadGeracao('textoCifrado', GER, ORIGEM)),
    ).toThrow();
    // Geracao sem texto nem mapa: continua nula (nao vira cifrado vazio).
    expect(payload.geracoes[1]).toMatchObject({
      textoCifrado: null,
      mapaCifrado: null,
    });
  });

  it('o payload traz TODOS os pacientes, documentos e geracoes que a funcao devolveu (sem perder nenhum)', async () => {
    const { service, chamadas } = montar();
    await service.executar(DESTINO, PEDIDO);
    const aplicar = chamadas.find((c) =>
      c.sql.includes('transferencia_aplicar'),
    )!;
    const payload = JSON.parse(aplicar.valores[1] as string) as Record<
      string,
      unknown[]
    >;
    expect(payload.pacientes.map((x) => (x as { id: string }).id)).toEqual([
      PACIENTE,
    ]);
    expect(payload.documentos.map((x) => (x as { id: string }).id)).toEqual([
      DOC,
    ]);
    expect(payload.geracoes.map((x) => (x as { id: string }).id)).toHaveLength(
      2,
    );
  });

  it('origem e destino vem do PEDIDO devolvido pelo banco, nunca do usuario (o AAD novo e o do destino do pedido)', async () => {
    // Destino diferente do usuario que executa: o AAD novo tem que ser o do pedido (o que o banco devolveu).
    const outro = randomUUID();
    const base = montar();
    const { service, cripto, chamadas } = montar({
      origem: { ...base.dados, destinoId: outro },
    });
    await service.executar(DESTINO, PEDIDO);
    const aplicar = chamadas.find((c) =>
      c.sql.includes('transferencia_aplicar'),
    )!;
    const payload = JSON.parse(aplicar.valores[1] as string) as {
      pacientes: { nomeCifrado: string }[];
    };
    expect(
      cripto.decifrar(
        DESTINO.clinicaId,
        payload.pacientes[0].nomeCifrado,
        aadDe('Paciente', 'nomeCifrado', PACIENTE, outro),
      ),
    ).toBe(TEXTO_NOME);
  });

  it('falha de decifra = 500 generico, nada e aplicado, nenhuma trilha, nenhum texto no erro', async () => {
    const { service, chamadas, registrar, tx } = montar({
      origem: {
        origemId: ORIGEM,
        destinoId: DESTINO.psicologoId,
        pacientes: [
          {
            id: PACIENTE,
            nomeCifrado: 'v1.k1.lixo.lixo.lixo',
            nascimentoCifrado: null,
            telefoneCifrado: null,
            emailCifrado: null,
          },
        ],
        documentos: [],
        geracoes: [],
        restantes: 0,
      },
    });
    const logar = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const err = await service
      .executar(DESTINO, PEDIDO)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect(JSON.stringify(err)).not.toContain('lixo');
    expect(chamadas.some((c) => c.sql.includes('transferencia_aplicar'))).toBe(
      false,
    );
    expect(tx.auditoria.create).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
    // Log so com o NOME do erro (nada de valor ou de texto clinico).
    for (const [msg] of logar.mock.calls)
      expect(String(msg)).not.toContain('lixo');
    logar.mockRestore();
  });
});

describe('TransferenciasService.executar: trilha, resposta e erros', () => {
  it('grava a trilha na MESMA transacao: TRANSFERIU por paciente, TRANSFERIU_PACIENTES e RECEBEU_PACIENTES (ator = destino)', async () => {
    const { service, tx, registrar } = montar();
    await service.executar(DESTINO, PEDIDO);
    expect(registrar).toHaveBeenCalledWith(
      tx,
      DESTINO,
      'TRANSFERIU',
      'Paciente',
      PACIENTE,
    );
    expect(registrar).toHaveBeenCalledWith(
      tx,
      DESTINO,
      'TRANSFERIU_PACIENTES',
      'Psicologo',
      ORIGEM,
    );
    expect(registrar).toHaveBeenCalledWith(
      tx,
      DESTINO,
      'RECEBEU_PACIENTES',
      'Psicologo',
      DESTINO.psicologoId,
    );
    expect(tx.auditoria.create).toHaveBeenCalledTimes(3);
  });

  it('sem paciente transferido (lote vazio): nenhuma trilha de lote', async () => {
    const { service, tx } = montar({
      origem: {
        origemId: ORIGEM,
        destinoId: DESTINO.psicologoId,
        pacientes: [],
        documentos: [],
        geracoes: [],
        restantes: 0,
      },
      aplicar: { transferidos: 0, restantes: 0 },
    });
    expect(await service.executar(DESTINO, PEDIDO)).toEqual({
      transferidos: 0,
      restantes: 0,
    });
    expect(tx.auditoria.create).not.toHaveBeenCalled();
  });

  it('a resposta traz SO contagens (nada de nome, cifrado ou id de paciente)', async () => {
    const { service } = montar({ aplicar: { transferidos: 1, restantes: 4 } });
    const r = await service.executar(DESTINO, PEDIDO);
    expect(r).toEqual({ transferidos: 1, restantes: 4 });
    const s = JSON.stringify(r);
    for (const proibido of [TEXTO_NOME, PACIENTE, 'v1.k1'])
      expect(s).not.toContain(proibido);
  });

  it('GeracaoIa PENDENTE (P0001 na origem) = 409 com a mensagem fixa, e nada e aplicado', async () => {
    const { service, chamadas, tx } = montar({
      erroNaOrigem: erroSql('P0001'),
    });
    const err = await service
      .executar(DESTINO, PEDIDO)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe(
      'Há uma geração de IA em andamento. Tente de novo em instantes.',
    );
    expect(chamadas.some((c) => c.sql.includes('transferencia_aplicar'))).toBe(
      false,
    );
    expect(tx.auditoria.create).not.toHaveBeenCalled();
  });

  it('pedido nao encontrado na origem (P0002) = 404 identico, sem recifrar nada', async () => {
    const { service, chamadas } = montar({ erroNaOrigem: erroSql('P0002') });
    await expect(service.executar(DESTINO, PEDIDO)).rejects.toThrow(
      NotFoundException,
    );
    expect(chamadas.some((c) => c.sql.includes('transferencia_aplicar'))).toBe(
      false,
    );
  });
});

describe('TransferenciasService: traducao de erros do banco', () => {
  const ERROS: [string, new (...a: never[]) => Error, string][] = [
    ['P0002', NotFoundException, 'Pedido nao encontrado'],
    [
      'P0001',
      ConflictException,
      'Há uma geração de IA em andamento. Tente de novo em instantes.',
    ],
    [
      '23505',
      ConflictException,
      'Ja existe um pedido de transferencia aberto para este psicologo',
    ],
  ];
  for (const [codigo, classe, mensagem] of ERROS) {
    it(`SQLSTATE ${codigo} em aceitar vira ${classe.name} com mensagem fixa`, async () => {
      const { service } = montar({ erroNoExecutar: erroSql(codigo) });
      const err = await service
        .aceitar(DESTINO, PEDIDO)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(classe);
      expect((err as Error).message).toBe(mensagem);
    });
  }

  it('erro desconhecido sobe como esta (vira 500 generico no Nest) e nao traz o detalhe do banco', async () => {
    const { service } = montar({ erroNoExecutar: erroSql('XX000') });
    const err = await service.aceitar(DESTINO, PEDIDO).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(NotFoundException);
    expect(err).not.toBeInstanceOf(ConflictException);
  });
});

describe('TransferenciasService: criar, aceitar, recusar, cancelar, listar, contagens', () => {
  it('criar: id gerado no app vai para a funcao, a trilha usa o mesmo id, e a resposta tem o formato do contrato', async () => {
    const admin = { ...DESTINO, papel: 'ADMIN' as const };
    const { service, chamadas, registrar, tx } = montar();
    const r = await service.criar(admin, {
      origemId: ORIGEM,
      destinoId: DESTINO.psicologoId,
    });
    const criarCall = chamadas.find((c) =>
      c.sql.includes('pedido_transferencia_criar'),
    )!;
    const id = criarCall.valores[0] as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(registrar).toHaveBeenCalledWith(
      tx,
      admin,
      'PEDIU_TRANSFERENCIA',
      'PedidoTransferencia',
      id,
    );
    expect(Object.keys(r).sort()).toEqual([
      'destinoId',
      'estado',
      'expiraEm',
      'id',
      'origemId',
      'total',
    ]);
    expect(r).toMatchObject({
      id: PEDIDO,
      origemId: ORIGEM,
      estado: 'PENDENTE',
      total: 2,
    });
  });

  it('aceitar / recusar / cancelar: funcao certa, trilha certa (ator), estado de resposta', async () => {
    const admin = { ...DESTINO, papel: 'ADMIN' as const };
    const m = montar();
    expect(await m.service.aceitar(DESTINO, PEDIDO)).toEqual({
      estado: 'ACEITO',
    });
    expect(m.registrar).toHaveBeenLastCalledWith(
      m.tx,
      DESTINO,
      'ACEITOU_TRANSFERENCIA',
      'PedidoTransferencia',
      PEDIDO,
    );
    expect(await m.service.recusar(DESTINO, PEDIDO)).toEqual({
      estado: 'RECUSADO',
    });
    expect(m.registrar).toHaveBeenLastCalledWith(
      m.tx,
      DESTINO,
      'RECUSOU_TRANSFERENCIA',
      'PedidoTransferencia',
      PEDIDO,
    );
    expect(await m.service.cancelar(admin, PEDIDO)).toEqual({
      estado: 'CANCELADO',
    });
    expect(m.registrar).toHaveBeenLastCalledWith(
      m.tx,
      admin,
      'CANCELOU_TRANSFERENCIA',
      'PedidoTransferencia',
      PEDIDO,
    );
    const chamados = m.chamadas.map((c) => c.sql);
    expect(
      chamados.some((s) => s.includes('pedido_transferencia_aceitar')),
    ).toBe(true);
    expect(
      chamados.some((s) => s.includes('pedido_transferencia_recusar')),
    ).toBe(true);
    expect(
      chamados.some((s) => s.includes('pedido_transferencia_cancelar')),
    ).toBe(true);
  });

  it('aceitar com P0002 (nao e o destino, vencido, etc.) = 404 com a mensagem do contrato', async () => {
    const { service } = montar({ erroNoExecutar: erroSql('P0002') });
    await expect(service.aceitar(DESTINO, PEDIDO)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('listar: mapeia o que o banco devolve para o formato do contrato', async () => {
    const { service } = montar();
    const lista = await service.listar(DESTINO);
    expect(lista[0]).toMatchObject({
      id: PEDIDO,
      origemNome: 'Origem',
      destinoNome: 'Destino',
      total: 2,
      estado: 'PENDENTE',
    });
  });

  it('contagens: so id e total (nenhum nome)', async () => {
    const { service, tx } = montar();
    tx.$queryRaw.mockImplementationOnce(
      () => Promise.resolve([{ psicologo_id: ORIGEM, total: 3 }]) as never,
    );
    expect(await service.contagens(DESTINO)).toEqual([
      { psicologoId: ORIGEM, total: 3 },
    ]);
  });
});
