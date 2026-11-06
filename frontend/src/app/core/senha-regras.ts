// Regras da dica de senha (item 45), conferidas ao vivo no navegador. So orientacao: o servidor
// e a autoridade e tambem recusa senha COMUM (a lista nao vai para o navegador).
export interface RegraSenha {
  id: 'tamanho' | 'padrao' | 'pessoal';
  texto: string;
  ok: boolean;
}

const MINIMO = 10;
const SEQUENCIAS = [
  '01234567890',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnm',
].flatMap((s) => [s, [...s].reverse().join('')]);
const PARTICULAS = new Set(['das', 'dos']);

const base = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Unidade de 1 a 3 caracteres repetida do comeco ao fim, ou trecho de sequencia obvia.
function repetidaOuSequencia(senha: string): boolean {
  const b = [...base(senha)];
  for (let p = 1; p <= 3; p++) {
    if (b.every((c, i) => c === b[i % p])) return true;
  }
  return SEQUENCIAS.some((s) => s.includes(b.join('')));
}

function contemPessoal(senha: string, ctx: { email: string; nome: string }): boolean {
  const s = base(senha);
  const local = base(ctx.email).trim().split('@')[0];
  if (local.length >= 3 && s.includes(local)) return true;
  return base(ctx.nome)
    .split(/[^a-z]+/)
    .some((w) => w.length >= 3 && !PARTICULAS.has(w) && s.includes(w));
}

export function regrasSenha(senha: string, ctx: { email: string; nome: string }): RegraSenha[] {
  const vazia = senha === '';
  // Repeticao e sequencia so contam depois de 4 caracteres (digitar "a" nao e "repeticao").
  const curtaDemais = [...senha].length < 4;
  return [
    { id: 'tamanho', texto: '10 ou mais caracteres', ok: [...senha].length >= MINIMO },
    {
      id: 'padrao',
      texto: 'Não é só repetição ou sequência (como 1111111111 ou abcdefghij)',
      ok: vazia ? false : curtaDemais || !repetidaOuSequencia(senha),
    },
    {
      id: 'pessoal',
      texto: 'Não contém seu nome nem seu e-mail',
      ok: vazia ? false : !contemPessoal(senha, ctx),
    },
  ];
}
