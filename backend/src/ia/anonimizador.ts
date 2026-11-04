// Anonimizacao e reidentificacao (item 17). Funcoes puras e deterministicas: o texto da
// nota NUNCA sai do sistema sem passar por aqui. Falso negativo (dado que escapa) e o risco
// real; por isso o psicologo ve a previa e marca termos extras (itens 20 e 21).
// Limites conhecidos (ver README): endereco sem numero, data por extenso ("10 de maio"),
// telefone fixo sem DDD, nome de terceiro que nao esta nos termos extras.

export const LIMITE_TEXTO_IA = 8000;

export type MotivoTextoIa = 'VAZIO' | 'GRANDE_DEMAIS';

export class TextoIaInvalidoError extends Error {
  constructor(readonly motivo: MotivoTextoIa) {
    super(`Texto para a IA invalido (${motivo})`);
    this.name = 'TextoIaInvalidoError';
  }
}

export function validarTamanho(textoAnonimizado: string): void {
  if (typeof textoAnonimizado !== 'string' || textoAnonimizado.trim() === '') {
    throw new TextoIaInvalidoError('VAZIO');
  }
  if (textoAnonimizado.length > LIMITE_TEXTO_IA) {
    throw new TextoIaInvalidoError('GRANDE_DEMAIS');
  }
}

export interface ItemMapa {
  codigo: string;
  original: string;
}

export interface OpcoesAnonimizar {
  nomesPaciente: string[];
  termosExtras?: string[];
}

export interface ResultadoAnonimizar {
  textoAnonimizado: string;
  mapa: ItemMapa[];
}

// Um codigo no formato que o anonimizador gera: [CPF], [DATA_2], [TERMO_10].
export const PADRAO_CODIGO = /\[[A-Z][A-Z0-9_]*\]/g;

type Tipo =
  'CPF' | 'EMAIL' | 'TELEFONE' | 'ENDERECO' | 'DATA' | 'PACIENTE' | 'TERMO';

interface Span {
  ini: number;
  fim: number;
  tipo: Tipo;
  prio: number; // empate de tamanho: menor vence (CPF antes de telefone)
  chave: string; // mesmo dado = mesma chave = mesmo codigo
  codigo?: string; // PACIENTE e TERMO_n tem codigo fixo
}

const soDigitos = (s: string) => s.replace(/\D/g, '');
const compactar = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function cpfValido(m: string): boolean {
  const d = soDigitos(m);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

// DDDs brasileiros reais: evita tratar qualquer numero de 10/11 digitos como telefone.
const DDD =
  '(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])';
const NAO_ALNUM_ANTES = '(?<![\\p{L}\\p{N}])';

interface Padrao {
  tipo: Tipo;
  prio: number;
  re: RegExp;
  valido?: (m: string) => boolean;
  chave: (m: string) => string;
}

const PADROES: Padrao[] = [
  {
    tipo: 'CPF',
    prio: 0,
    re: /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/gu,
    chave: soDigitos,
  },
  {
    tipo: 'CPF',
    prio: 0,
    re: /(?<!\d)\d{11}(?!\d)/gu,
    valido: cpfValido,
    chave: soDigitos,
  },
  {
    tipo: 'EMAIL',
    prio: 1,
    re: /(?<![\p{L}\p{N}._%+'-])[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
    chave: (m) => m.toLowerCase(),
  },
  {
    tipo: 'TELEFONE',
    prio: 2,
    re: new RegExp(
      `(?<!\\d)(?:\\+55[\\s.-]?)?(?:\\(\\s*${DDD}\\s*\\)|${DDD})[\\s.-]?9?\\d{4}[\\s.-]?\\d{4}(?!\\d)`,
      'gu',
    ),
    chave: (m) => {
      const d = soDigitos(m);
      return d.length > 11 ? d.slice(-11) : d;
    },
  },
  {
    tipo: 'TELEFONE',
    prio: 2,
    re: /(?<!\d)9\d{4}-\d{4}(?!\d)/gu,
    chave: soDigitos,
  },
  {
    tipo: 'ENDERECO',
    prio: 3,
    re: new RegExp(
      `(?:${NAO_ALNUM_ANTES}cep\\s*:?\\s*)?(?<!\\d)\\d{5}-\\d{3}(?!\\d)`,
      'giu',
    ),
    chave: (m) => `cep:${soDigitos(m)}`,
  },
  {
    tipo: 'ENDERECO',
    prio: 3,
    re: new RegExp(`${NAO_ALNUM_ANTES}cep\\s*:?\\s*\\d{8}(?!\\d)`, 'giu'),
    chave: (m) => `cep:${soDigitos(m)}`,
  },
  {
    tipo: 'ENDERECO',
    prio: 3,
    re: new RegExp(
      `${NAO_ALNUM_ANTES}(?:rua|avenida|travessa|alameda|av\\.?|r\\.|tv\\.|al\\.)\\s+(?:[\\p{L}'.-]+[\\s,]+){1,6}?(?:n[ºo°]?\\.?\\s*)?\\d{1,5}(?!\\d)`,
      'giu',
    ),
    chave: compactar,
  },
  {
    tipo: 'DATA',
    prio: 4,
    re: /(?<![\d/])(?:(?:0?[1-9]|[12]\d|3[01])[/.-](?:0?[1-9]|1[0-2])[/.-](?:\d{4}|\d{2})|\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?![\d/])/gu,
    chave: (m) => m,
  },
];

function spansDePadroes(texto: string): Span[] {
  const spans: Span[] = [];
  for (const p of PADROES) {
    for (const m of texto.matchAll(p.re)) {
      if (p.valido && !p.valido(m[0])) continue;
      spans.push({
        ini: m.index,
        fim: m.index + m[0].length,
        tipo: p.tipo,
        prio: p.prio,
        chave: p.chave(m[0]),
      });
    }
  }
  return spans;
}

// Conflito: o trecho mais longo vence (e-mail que contem o nome vira um [EMAIL] so);
// empate: menor prio.
function resolver(spans: Span[], tamanho: number): Span[] {
  const ordem = [...spans].sort(
    (a, b) =>
      b.fim - b.ini - (a.fim - a.ini) || a.ini - b.ini || a.prio - b.prio,
  );
  const usado = new Uint8Array(tamanho);
  const aceitos: Span[] = [];
  for (const s of ordem) {
    let livre = true;
    for (let i = s.ini; i < s.fim; i++) {
      if (usado[i]) {
        livre = false;
        break;
      }
    }
    if (!livre) continue;
    usado.fill(1, s.ini, s.fim);
    aceitos.push(s);
  }
  return aceitos.sort((a, b) => a.ini - b.ini);
}

// Dobra cada unidade UTF-16 para minuscula sem acento. Mantem o MESMO comprimento, entao os
// indices do texto dobrado valem no original. Entrada ja em NFC.
const dobrado = new Map<string, string>();
function dobrarUnidade(c: string): string {
  let r = dobrado.get(c);
  if (r === undefined) {
    const l = c.normalize('NFD')[0].toLowerCase();
    r = l.length === 1 ? l : c;
    dobrado.set(c, r);
  }
  return r;
}
function dobrar(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += dobrarUnidade(s[i]);
  return out;
}

const preparar = (s: string) =>
  s.normalize('NFC').replace(/\[/g, '(').replace(/\]/g, ')');

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Palavra inteira: sem letra, numero ou marca colada dos dois lados.
function acharTermo(dobrada: string, termo: string): [number, number][] {
  const miolo = termo.split(/\s+/).map(escapar).join('\\s+');
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}\\p{M}])${miolo}(?![\\p{L}\\p{N}\\p{M}])`,
    'gu',
  );
  return [...dobrada.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
}

// Particulas de 3 letras sao palavras comuns do portugues: trocar "das"/"dos" no texto
// inteiro estragaria a nota sem proteger ninguem.
const PARTICULAS = new Set(['das', 'dos', 'del', 'van', 'von', 'der', 'den']);

function termosDoNome(nome: string): string[] {
  const completo = dobrar(preparar(nome)).replace(/\s+/g, ' ').trim();
  const partes = completo
    .split(/[\s'’-]+/)
    .filter(
      (p) => (p.match(/\p{L}/gu)?.length ?? 0) >= 3 && !PARTICULAS.has(p),
    );
  return completo.length >= 2 ? [completo, ...partes] : partes;
}

const nomeCompleto = (nome: string) =>
  preparar(nome).replace(/\s+/g, ' ').trim();

export function anonimizar(
  texto: string,
  { nomesPaciente, termosExtras = [] }: OpcoesAnonimizar,
): ResultadoAnonimizar {
  const limpo = preparar(texto);
  const dobrada = dobrar(limpo);
  const spans = spansDePadroes(limpo);

  const nomes = nomesPaciente.map(nomeCompleto).filter((n) => n !== '');
  const termosNome = new Set(nomes.flatMap(termosDoNome));
  for (const t of termosNome) {
    for (const [ini, fim] of acharTermo(dobrada, t)) {
      spans.push({
        ini,
        fim,
        tipo: 'PACIENTE',
        prio: 5,
        chave: 'paciente',
        codigo: '[PACIENTE]',
      });
    }
  }

  // Numeracao pela posicao na lista (sem vazios nem repetidos): estavel para a previa.
  const termos: string[] = [];
  for (const t of termosExtras) {
    const d = dobrar(nomeCompleto(t));
    if (d !== '' && !termos.includes(d)) termos.push(d);
  }
  termos.forEach((t, i) => {
    for (const [ini, fim] of acharTermo(dobrada, t)) {
      spans.push({
        ini,
        fim,
        tipo: 'TERMO',
        prio: 6,
        chave: t,
        codigo: `[TERMO_${i + 1}]`,
      });
    }
  });

  const porTipo = new Map<Tipo, Map<string, string>>();
  const vistos = new Set<string>();
  const mapa: ItemMapa[] = [];
  if (nomes.length > 0) {
    mapa.push({ codigo: '[PACIENTE]', original: nomes[0] });
    vistos.add('[PACIENTE]');
  }
  let saida = '';
  let pos = 0;
  for (const s of resolver(spans, limpo.length)) {
    let codigo = s.codigo;
    if (!codigo) {
      const porChave = porTipo.get(s.tipo) ?? new Map<string, string>();
      porTipo.set(s.tipo, porChave);
      codigo = porChave.get(s.chave);
      if (!codigo) {
        const n = porChave.size + 1;
        codigo = n === 1 ? `[${s.tipo}]` : `[${s.tipo}_${n}]`;
        porChave.set(s.chave, codigo);
      }
    }
    if (!vistos.has(codigo)) {
      vistos.add(codigo);
      // original = 1a ocorrencia, com a grafia do texto
      mapa.push({ codigo, original: limpo.slice(s.ini, s.fim) });
    }
    saida += limpo.slice(pos, s.ini) + codigo;
    pos = s.fim;
  }
  saida += limpo.slice(pos);
  return { textoAnonimizado: saida, mapa };
}

// Uma passada so, por funcao de troca: o original entra literal (sem $&) e nao e
// reprocessado (sem recursao).
export function reidentificar(texto: string, mapa: ItemMapa[]): string {
  const por = new Map<string, string>();
  for (const i of mapa) if (!por.has(i.codigo)) por.set(i.codigo, i.original);
  return texto.replace(PADRAO_CODIGO, (c) => por.get(c) ?? c);
}

// Dados que a saida da IA nao deveria ter (CPF, e-mail, telefone), com chave normalizada.
// Usado em saida-ia.ts para o aviso DADO_NOVO.
export function extrairDadosPessoais(texto: string): Set<string> {
  const achados = new Set<string>();
  for (const s of resolver(spansDePadroes(texto), texto.length)) {
    if (s.tipo === 'CPF' || s.tipo === 'EMAIL' || s.tipo === 'TELEFONE') {
      achados.add(`${s.tipo}:${s.chave}`);
    }
  }
  return achados;
}
