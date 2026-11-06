// Recifragem da chave mestra (item 25, parte B). Uso: npm run recifrar -- [--clinica <id>] [--lote 200] [--dry-run]
//
// EXCECAO a regra "set_config so no TenantPrismaService": este arquivo liga app.recifrar com
// set_config(..., true) dentro de cada transacao do DONO do banco (notta_owner), fora do
// TenantPrismaService. Motivo: e uma ferramenta de linha de comando do dono, que precisa ver
// todas as clinicas. A flag so abre as policies TO notta_owner e a excecao dos triggers
// (migration 20261109120000_recifrar_dono). notta_app nao ganha nada e a CLI recusa rodar como ele.
//
// Saida: so contagens por tabela e coluna. Nunca valor, nome, texto, mapa ou chave.
import { Prisma, PrismaClient } from '@prisma/client';
import {
  CriptografiaService,
  aadDe,
  kidDe,
} from '../criptografia/criptografia.service';

// Colunas cifradas hoje. Mudar aqui = mudar a lista de quem e recifrado.
export const ALVOS = [
  { tabela: 'Paciente', coluna: 'nomeCifrado' },
  { tabela: 'Paciente', coluna: 'nascimentoCifrado' },
  { tabela: 'Paciente', coluna: 'telefoneCifrado' },
  { tabela: 'Paciente', coluna: 'emailCifrado' },
  { tabela: 'Documento', coluna: 'conteudoCifrado' },
  { tabela: 'GeracaoIa', coluna: 'textoCifrado' },
  { tabela: 'GeracaoIa', coluna: 'mapaCifrado' },
] as const;

export type Alvo = { tabela: string; coluna: string };
export type Opcoes = { clinicaId?: string; lote: number; dryRun: boolean };
export type Linha = {
  id: string;
  clinicaId: string;
  psicologoId: string;
  valor: string;
};
export type Contagem = {
  lidas: number;
  recifradas: number;
  conflitos: number;
  falhas: number;
};
export type Cripto = Pick<
  CriptografiaService,
  'decifrar' | 'recifrarValor' | 'kidAtual'
>;

// Acesso ao banco dentro de UMA transacao (com a flag ligada).
export interface Acesso {
  buscar(
    alvo: Alvo,
    cursor: string,
    lote: number,
    filtro: { clinicaId?: string; atual: string },
  ): Promise<Linha[]>;
  atualizar(
    alvo: Alvo,
    id: string,
    novo: string,
    antigo: string,
  ): Promise<number>;
}
export interface Armazem {
  transacao<T>(fn: (a: Acesso) => Promise<T>): Promise<T>;
}

// Devolve o valor novo, ou null (falha: nada e gravado para esta linha).
// Confere que o novo esta na chave atual e que decifra exatamente o mesmo texto.
export function prepararNova(
  cripto: Cripto,
  alvo: Alvo,
  l: Linha,
): string | null {
  try {
    const aad = aadDe(alvo.tabela, alvo.coluna, l.id, l.psicologoId);
    const texto = cripto.decifrar(l.clinicaId, l.valor, aad);
    const novo = cripto.recifrarValor(l.clinicaId, l.valor, aad);
    if (kidDe(novo) !== cripto.kidAtual()) return null;
    if (cripto.decifrar(l.clinicaId, novo, aad) !== texto) return null;
    return novo;
  } catch {
    return null;
  }
}

// Pagina por id (keyset). Cada lote roda numa transacao; o UPDATE e otimista (WHERE valor = antigo).
export async function recifrarColuna(
  armazem: Armazem,
  cripto: Cripto,
  alvo: Alvo,
  op: Opcoes,
): Promise<Contagem> {
  const c: Contagem = { lidas: 0, recifradas: 0, conflitos: 0, falhas: 0 };
  const atual = cripto.kidAtual();
  let cursor = '';
  for (;;) {
    const linhas = await armazem.transacao(async (a) => {
      const pagina = await a.buscar(alvo, cursor, op.lote, {
        clinicaId: op.clinicaId,
        atual,
      });
      for (const l of pagina) {
        c.lidas++;
        const novo = prepararNova(cripto, alvo, l);
        if (novo === null) {
          c.falhas++;
          continue;
        }
        if (op.dryRun) {
          c.recifradas++;
          continue;
        }
        const n = await a.atualizar(alvo, l.id, novo, l.valor);
        if (n === 1) c.recifradas++;
        else c.conflitos++;
      }
      return pagina;
    });
    if (linhas.length === 0) break;
    cursor = linhas[linhas.length - 1].id;
    if (linhas.length < op.lote) break;
  }
  return c;
}

export async function recifrarTudo(
  armazem: Armazem,
  cripto: Cripto,
  op: Opcoes,
): Promise<{ alvo: Alvo; c: Contagem }[]> {
  const res: { alvo: Alvo; c: Contagem }[] = [];
  for (const alvo of ALVOS) {
    res.push({ alvo, c: await recifrarColuna(armazem, cripto, alvo, op) });
  }
  return res;
}

// Opcoes da linha de comando. Erro = mensagem para o dono, sem valor de chave nem de dado.
export function lerOpcoes(argv: string[]): Opcoes {
  const op: Opcoes = { lote: 200, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      op.dryRun = true;
    } else if (a === '--clinica') {
      const v = argv[++i];
      if (!v || v.startsWith('--') || !/^[A-Za-z0-9-]{1,64}$/.test(v)) {
        throw new Error('--clinica: informe o id da clinica');
      }
      op.clinicaId = v;
    } else if (a === '--lote') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1 || v > 5000) {
        throw new Error('--lote: informe um inteiro de 1 a 5000');
      }
      op.lote = v;
    } else {
      throw new Error(`opcao desconhecida: ${a}`);
    }
  }
  return op;
}

// Implementacao real com Prisma (papel notta_owner). Lote = 1 transacao com a flag ligada.
export function armazemPrisma(owner: PrismaClient): Armazem {
  return {
    transacao: (fn) =>
      owner.$transaction(
        async (tx: Prisma.TransactionClient) => {
          await tx.$executeRaw`SELECT set_config('app.recifrar', '1', true)`;
          return fn({
            buscar: async (alvo, cursor, lote, filtro) => {
              if (!Number.isInteger(lote) || lote < 1) {
                throw new Error('lote invalido');
              }
              const clinica = filtro.clinicaId ? ' AND "clinicaId" = $3' : '';
              const params: string[] = [cursor, `v1.${filtro.atual}.%`];
              if (filtro.clinicaId) params.push(filtro.clinicaId);
              // Alvo e constante do ALVOS; lote e inteiro validado.
              const sql =
                `SELECT "id", "clinicaId", "psicologoId", "${alvo.coluna}" AS "valor" ` +
                `FROM "${alvo.tabela}" WHERE "id" > $1 AND "${alvo.coluna}" IS NOT NULL ` +
                `AND "${alvo.coluna}" NOT LIKE $2${clinica} ORDER BY "id" LIMIT ${lote}`;
              return tx.$queryRawUnsafe<Linha[]>(sql, ...params);
            },
            atualizar: (alvo, id, novo, antigo) =>
              tx.$executeRawUnsafe(
                `UPDATE "${alvo.tabela}" SET "${alvo.coluna}" = $1 WHERE "id" = $2 AND "${alvo.coluna}" = $3`,
                novo,
                id,
                antigo,
              ),
          });
        },
        { timeout: 60_000, maxWait: 10_000 },
      ),
  };
}

export function formatar(
  res: { alvo: Alvo; c: Contagem }[],
  op: Opcoes,
): string[] {
  const linhas = res.map(
    ({ alvo, c }) =>
      `${alvo.tabela}.${alvo.coluna}: lidas=${c.lidas} recifradas=${c.recifradas} conflitos=${c.conflitos} falhas=${c.falhas}`,
  );
  linhas.push(
    op.dryRun
      ? 'dry-run: nada foi gravado'
      : 'gravado: valores antigos trocados pela chave atual',
  );
  return linhas;
}

async function main(): Promise<number> {
  let op: Opcoes;
  try {
    op = lerOpcoes(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error(
      'DATABASE_URL_OWNER ausente: a recifragem roda como notta_owner (ver docs/ACESSO.md)',
    );
    return 2;
  }
  let cripto: CriptografiaService;
  try {
    cripto = new CriptografiaService();
  } catch (e) {
    // Mensagens do chaveiro so citam o nome da variavel e o kid, nunca o valor.
    console.error((e as Error).message);
    return 2;
  }
  const owner = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ usuario }] = await owner.$queryRaw<{ usuario: string }[]>`
      SELECT current_user AS "usuario"`;
    if (usuario !== 'notta_owner') {
      console.error(
        `recusado: conectado como ${usuario}; a recifragem precisa do papel notta_owner`,
      );
      return 2;
    }
    const res = await recifrarTudo(armazemPrisma(owner), cripto, op);
    for (const linha of formatar(res, op)) console.log(linha);
    return res.some((r) => r.c.falhas > 0) ? 1 : 0;
  } catch (e) {
    // So o nome do erro: a mensagem do Prisma pode trazer pedacos da consulta.
    console.error(`erro: ${(e as Error).name}`);
    return 1;
  } finally {
    await owner.$disconnect();
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
