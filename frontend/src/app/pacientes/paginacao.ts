// Paginacao da lista de pacientes. Roda no navegador, sobre a lista ja filtrada. Sem Angular: so
// funcao pura, testada em paginacao.spec.ts. Pagina e tamanho nunca vao para URL nem storage.

export const OPCOES_POR_PAGINA = [10, 20, 30] as const;
export type PorPagina = (typeof OPCOES_POR_PAGINA)[number];
export const POR_PAGINA_PADRAO: PorPagina = 20;

export interface Pagina<T> {
  itens: T[];
  // Pagina efetiva (1-based), ja corrigida para o intervalo valido.
  pagina: number;
  totalPaginas: number;
  // Posicoes 1-based do primeiro e do ultimo item mostrados; 0 e 0 quando a lista esta vazia.
  de: number;
  ate: number;
  total: number;
}

export function paginar<T>(lista: T[], pagina: number, porPagina: number): Pagina<T> {
  const tamanho = (OPCOES_POR_PAGINA as readonly number[]).includes(porPagina)
    ? porPagina
    : POR_PAGINA_PADRAO;
  const total = lista.length;
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  const pedida = Number.isNaN(pagina) ? 1 : Math.floor(pagina);
  const atual = Math.min(Math.max(pedida, 1), totalPaginas);
  const inicio = (atual - 1) * tamanho;
  const itens = lista.slice(inicio, inicio + tamanho);
  return {
    itens,
    pagina: atual,
    totalPaginas,
    de: total ? inicio + 1 : 0,
    ate: total ? inicio + itens.length : 0,
    total,
  };
}
