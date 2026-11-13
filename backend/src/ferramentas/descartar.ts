// Descarte automatico de rascunho vencido (item 52A). Uso:
//   npm run descartar -- [--dry-run] [--clinica <id>] [--lote N]   (N: 1 a 5000, padrao 500)
// Apaga Documento RASCUNHO sem edicao ha mais de PRAXIS_RETENCAO_RASCUNHO_DIAS dias (padrao 7), com
// as GeracaoIa ligadas. APROVADO nunca. Quem faz as regras e a funcao `descartar_rascunhos_vencidos`
// (migration 20261111120000_descartar_rascunhos): este arquivo so escolhe clinicas, lotes e mostra
// os numeros.
//
// EXCECAO a regra "set_config so no TenantPrismaService", igual a recifrar.ts: e ferramenta de linha
// de comando do DONO (praxis_owner), que precisa percorrer todas as clinicas. set_config fica dentro
// de cada transacao, LOCAL. A CLI recusa rodar como praxis_app.
//
// Saida: so numeros, ids de clinica e o prazo. Jamais texto, nome, conteudo ou chave.
import { PrismaClient } from '@prisma/client';
import { relogio } from '../comum/relogio';
import { corteDescarte, retencaoRascunhoDias } from '../comum/retencao';

export type Opcoes = { clinicaId?: string; lote: number; dryRun: boolean };
export type Totais = {
  selecionados: number;
  documentos: number;
  geracoes: number;
};
export type Resultado = {
  dias: number;
  corte: Date;
  dryRun: boolean;
  porClinica: ({ clinicaId: string } & Totais)[];
  total: { clinicas: number } & Totais;
};

// Acesso ao banco: cada `lote` e UMA transacao com o contexto da clinica (set_config LOCAL).
export interface Armazem {
  clinicas(): Promise<string[]>;
  lote(
    clinicaId: string,
    corte: Date,
    lote: number,
    simular: boolean,
  ): Promise<Totais>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOTE_PADRAO = 500;
const LOTE_MAXIMO = 5000;

// Opcoes da linha de comando. Erro = mensagem para o dono, sem valor digitado.
export function lerOpcoes(argv: string[]): Opcoes {
  const op: Opcoes = { lote: LOTE_PADRAO, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      op.dryRun = true;
    } else if (a === '--clinica') {
      const v = argv[++i];
      if (!v || !UUID.test(v)) {
        throw new Error('--clinica: informe o id (uuid) da clinica');
      }
      op.clinicaId = v;
    } else if (a === '--lote') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1 || v > LOTE_MAXIMO) {
        throw new Error(`--lote: informe um inteiro de 1 a ${LOTE_MAXIMO}`);
      }
      op.lote = v;
    } else {
      throw new Error(`opcao desconhecida: ${a}`);
    }
  }
  return op;
}

export function verificarPapel(usuario: string): void {
  if (usuario !== 'praxis_owner') {
    throw new Error(
      'recusado: o descarte precisa do papel praxis_owner (ver docs/ACESSO.md)',
    );
  }
}

// Percorre clinicas (ou so a dada) em lotes. Para quando o lote vem parcial, quando nao ha
// progresso (lote cheio sem apagar nada) ou, no dry-run, depois de uma contagem.
export async function descartarVencidos(
  armazem: Armazem,
  op: Opcoes,
  rel: { agora: Date; dias: number },
): Promise<Resultado> {
  const corte = corteDescarte(rel.agora, rel.dias);
  const clinicas = op.clinicaId ? [op.clinicaId] : await armazem.clinicas();
  const porClinica: Resultado['porClinica'] = [];
  const total: Resultado['total'] = {
    clinicas: clinicas.length,
    selecionados: 0,
    documentos: 0,
    geracoes: 0,
  };
  for (const clinicaId of clinicas) {
    const t: Totais = { selecionados: 0, documentos: 0, geracoes: 0 };
    for (;;) {
      const r = await armazem.lote(clinicaId, corte, op.lote, op.dryRun);
      t.selecionados += r.selecionados;
      t.documentos += r.documentos;
      t.geracoes += r.geracoes;
      if (op.dryRun || r.selecionados < op.lote || r.documentos === 0) break;
    }
    porClinica.push({ clinicaId, ...t });
    total.selecionados += t.selecionados;
    total.documentos += t.documentos;
    total.geracoes += t.geracoes;
  }
  return {
    dias: rel.dias,
    corte,
    dryRun: op.dryRun,
    porClinica,
    total,
  };
}

export function formatar(res: Resultado): string[] {
  const linhas = [`prazo=${res.dias} dias corte=${res.corte.toISOString()}`];
  for (const c of res.porClinica) {
    linhas.push(
      `clinica ${c.clinicaId}: selecionados=${c.selecionados} documentos=${c.documentos} geracoes=${c.geracoes}`,
    );
  }
  const t = res.total;
  linhas.push(
    `total: clinicas=${t.clinicas} selecionados=${t.selecionados} documentos=${t.documentos} geracoes=${t.geracoes}`,
  );
  linhas.push(
    res.dryRun
      ? 'dry-run: nada foi gravado'
      : 'gravado: rascunhos vencidos apagados, com as geracoes ligadas e a auditoria DESCARTOU na mesma transacao',
  );
  return linhas;
}

// Implementacao real com Prisma (papel praxis_owner). Cada lote = 1 transacao.
export function armazemPrisma(owner: PrismaClient): Armazem {
  return {
    clinicas: () =>
      owner.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT c AS "id" FROM clinicas_para_descarte() AS c`;
        return rows.map((r) => r.id);
      }),
    lote: (clinicaId, corte, lote, simular) =>
      owner.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_clinica_id', ${clinicaId}, true)`;
          const [r] = await tx.$queryRaw<Totais[]>`
            SELECT selecionados, documentos, geracoes
            FROM descartar_rascunhos_vencidos(
              CAST(${corte.toISOString()} AS timestamptz),
              CAST(${lote} AS integer),
              CAST(${simular} AS boolean))`;
          return {
            selecionados: r.selecionados,
            documentos: r.documentos,
            geracoes: r.geracoes,
          };
        },
        { timeout: 60_000, maxWait: 10_000 },
      ),
  };
}

async function main(): Promise<number> {
  let op: Opcoes;
  let dias: number;
  try {
    op = lerOpcoes(process.argv.slice(2));
    dias = retencaoRascunhoDias();
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error(
      'DATABASE_URL_OWNER ausente: o descarte roda como praxis_owner (ver docs/ACESSO.md)',
    );
    return 2;
  }
  const owner = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ usuario }] = await owner.$queryRaw<{ usuario: string }[]>`
      SELECT current_user AS "usuario"`;
    verificarPapel(usuario);
    const res = await descartarVencidos(armazemPrisma(owner), op, {
      agora: relogio.agora(),
      dias,
    });
    for (const linha of formatar(res)) console.log(linha);
    return 0;
  } catch (e) {
    // Mensagem fixa ou so o nome do erro: a mensagem do Prisma pode trazer pedacos da consulta.
    const msg = (e as Error).message;
    console.error(
      msg.startsWith('recusado:') ? msg : `erro: ${(e as Error).name}`,
    );
    return msg.startsWith('recusado:') ? 2 : 1;
  } finally {
    await owner.$disconnect();
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
