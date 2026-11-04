// Detector LOCAL de dado que identifica o paciente (item 13). Funcao pura: nao grava, nao loga,
// nao envia nada. Devolve so os TIPOS achados, nunca o trecho. E um aviso, nao um bloqueio:
// vai errar nos dois sentidos, entao a regra e preferir poucos falsos positivos.
//
// Decisoes (documentadas no relatorio da task F14):
// - CPF: formato com pontos e traco (000.000.000-00), de qualquer valor; OU 11 digitos seguidos
//   com digito verificador valido e nao repetidos. Numero de 11 digitos que falha o digito nao
//   e CPF (pode ser telefone, protocolo, valor).
// - Telefone brasileiro: so formatos com DDD ((11) 91234-5678, 11 91234-5678, 11912345678,
//   +55...), fixo com DDD e hifen, ou celular sem DDD com hifen (91234-5678). "1234-5678" sozinho
//   NAO conta (colide com intervalo de anos).
// - Datas, valores, idades e horarios nao casam em nenhuma regra.
// - Nome do paciente: qualquer parte do nome (3+ letras, fora "da/de/do/dos/das/e") como palavra
//   inteira, sem diferenciar acento nem maiusculas.

export type TipoDado = 'CPF' | 'telefone' | 'e-mail' | 'CEP' | 'endereço' | 'nome do paciente';

const LETRA = String.raw`\p{L}\p{N}`;
const CONECTORES = new Set(['da', 'de', 'do', 'dos', 'das', 'e']);

// Minusculas e sem acento: as regras abaixo so precisam lidar com ASCII.
const normalizar = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function cpfValido(digitos: string): boolean {
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(digitos[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(digitos[9]) && dv(10) === Number(digitos[10]);
}

const CPF_PONTUADO = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g;
const ONZE_DIGITOS = /(?<!\d)\d{11}(?!\d)/g;
const TELEFONE = [
  /(?<!\d)(?:\+55\s?)?\(\d{2}\)\s?9?\d{4}-?\d{4}(?!\d)/,
  /(?<![\d+])(?:\+55\s?)?[1-9]\d\s?9\d{4}[-\s]?\d{4}(?!\d)/,
  /(?<!\d)[1-9]\d\s\d{4}-\d{4}(?!\d)/,
  /(?<![\d-])9\d{4}-\d{4}(?!\d)/,
];
const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+/;
const CEP = /(?<!\d)\d{5}-\d{3}(?!\d)|\bcep:?\s*\d{5}-?\d{3}(?!\d)/;
const ENDERECO = new RegExp(
  String.raw`(?<![${LETRA}])(?:rua|r\.|avenida|av\.|alameda|travessa|rodovia|estrada|praca)\s+[a-z0-9 .'-]{2,60}?,?\s+(?:n[o.°º]{0,2}\s*)?\d{1,5}(?!\d)`,
  'u',
);

function nomeAparece(texto: string, nome: string): boolean {
  const partes = normalizar(nome)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length >= 3 && !CONECTORES.has(p));
  return partes.some((p) =>
    new RegExp(
      String.raw`(?<![${LETRA}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![${LETRA}])`,
      'u',
    ).test(texto),
  );
}

export function detectarDados(texto: string, nomePaciente = ''): TipoDado[] {
  let t = normalizar(texto);
  const achados: TipoDado[] = [];

  const mascarar = (re: RegExp, aceita: (m: string) => boolean = () => true): boolean => {
    let achou = false;
    t = t.replace(re, (m) => {
      if (!aceita(m)) return m;
      achou = true;
      return ' '.repeat(m.length);
    });
    return achou;
  };

  // CPF primeiro e mascarado: os digitos dele nao podem virar telefone.
  const cpfA = mascarar(CPF_PONTUADO);
  const cpfB = mascarar(ONZE_DIGITOS, cpfValido);
  if (cpfA || cpfB) achados.push('CPF');
  if (TELEFONE.some((re) => re.test(t))) achados.push('telefone');
  if (EMAIL.test(t)) achados.push('e-mail');
  if (CEP.test(t)) achados.push('CEP');
  if (ENDERECO.test(t)) achados.push('endereço');
  if (nomePaciente.trim() && nomeAparece(t, nomePaciente)) achados.push('nome do paciente');
  return achados;
}
