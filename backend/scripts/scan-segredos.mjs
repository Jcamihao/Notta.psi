// Varredura de segredos nos arquivos versionados (item 42).
// Uso: npm run scan:segredos (de qualquer pasta do repo). Sai com 1 se achar algo e imprime
// SO `arquivo:linha:tipo`, NUNCA o valor. A obrigatoriedade no CI e o item 43.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const raiz = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

// Os literais de PEM ficam quebrados em dois pedacos para o proprio script nao se achar.
const PADROES = [
  {
    tipo: 'SELAH_API_KEY_COM_VALOR',
    re: /x-selah-api-key['"]?\s*[:=]\s*['"]?(?![$<{])[A-Za-z0-9_+/=-]{16,}/i,
  },
  {
    tipo: 'NOTTA_OU_SELAHIA_COM_VALOR',
    re: /\b(?:NOTTA_[A-Z0-9_]+|SELAHIA_API_KEY)\b\s*[:=]\s*['"]?(?![$<{(])[^\s'"]{32,}/,
  },
  {
    tipo: 'CHAVE_PRIVADA_PEM',
    re: new RegExp('-----' + 'BEGIN ' + '(?:[A-Z]+ )*PRIVATE KEY' + '-----'),
  },
  {
    tipo: 'HEX64_EM_ATRIBUICAO',
    re: /[A-Za-z_]\w*['"]?\s*(?::|=|=>)\s*['"`]?[0-9a-fA-F]{64}(?![0-9a-fA-F])/,
  },
];

// Allowlist curta e explicita. Cada entrada: caminho (regex sobre o caminho relativo a raiz),
// tipos liberados e o motivo. Qualquer coisa fora disso e achado.
const ALLOWLIST = [
  {
    caminho: /^backend\/(?:test\/|src\/.*\.spec\.ts$)/,
    tipos: ['NOTTA_OU_SELAHIA_COM_VALOR', 'HEX64_EM_ATRIBUICAO'],
    motivo: 'suites de teste usam segredos FALSOS de teste (SEGREDOS_CONHECIDOS)',
  },
  {
    caminho: /^backend\/\.env\.example$/,
    tipos: ['NOTTA_OU_SELAHIA_COM_VALOR'],
    motivo: 'exemplo com valores falsos de desenvolvimento',
  },
];

const liberado = (arquivo, tipo) =>
  ALLOWLIST.some((a) => a.caminho.test(arquivo) && a.tipos.includes(tipo));

function varrer(arquivos) {
  const achados = [];
  for (const { arquivo, conteudo } of arquivos) {
    conteudo.split(/\r?\n/).forEach((linha, i) => {
      for (const { tipo, re } of PADROES) {
        if (re.test(linha) && !liberado(arquivo, tipo)) {
          achados.push(`${arquivo}:${i + 1}:${tipo}`);
        }
      }
    });
  }
  return achados;
}

const arquivos = [];
for (const arquivo of execFileSync('git', ['ls-files', '-z'], {
  cwd: raiz,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)) {
  const caminho = join(raiz, arquivo);
  let st;
  try {
    st = statSync(caminho);
  } catch {
    continue; // listado mas apagado do disco
  }
  if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
  const buf = readFileSync(caminho);
  if (buf.includes(0)) continue; // binario
  arquivos.push({ arquivo, conteudo: buf.toString('utf8') });
}

const achados = varrer(arquivos);
if (achados.length > 0) {
  console.error(achados.join('\n'));
  console.error(`${achados.length} possivel(is) segredo(s). Valores nao sao impressos.`);
  process.exit(1);
}
console.log(`scan:segredos ok (${arquivos.length} arquivos versionados)`);
