import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { verificar } from './csp.mjs';

// Roda DEPOIS do build de producao: `npm run build && npm run verificar:csp`.
// Falha (codigo 1) se o build tiver algo que a CSP estrita de docs/SEGURANCA-HEADERS.md bloqueia.
const dir = resolve(process.argv[2] ?? 'dist/frontend/browser');
if (!existsSync(resolve(dir, 'index.html'))) {
  console.error(`verificar:csp: sem build em ${dir}. Rode "npm run build" antes.`);
  process.exit(1);
}
const { achados, lidos } = verificar(dir);
if (achados.length) {
  console.error(`verificar:csp: ${achados.length} violacao(oes) da CSP estrita em ${dir}:`);
  for (const a of achados) console.error(`  - ${a}`);
  process.exit(1);
}
console.log(
  `verificar:csp: ok (${lidos.js} JS e ${lidos.html} HTML, nada que a CSP estrita bloqueie).`,
);
