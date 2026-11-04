// Saneamento da saida da IA (item 51, parte pura). A saida e SO texto: nada daqui executa,
// interpreta nem renderiza. Ela vira RASCUNHO e exige aprovacao humana. Aqui so se limpa,
// limita e se avisa (o psicologo ve os avisos ao revisar).
import { extrairDadosPessoais, ItemMapa, PADRAO_CODIGO } from './anonimizador';

// Mesmo limite do documento clinico.
export const LIMITE_SAIDA_IA = 20000;

export type MotivoSaidaIa = 'NAO_TEXTO' | 'VAZIA' | 'GRANDE_DEMAIS';

export class SaidaIaInvalidaError extends Error {
  constructor(readonly motivo: MotivoSaidaIa) {
    super(`Saida da IA invalida (${motivo})`);
    this.name = 'SaidaIaInvalidaError';
  }
}

export type AvisoSaida = 'DADO_NOVO' | 'CODIGO_DESCONHECIDO';

// Recusa (nao corta no meio). Chame tambem DEPOIS de reidentificar: o nome volta maior que
// o codigo e o documento aceita no maximo 20000.
export function validarTamanhoSaida(texto: string): void {
  if (texto.length > LIMITE_SAIDA_IA) {
    throw new SaidaIaInvalidaError('GRANDE_DEMAIS');
  }
}

export function sanearSaida(
  rascunho: string,
  mapa: ItemMapa[],
  textoEnviado: string,
): { texto: string; avisos: AvisoSaida[] } {
  if (typeof rascunho !== 'string') throw new SaidaIaInvalidaError('NAO_TEXTO');
  const texto = rascunho
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    // controle (menos \n e \t) e caracteres invisiveis de formato (bidi, largura zero, tags)
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' || c === '\t' ? c : ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (texto === '') throw new SaidaIaInvalidaError('VAZIA');
  validarTamanhoSaida(texto);

  const avisos: AvisoSaida[] = [];
  // O texto enviado ja estava anonimizado: CPF/e-mail/telefone na saida que nao estavam nele
  // sao dado inventado ou vazado pela IA.
  const enviados = extrairDadosPessoais(textoEnviado);
  if ([...extrairDadosPessoais(texto)].some((k) => !enviados.has(k))) {
    avisos.push('DADO_NOVO');
  }
  const conhecidos = new Set(mapa.map((i) => i.codigo));
  if ((texto.match(PADRAO_CODIGO) ?? []).some((c) => !conhecidos.has(c))) {
    avisos.push('CODIGO_DESCONHECIDO');
  }
  return { texto, avisos };
}
