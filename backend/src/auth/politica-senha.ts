import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UnprocessableEntityException } from '@nestjs/common';

// Politica de senha (item 45), uma funcao pura reutilizada ao DEFINIR ou TROCAR senha: cadastro de
// clinica, colega criado pelo ADMIN e trocar-senha. O LOGIN nao usa (conta antiga com senha fraca
// continua entrando; so a troca exige forte). Sem servico externo: a senha nunca sai do processo.
export type MotivoSenha = 'CURTA' | 'COMUM' | 'PESSOAL' | 'REPETIDA';

export const MINIMO_CARACTERES = 10;

const MENSAGENS: Record<MotivoSenha, string> = {
  CURTA: `Senha fraca: use pelo menos ${MINIMO_CARACTERES} caracteres`,
  COMUM: 'Senha fraca: esta senha e muito comum',
  PESSOAL: 'Senha fraca: nao use seu nome nem seu e-mail na senha',
  REPETIDA: 'Senha fraca: evite repeticoes e sequencias como 1234567890',
};

// Lida uma vez, no carregamento do modulo (boot): zero I/O por requisicao. Uma por linha, minusculas.
// O arquivo e copiado para dist pelo nest-cli (assets). Origem e licenca: docs/LICENCAS.md.
const COMUNS = new Set(
  readFileSync(join(__dirname, 'senhas-comuns.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean),
);

// Fileiras de sequencia obvia (a senha inteira, em qualquer caixa, ou ao contrario).
const SEQUENCIAS = [
  '01234567890',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnm',
].flatMap((s) => [s, [...s].reverse().join('')]);

// Sem acento, minuscula: a lista e ASCII e quem digita "Glória" quis dizer "gloria".
const base = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const LEET: Record<string, string> = {
  '@': 'a',
  '0': 'o',
  '3': 'e',
  $: 's',
  '5': 's',
};
// "1" e ambiguo (i ou l): uma variante para cada.
const leet = (s: string, um: 'i' | 'l') =>
  s.replace(/[@03$5]/g, (c) => LEET[c]).replace(/1/g, um);

function variantes(s: string): string[] {
  return [s, leet(s, 'i'), leet(s, 'l')];
}

// Compara com a lista cortando o FIM (digitos e simbolos) em cada ponto possivel e so depois
// trocando o leetspeak: "Senha1234!" -> "senha"; "Fl@meng0123" -> "fl@meng0" -> "flamengo".
function ehComum(senha: string): boolean {
  const b = base(senha);
  for (let k = b.search(/[^a-z]*$/); k <= b.length; k++) {
    if (variantes(b.slice(0, k)).some((v) => COMUNS.has(v))) return true;
  }
  return false;
}

function ehRepetida(senha: string): boolean {
  const b = base(senha);
  // Unidade de 1 a 3 caracteres repetida do comeco ao fim ("aaaa", "1212", "abcabc").
  for (let p = 1; p <= 3; p++) {
    if ([...b].every((c, i) => c === b[i % p])) return true;
  }
  return SEQUENCIAS.some((s) => s.includes(b));
}

const PARTICULAS = new Set(['das', 'dos']);

function ehPessoal(senha: string, ctx: { email?: string; nome?: string }) {
  const alvos = variantes(base(senha));
  const contem = (parte: string) => alvos.some((v) => v.includes(parte));
  const email = base(ctx.email ?? '').trim();
  const local = email.split('@')[0];
  if (email && alvos.includes(email)) return true;
  if (local.length >= 3 && contem(local)) return true;
  return base(ctx.nome ?? '')
    .split(/[^a-z]+/)
    .some((w) => w.length >= 3 && !PARTICULAS.has(w) && contem(w));
}

// null = senha aceita. Ordem: o motivo mais simples de corrigir primeiro. O maximo de 72 BYTES do
// bcrypt e do DTO (400), nao daqui. Nunca loga nem devolve a senha.
export function avaliarSenha(
  senha: string,
  ctx: { email?: string; nome?: string },
): MotivoSenha | null {
  if ([...senha].length < MINIMO_CARACTERES) return 'CURTA';
  if (ehRepetida(senha)) return 'REPETIDA';
  if (ehPessoal(senha, ctx)) return 'PESSOAL';
  if (ehComum(senha)) return 'COMUM';
  return null;
}

// 422 `{statusCode, message, motivo}`. A lista nunca vai no corpo; todos os motivos de lista
// (COMUM) respondem igual e sem I/O (o tempo nao depende de qual senha da lista foi digitada).
export function exigirSenhaForte(
  senha: string,
  ctx: { email?: string; nome?: string },
): void {
  const motivo = avaliarSenha(senha, ctx);
  if (motivo) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      message: MENSAGENS[motivo],
      motivo,
    });
  }
}
