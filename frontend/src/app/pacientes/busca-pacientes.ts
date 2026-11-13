import type { EstadoConsentimento } from './consentimento.service';
import type { Paciente } from './pacientes.service';

// Busca e filtro da lista de pacientes. Tudo roda no navegador, sobre a lista que o servidor ja
// entregou (dados ja decifrados). Sem Angular: so funcoes puras, testadas em busca-pacientes.spec.ts.

export type FiltroConsentimento = 'TODOS' | EstadoConsentimento;

// Minusculas, sem acentos e sem espacos nas pontas ("José " -> "jose").
export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

const SO_DIGITOS = /\D/g;
const NUMERICA = /^[\d+().-]*\d[\d+().-]*$/;
// Abaixo disso um numero e so texto: "99" nao casa telefone (muita gente tem 99 no meio do numero).
const DIGITOS_MINIMOS_TELEFONE = 3;

type Parte = { tipo: 'texto'; valor: string } | { tipo: 'numero'; valor: string; digitos: string };

// Divide o termo em palavras de texto e em grupos numericos. Palavras numericas seguidas formam um
// grupo so ("11 99999-0000" vira um telefone), para o DDD separado do numero continuar casando.
function partesDoTermo(termo: string): Parte[] {
  const partes: Parte[] = [];
  for (const palavra of normalizarTexto(termo).split(/\s+/).filter(Boolean)) {
    const ultima = partes[partes.length - 1];
    if (NUMERICA.test(palavra)) {
      if (ultima?.tipo === 'numero') {
        ultima.valor = `${ultima.valor} ${palavra}`;
        ultima.digitos += palavra.replace(SO_DIGITOS, '');
      } else {
        partes.push({ tipo: 'numero', valor: palavra, digitos: palavra.replace(SO_DIGITOS, '') });
      }
    } else {
      partes.push({ tipo: 'texto', valor: palavra });
    }
  }
  return partes;
}

// Casa se TODAS as partes do termo aparecerem: texto no nome ou no e-mail; numero no nome ou no
// e-mail, ou nos digitos do telefone (com 3 digitos ou mais). Campo vazio ou so espacos = casa tudo.
export function casaBusca(
  paciente: Pick<Paciente, 'nome' | 'email' | 'telefone'>,
  termo: string,
): boolean {
  const partes = partesDoTermo(termo);
  if (!partes.length) return true;
  const nome = normalizarTexto(paciente.nome);
  const email = normalizarTexto(paciente.email);
  const telefone = (paciente.telefone ?? '').replace(SO_DIGITOS, '');
  return partes.every((parte) => {
    const noTexto = nome.includes(parte.valor) || email.includes(parte.valor);
    if (parte.tipo === 'texto') return noTexto;
    const noTelefone =
      parte.digitos.length >= DIGITOS_MINIMOS_TELEFONE && telefone.includes(parte.digitos);
    return noTexto || noTelefone;
  });
}

// Filtra por busca e por estado de consentimento (paciente sem o campo conta como NENHUM). Mantem a
// ordem da lista; devolve uma lista nova.
export function filtrarPacientes(
  lista: readonly Paciente[],
  termo: string,
  estado: FiltroConsentimento,
): Paciente[] {
  return lista.filter(
    (p) => (estado === 'TODOS' || (p.consentimento ?? 'NENHUM') === estado) && casaBusca(p, termo),
  );
}
