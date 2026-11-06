// Helper de verificar-backup.sh: decifra a amostra que chega pelo stdin, com as chaves do ambiente.
// Linha: tabela TAB coluna TAB clinicaId TAB id TAB psicologoId TAB valor.
// Imprime SO contagens e OK/FALHOU por coluna. Nunca imprime valor, texto nem chave.
// Saida: 0 = tudo decifrou; 1 = alguma falha; 3 = nenhuma amostra (nada foi provado).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'criptografia', 'criptografia.service.js');

let modulo;
try {
  modulo = require(dist);
} catch {
  console.log('FALHOU: dist ausente. Rode npm run build antes.');
  process.exit(1);
}
const { CriptografiaService, aadDe } = modulo;

let servico;
try {
  servico = new CriptografiaService();
} catch (e) {
  // A mensagem do servico nunca traz a chave.
  console.log(`FALHOU: chave do ambiente invalida (${e.message})`);
  process.exit(1);
}

const contagens = new Map();
let totalOk = 0;
let totalFalha = 0;
for (const linha of readFileSync(0, 'utf8').split('\n')) {
  if (linha === '') continue;
  const [tabela, coluna, clinicaId, id, psicologoId, valor] = linha.split('\t');
  const chave = `${tabela}.${coluna}`;
  const c = contagens.get(chave) ?? { ok: 0, falha: 0 };
  try {
    servico.decifrar(clinicaId, valor, aadDe(tabela, coluna, id, psicologoId));
    c.ok += 1;
    totalOk += 1;
  } catch {
    c.falha += 1;
    totalFalha += 1;
  }
  contagens.set(chave, c);
}

for (const [chave, c] of contagens) {
  console.log(`amostra ${chave}: ${c.ok} OK, ${c.falha} FALHOU`);
}
if (totalFalha > 0) process.exit(1);
if (totalOk === 0) process.exit(3);
process.exit(0);
