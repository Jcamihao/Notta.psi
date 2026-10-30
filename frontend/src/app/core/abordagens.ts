// Valores = enum Abordagem do contrato; rotulos para gente.
export const ABORDAGENS = [
  ['SISTEMICA', 'Sistêmica'],
  ['TCC', 'TCC'],
  ['PSICANALISE', 'Psicanálise'],
  ['ACT', 'ACT'],
  ['HUMANISTA', 'Humanista'],
  ['OUTRA', 'Outra'],
] as const;

export const rotuloAbordagem = (valor: string): string =>
  ABORDAGENS.find(([v]) => v === valor)?.[1] ?? valor;
