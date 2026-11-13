import { randomUUID } from 'node:crypto';
import type { DocumentosService } from '../documentos/documentos.service';
import { CriptografiaService } from '../criptografia/criptografia.service';
import type { ItemMapa } from '../ia/anonimizador';
import {
  IaIndisponivelError,
  IaRecusadaError,
  type SelahIaClient,
} from '../ia/selahia.client';
import type { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { GeracaoIaExecutor } from './geracao-ia.executor';
import { aadGeracao } from './geracao-ia.tipos';

// Banco FALSO sem RLS. Prova: a chamada de rede fica FORA da transacao, o UPDATE condicional
// PENDENTE -> PRONTO decide quem cria o documento, e o texto da IA e saneado.
const user = { clinicaId: randomUUID(), psicologoId: randomUUID() };
const pacienteId = randomUUID();
const NOME = 'Maria da Silva';
const MAPA: ItemMapa[] = [{ codigo: '[PACIENTE]', original: NOME }];

function montar(
  opcoes: {
    estadoAtual?: string;
    achada?: boolean;
    cliente?: () => Promise<{ rascunho: string }>;
  } = {},
) {
  process.env.PRAXIS_MASTER_KEY = '0123456789abcdef'.repeat(4);
  const cripto = new CriptografiaService();
  const id = randomUUID();
  const linha = {
    id,
    ...user,
    pacienteId,
    tipoDocumento: 'ANAMNESE',
    abordagem: 'ACT',
    estado: 'PENDENTE',
    textoCifrado: cripto.cifrar(
      user.clinicaId,
      '[PACIENTE] relatou algo',
      aadGeracao('textoCifrado', id, user.psicologoId),
    ),
    mapaCifrado: cripto.cifrar(
      user.clinicaId,
      JSON.stringify(MAPA),
      aadGeracao('mapaCifrado', id, user.psicologoId),
    ),
  };
  let dentro = false;
  let dentroNaChamada: boolean | null = null;
  const estado = { atual: opcoes.estadoAtual ?? 'PENDENTE' };
  const updates: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }[] = [];
  const tx = {
    geracaoIa: {
      findFirst: jest.fn(() =>
        Promise.resolve(opcoes.achada === false ? null : linha),
      ),
      updateMany: jest.fn(
        (a: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          updates.push(a);
          const casa =
            a.where.estado === undefined || a.where.estado === estado.atual;
          return Promise.resolve({ count: casa ? 1 : 0 });
        },
      ),
    },
  };
  const tenant = {
    runComoUsuario: async (
      _u: unknown,
      fn: (t: typeof tx) => Promise<unknown>,
    ) => {
      dentro = true;
      try {
        return await fn(tx);
      } finally {
        dentro = false;
      }
    },
  } as unknown as TenantPrismaService;
  const gerarRascunho = jest.fn(async () => {
    dentroNaChamada = dentro;
    return opcoes.cliente
      ? opcoes.cliente()
      : { rascunho: 'Evolucao de [PACIENTE].', model: 'm', provider: 'p' };
  });
  const documentos = {
    criarGeradoPorIa: jest.fn(() => Promise.resolve()),
  };
  const executor = new GeracaoIaExecutor(
    tenant,
    cripto,
    documentos as unknown as DocumentosService,
    { gerarRascunho } as unknown as SelahIaClient,
  );
  return {
    id,
    tx,
    executor,
    estado,
    updates,
    documentos,
    gerarRascunho,
    dentroNaChamada: () => dentroNaChamada,
  };
}

describe('GeracaoIaExecutor', () => {
  it('chama o SelahIA FORA de qualquer transacao, com o texto e a abordagem do pedido', async () => {
    const m = montar();
    await m.executor.executar(m.id, user);
    expect(m.gerarRascunho).toHaveBeenCalledWith({
      tipoDocumento: 'anamnese',
      abordagem: 'ACT',
      textoAnonimizado: '[PACIENTE] relatou algo',
    });
    expect(m.dentroNaChamada()).toBe(false);
  });

  it('sucesso: UPDATE condicional PENDENTE->PRONTO zerando cifrados, depois o documento com o nome de volta', async () => {
    const m = montar();
    await m.executor.executar(m.id, user);
    const up = m.updates.at(-1)!;
    expect(up.where).toMatchObject({
      id: m.id,
      clinicaId: user.clinicaId,
      psicologoId: user.psicologoId,
      estado: 'PENDENTE',
    });
    expect(up.data).toMatchObject({
      estado: 'PRONTO',
      textoCifrado: null,
      mapaCifrado: null,
      avisos: [],
    });
    expect(up.data.documentoId).toEqual(expect.any(String));
    expect(m.documentos.criarGeradoPorIa).toHaveBeenCalledWith(
      expect.anything(),
      user,
      {
        id: up.data.documentoId,
        pacienteId,
        tipo: 'ANAMNESE',
        conteudo: `Evolucao de ${NOME}.`,
      },
    );
  });

  it('quem perde a corrida (pedido ja nao e PENDENTE) NAO cria documento', async () => {
    const m = montar({ estadoAtual: 'FALHOU' });
    await m.executor.executar(m.id, user);
    expect(m.updates).toHaveLength(1);
    expect(m.updates[0].data.estado).toBe('PRONTO');
    expect(m.documentos.criarGeradoPorIa).not.toHaveBeenCalled();
  });

  it('saida da IA e saneada: controle e invisiveis saem, avisos vao junto, texto vira texto', async () => {
    const m = montar({
      cliente: () =>
        Promise.resolve({
          rascunho:
            '<b>oi</b>\u0000‮ [PACIENTE]\r\n\r\n\r\n\r\nfala de [FOO] e 111.444.777-35',
        }),
    });
    await m.executor.executar(m.id, user);
    const dados = (
      m.documentos.criarGeradoPorIa.mock.calls[0] as unknown[]
    )[2] as {
      conteudo: string;
    };
    expect(dados.conteudo).toBe(
      `<b>oi</b> ${NOME}\n\nfala de [FOO] e 111.444.777-35`,
    );
    expect(m.updates.at(-1)!.data.avisos).toEqual([
      'DADO_NOVO',
      'CODIGO_DESCONHECIDO',
    ]);
  });

  it('erro do cliente vira FALHOU condicional (PENDENTE->FALHOU) com motivo e retentavel do erro; nada de documento', async () => {
    const casos: [Error, string, boolean][] = [
      [new IaIndisponivelError('TIMEOUT'), 'TIMEOUT', true],
      [new IaIndisponivelError('LIMITE', 429), 'LIMITE', true],
      [new IaRecusadaError('CHAVE_INVALIDA', 401), 'CHAVE_INVALIDA', false],
      [new Error('texto clinico no erro: Maria'), 'ERRO_INTERNO', true],
    ];
    for (const [erro, motivo, retentavel] of casos) {
      const m = montar({ cliente: () => Promise.reject(erro) });
      await m.executor.executar(m.id, user);
      expect(m.updates).toHaveLength(1);
      expect(m.updates[0].where).toMatchObject({ estado: 'PENDENTE' });
      expect(m.updates[0].data).toMatchObject({
        estado: 'FALHOU',
        motivo,
        retentavel,
      });
      expect(JSON.stringify(m.updates[0].data)).not.toContain('Maria');
      expect(m.documentos.criarGeradoPorIa).not.toHaveBeenCalled();
    }
  });

  it('saida vazia ou grande demais = FALHOU SAIDA_INVALIDA retentavel', async () => {
    for (const rascunho of ['\u0000​  ', 'x'.repeat(20001)]) {
      const m = montar({ cliente: () => Promise.resolve({ rascunho }) });
      await m.executor.executar(m.id, user);
      expect(m.updates[0].data).toMatchObject({
        estado: 'FALHOU',
        motivo: 'SAIDA_INVALIDA',
        retentavel: true,
      });
    }
  });

  it('so le pedido PENDENTE do usuario e de paciente vivo (excluido nao vai a IA)', async () => {
    const m = montar();
    await m.executor.executar(m.id, user);
    expect(m.tx.geracaoIa.findFirst.mock.calls[0]).toEqual([
      {
        where: {
          id: m.id,
          clinicaId: user.clinicaId,
          psicologoId: user.psicologoId,
          estado: 'PENDENTE',
          origem: { paciente: { excluidoEm: null } },
        },
      },
    ]);
  });

  it('pedido que nao esta PENDENTE (ou nao e do usuario): nao chama a IA', async () => {
    const m = montar({ achada: false });
    await m.executor.executar(m.id, user);
    expect(m.gerarRascunho).not.toHaveBeenCalled();
    expect(m.updates).toHaveLength(0);
  });

  it('nunca rejeita: erro inesperado vira FALHOU ERRO_INTERNO e nao vaza texto', async () => {
    const m = montar();
    m.documentos.criarGeradoPorIa.mockRejectedValueOnce(
      new Error('Maria caiu'),
    );
    await expect(m.executor.executar(m.id, user)).resolves.toBeUndefined();
    expect(m.updates.at(-1)!.data).toMatchObject({
      estado: 'FALHOU',
      motivo: 'ERRO_INTERNO',
      retentavel: true,
    });
  });
});
