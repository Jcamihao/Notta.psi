import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Roda o script de verdade (npm run chave:gerar faz o mesmo).
const GERADOR = join(__dirname, '../../scripts/gerar-chave.mjs');
const gerar = () =>
  execFileSync(process.execPath, [GERADOR], { encoding: 'utf8' });

describe('gerar-chave.mjs (item 25, parte A)', () => {
  it('imprime 64 caracteres hex e nada mais', () => {
    expect(gerar()).toMatch(/^[0-9a-f]{64}\n$/);
  });

  it('duas execucoes dao chaves diferentes', () => {
    expect(gerar()).not.toBe(gerar());
  });
});
