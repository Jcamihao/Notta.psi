import { randomBytes, randomUUID } from 'node:crypto';
import { Papel, Prisma, PrismaClient } from '@prisma/client';
import {
  CriptografiaService,
  aadDe,
} from '../src/criptografia/criptografia.service';
import {
  Armazem,
  armazemPrisma,
  recifrarColuna,
  recifrarTudo,
  Opcoes,
} from '../src/ferramentas/recifrar';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas } from './acesso-owner';

// Recifragem com DUAS chaves no Postgres real (item 25, parte B). Os dados nascem sob k1; o
// servico sobe com k2 atual; o comando recifra so a clinica do teste (isolado das outras suites).
if (!process.env.DATABASE_URL_OWNER) {
  throw new Error(
    'DATABASE_URL_OWNER ausente: recifragem exige o papel notta_owner (ver backend/README.md)',
  );
}

const K1 = 'e2e0'.repeat(16); // a mesma chave de teste do setup (NOTTA_MASTER_KEY)
const K2 = randomBytes(32).toString('hex'); // gerada na hora, nunca no repo
const envOriginal = {
  NOTTA_MASTER_KEY: process.env.NOTTA_MASTER_KEY,
  NOTTA_MASTER_KEYS: process.env.NOTTA_MASTER_KEYS,
  NOTTA_MASTER_KEY_ATUAL: process.env.NOTTA_MASTER_KEY_ATUAL,
};

function servico(vars: Record<string, string>) {
  for (const k of Object.keys(envOriginal)) delete process.env[k];
  Object.assign(process.env, vars);
  return new CriptografiaService();
}

const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('connection_limit', '1');
const app = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const owner = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_OWNER } },
});
const tenant = new TenantPrismaService(app as unknown as PrismaService);

const sufixo = randomUUID().slice(0, 8);
const C = randomUUID();
const OUTRA = randomUUID();
let cripto1: CriptografiaService;
let cripto2: CriptografiaService;
let psi: { clinicaId: string; psicologoId: string };
let pacienteId: string;
let aprovadoId: string;
let pendenteId: string;
let falhouId: string;
let outraPacienteId: string;
let antesAprovado: { aprovadoEm: Date; atualizadoEm: Date };
const textos = {
  nome: 'Ana Teste',
  doc: 'evolucao de teste',
  texto: 'texto IA teste',
  mapa: '{"c":"x"}',
};

const aad = (tabela: string, coluna: string, id: string) =>
  aadDe(tabela, coluna, id, psi.psicologoId);

async function criarPsicologo(clinicaId: string, nome: string) {
  const p = await tenant.run(clinicaId, (tx) =>
    tx.psicologo.create({
      data: {
        clinicaId,
        nome,
        papel: Papel.PSICOLOGO,
        email: `${nome}-${sufixo}@teste.local`,
        senhaHash: 'x',
        abordagemPadrao: 'TCC',
        senhaProvisoria: true,
      },
    }),
  );
  return { clinicaId, psicologoId: p.id };
}

const comoPsi = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  tenant.runComoUsuario(psi, fn);

// Valor em disco (sem contexto de app): le como notta_owner com a flag, via comando de leitura.
const cru = async (tabela: string, coluna: string, id: string) => {
  const r = await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.recifrar', '1', true)`;
    return tx.$queryRawUnsafe<{ valor: string }[]>(
      `SELECT "${coluna}" AS "valor" FROM "${tabela}" WHERE "id" = '${id}'`,
    );
  });
  return r[0].valor;
};

beforeAll(async () => {
  cripto1 = servico({ NOTTA_MASTER_KEY: K1 });
  for (const [id, nome] of [
    [C, 'C'],
    [OUTRA, 'O'],
  ] as const) {
    await tenant.run(id, (tx) =>
      tx.clinica.create({ data: { id, nome: `R${nome}-${sufixo}` } }),
    );
  }
  psi = await criarPsicologo(C, 'rec-ch-psi');
  const outraPsi = await criarPsicologo(OUTRA, 'rec-ch-outra');

  // Dados sob k1 (escritos com cripto1, como o servico antigo fazia).
  pacienteId = randomUUID();
  outraPacienteId = randomUUID();
  await comoPsi(async (tx) => {
    await tx.paciente.create({
      data: {
        id: pacienteId,
        clinicaId: C,
        psicologoId: psi.psicologoId,
        nomeCifrado: cripto1.cifrar(
          C,
          textos.nome,
          aad('Paciente', 'nomeCifrado', pacienteId),
        ),
        nascimentoCifrado: cripto1.cifrar(
          C,
          textos.nome,
          aad('Paciente', 'nascimentoCifrado', pacienteId),
        ),
      },
    });
  });
  await tenant.runComoUsuario(
    { clinicaId: OUTRA, psicologoId: outraPsi.psicologoId },
    async (tx) => {
      await tx.paciente.create({
        data: {
          id: outraPacienteId,
          clinicaId: OUTRA,
          psicologoId: outraPsi.psicologoId,
          nomeCifrado: cripto1.cifrar(
            OUTRA,
            'outra clinica',
            aadDe(
              'Paciente',
              'nomeCifrado',
              outraPacienteId,
              outraPsi.psicologoId,
            ),
          ),
        },
      });
    },
  );

  // Documento aprovado + rascunho.
  aprovadoId = randomUUID();
  const rascunhoId = randomUUID();
  for (const id of [aprovadoId, rascunhoId]) {
    await comoPsi(async (tx) => {
      await tx.documento.create({
        data: {
          id,
          clinicaId: C,
          psicologoId: psi.psicologoId,
          pacienteId,
          tipo: 'NOTA_BRUTA',
          conteudoCifrado: cripto1.cifrar(
            C,
            textos.doc,
            aad('Documento', 'conteudoCifrado', id),
          ),
        },
      });
    });
  }
  await comoPsi((tx) =>
    tx.$executeRawUnsafe(
      `UPDATE "Documento" SET "status" = 'APROVADO', "aprovadoEm" = now() WHERE "id" = '${aprovadoId}'`,
    ),
  );
  antesAprovado = (
    await comoPsi((tx) =>
      tx.$queryRawUnsafe<{ aprovadoEm: Date; atualizadoEm: Date }[]>(
        `SELECT "aprovadoEm", "atualizadoEm" FROM "Documento" WHERE "id" = '${aprovadoId}'`,
      ),
    )
  )[0];

  // GeracaoIa: uma FALHOU (retentavel) e uma PENDENTE. Textos e mapa sob k1.
  const gerar = async (estado: 'PENDENTE' | 'FALHOU') => {
    const id = randomUUID();
    await comoPsi(async (tx) => {
      await tx.geracaoIa.create({
        data: {
          id,
          clinicaId: C,
          psicologoId: psi.psicologoId,
          pacienteId,
          origemId: rascunhoId,
          tipoDocumento: 'EVOLUCAO',
          abordagem: 'TCC',
          estado: 'PREVIA',
          textoCifrado: cripto1.cifrar(
            C,
            textos.texto,
            aad('GeracaoIa', 'textoCifrado', id),
          ),
          mapaCifrado: cripto1.cifrar(
            C,
            textos.mapa,
            aad('GeracaoIa', 'mapaCifrado', id),
          ),
          expiraEm: new Date(Date.now() + 30 * 60_000),
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE "GeracaoIa" SET "estado" = 'PENDENTE' WHERE "id" = '${id}'`,
      );
    });
    if (estado === 'FALHOU') {
      await comoPsi((tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "GeracaoIa" SET "estado" = 'FALHOU', "motivo" = 'REDE', "retentavel" = true, "finalizadoEm" = now() WHERE "id" = '${id}'`,
        ),
      );
    }
    return id;
  };
  falhouId = await gerar('FALHOU');
  pendenteId = await gerar('PENDENTE');

  // Servico com k2 atual (k1 continua legivel).
  cripto2 = servico({
    NOTTA_MASTER_KEYS: `k1:${K1},k2:${K2}`,
    NOTTA_MASTER_KEY_ATUAL: 'k2',
  });
});

afterAll(async () => {
  for (const k of Object.keys(envOriginal) as (keyof typeof envOriginal)[]) {
    if (envOriginal[k] === undefined) delete process.env[k];
    else process.env[k] = envOriginal[k];
  }
  await apagarClinicas([C, OUTRA]);
  await app.$disconnect();
  await owner.$disconnect();
});

const op = (extra: Partial<Opcoes> = {}): Opcoes => ({
  clinicaId: C,
  lote: 2,
  dryRun: false,
  ...extra,
});
const total = (r: { c: { recifradas: number } }[]) =>
  r.reduce((s, x) => s + x.c.recifradas, 0);
const falhas = (r: { c: { falhas: number } }[]) =>
  r.reduce((s, x) => s + x.c.falhas, 0);
const armazem = (): Armazem => armazemPrisma(owner);

describe('recifragem com duas chaves', () => {
  it('k2 atual le os valores de k1 (a API continua funcionando durante a troca)', () => {
    const v = cripto1.cifrar(
      C,
      'x',
      aad('Paciente', 'nomeCifrado', pacienteId),
    );
    expect(
      cripto2.decifrar(C, v, aad('Paciente', 'nomeCifrado', pacienteId)),
    ).toBe('x');
    expect(cripto2.kidAtual()).toBe('k2');
  });

  it('dry-run conta 8 valores (1 paciente x2 campos, 2 documentos, 2 geracoes x2 campos) e nao grava', async () => {
    const r = await recifrarTudo(armazem(), cripto2, op({ dryRun: true }));
    expect(total(r)).toBe(8);
    expect(falhas(r)).toBe(0);
    expect(await cru('Paciente', 'nomeCifrado', pacienteId)).toMatch(
      /^v1\.k1\./,
    );
    expect(await cru('Documento', 'conteudoCifrado', aprovadoId)).toMatch(
      /^v1\.k1\./,
    );
  });

  it('valor que nao decifra nao e gravado (verificacao de ida e volta)', async () => {
    const errado = {
      kidAtual: () => cripto2.kidAtual(),
      decifrar: (c: string, v: string, a: string) => cripto2.decifrar(c, v, a),
      recifrarValor: (c: string, _v: string, a: string) =>
        cripto2.cifrar(c, 'OUTRO', a),
    };
    const r = await recifrarTudo(armazem(), errado, op());
    expect(total(r)).toBe(0);
    expect(falhas(r)).toBe(8);
    expect(await cru('Documento', 'conteudoCifrado', aprovadoId)).toMatch(
      /^v1\.k1\./,
    );
  });

  it('conflito otimista: se o valor mudou no meio, pula e nao sobrescreve', async () => {
    const concorrente = cripto1.cifrar(
      C,
      'mudou',
      aad('Paciente', 'nomeCifrado', pacienteId),
    );
    const armazemComCorrida: Armazem = {
      transacao: (fn) =>
        armazem().transacao((acesso) =>
          fn({
            ...acesso,
            atualizar: async (alvo, id, novo, antigo) => {
              if (alvo.coluna === 'nomeCifrado' && id === pacienteId) {
                // Outra sessao grava antes deste UPDATE (commit separado).
                await owner.$transaction(async (tx) => {
                  await tx.$executeRaw`SELECT set_config('app.recifrar', '1', true)`;
                  await tx.$executeRawUnsafe(
                    `UPDATE "Paciente" SET "nomeCifrado" = '${concorrente}' WHERE "id" = '${pacienteId}'`,
                  );
                });
              }
              return acesso.atualizar(alvo, id, novo, antigo);
            },
          }),
        ),
    };
    // So a coluna do teste: um run real de tudo regravaria as outras em k2.
    const nome = await recifrarColuna(
      armazemComCorrida,
      cripto2,
      { tabela: 'Paciente', coluna: 'nomeCifrado' },
      op(),
    );
    expect(nome.conflitos).toBe(1);
    expect(await cru('Paciente', 'nomeCifrado', pacienteId)).toBe(concorrente);
    // Volta ao valor de k1 para as proximas execucoes do teste.
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.recifrar', '1', true)`;
      await tx.$executeRawUnsafe(
        `UPDATE "Paciente" SET "nomeCifrado" = '${cripto1.cifrar(C, textos.nome, aad('Paciente', 'nomeCifrado', pacienteId))}' WHERE "id" = '${pacienteId}'`,
      );
    });
  });

  it('recifra tudo da clinica para k2; mesmo texto, status e datas do aprovado intactos', async () => {
    const r = await recifrarTudo(armazem(), cripto2, op());
    expect(falhas(r)).toBe(0);
    expect(r.find((x) => x.alvo.coluna === 'nomeCifrado')!.c.recifradas).toBe(
      1,
    );
    expect(total(r)).toBe(8);

    for (const [tabela, coluna, id] of [
      ['Paciente', 'nomeCifrado', pacienteId],
      ['Paciente', 'nascimentoCifrado', pacienteId],
      ['Documento', 'conteudoCifrado', aprovadoId],
      ['GeracaoIa', 'textoCifrado', pendenteId],
      ['GeracaoIa', 'mapaCifrado', pendenteId],
      ['GeracaoIa', 'textoCifrado', falhouId],
      ['GeracaoIa', 'mapaCifrado', falhouId],
    ] as const) {
      const valor = await cru(tabela, coluna, id);
      expect(valor.startsWith('v1.k2.')).toBe(true);
      expect(cripto2.decifrar(C, valor, aad(tabela, coluna, id))).toBe(
        coluna === 'nomeCifrado' || coluna === 'nascimentoCifrado'
          ? textos.nome
          : coluna === 'conteudoCifrado'
            ? textos.doc
            : coluna === 'textoCifrado'
              ? textos.texto
              : textos.mapa,
      );
    }
    // Outra clinica nao foi tocada.
    expect(
      (await cru('Paciente', 'nomeCifrado', outraPacienteId)).startsWith(
        'v1.k1.',
      ),
    ).toBe(true);

    const depois = (
      await comoPsi((tx) =>
        tx.$queryRawUnsafe<
          { status: string; aprovadoEm: Date; atualizadoEm: Date }[]
        >(
          `SELECT "status", "aprovadoEm", "atualizadoEm" FROM "Documento" WHERE "id" = '${aprovadoId}'`,
        ),
      )
    )[0];
    expect(depois.status).toBe('APROVADO');
    expect(depois.aprovadoEm).toEqual(antesAprovado.aprovadoEm);
    expect(depois.atualizadoEm).toEqual(antesAprovado.atualizadoEm);
  });

  it('segunda execucao muda 0 e nao falha', async () => {
    const r = await recifrarTudo(armazem(), cripto2, op());
    expect(total(r)).toBe(0);
    expect(falhas(r)).toBe(0);
    expect(r.every((x) => x.c.lidas === 0)).toBe(true);
  });

  it('notta_app com a flag nao consegue nada (sem contexto: zero linhas)', async () => {
    const n = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.recifrar', '1', true)`;
      return tx.$executeRawUnsafe(
        `UPDATE "Documento" SET "conteudoCifrado" = 'hack' WHERE "id" = '${aprovadoId}'`,
      );
    });
    expect(n).toBe(0);
    expect(await cru('Documento', 'conteudoCifrado', aprovadoId)).toMatch(
      /^v1\.k2\./,
    );
  });
});
