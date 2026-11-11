// Retencao de RASCUNHO (item 52A): rascunho sem edicao por N dias e apagado pelo comando
// `npm run descartar`. UNICO lugar que le NOTTA_RETENCAO_RASCUNHO_DIAS. O servico de documentos
// (descarteEm) e o comando usam esta funcao. Invalido = erro (boot e comando), sem ecoar o valor.
export const RETENCAO_PADRAO_DIAS = 7;
// Teto de sanidade (100 anos): acima disso o calculo de data estoura e nao ha caso clinico real.
export const RETENCAO_MAXIMA_DIAS = 36500;

const MS_DIA = 24 * 60 * 60 * 1000;

export function retencaoRascunhoDias(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const bruto = env.NOTTA_RETENCAO_RASCUNHO_DIAS;
  if (bruto === undefined) return RETENCAO_PADRAO_DIAS;
  const n = /^[1-9][0-9]{0,4}$/.test(bruto) ? Number(bruto) : NaN;
  if (!(n >= 1 && n <= RETENCAO_MAXIMA_DIAS)) {
    throw new Error(
      `NOTTA_RETENCAO_RASCUNHO_DIAS: informe um inteiro de 1 a ${RETENCAO_MAXIMA_DIAS}`,
    );
  }
  return n;
}

// Data em que um rascunho com esta `atualizadoEm` seria apagado (cada edicao zera o prazo).
export function descarteEm(
  atualizadoEm: Date,
  dias: number = retencaoRascunhoDias(),
): Date {
  return new Date(atualizadoEm.getTime() + dias * MS_DIA);
}

// Corte do descarte: rascunho com atualizadoEm ANTES dele esta vencido. Mesma conta de descarteEm
// (atualizadoEm + dias < agora  <=>  atualizadoEm < agora - dias).
export function corteDescarte(
  agora: Date,
  dias: number = retencaoRascunhoDias(),
): Date {
  return new Date(agora.getTime() - dias * MS_DIA);
}
