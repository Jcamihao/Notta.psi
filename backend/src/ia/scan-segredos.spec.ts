import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'scan-segredos.mjs');

// Valores montados em runtime: o proprio spec nao tem segredo literal.
const VALOR = 'Zq8' + 'x'.repeat(40);
const HEX64 = 'ab12'.repeat(16);
const PEM = '-----' + 'BEGIN ' + 'RSA PRIVATE KEY' + '-----';

function rodar(arquivos: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-segredos-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(dir, caminho)), { recursive: true });
    writeFileSync(join(dir, caminho), conteudo);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const r = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

describe('scan:segredos', () => {
  it('passa em repo limpo e em placeholders de documentacao', () => {
    const r = rodar({
      'README.md':
        'x-selah-api-key: <chave do app>\nexport NOTTA_MASTER_KEY=<64 hex>\nNOTTA_JWT_SECRET=$(openssl rand -base64 48)\nSELAHIA_API_KEY=\n',
      'src/a.ts':
        "const h = { 'x-selah-api-key': this.config.apiKey };\nconst k = process.env.SELAHIA_API_KEY;\n",
    });
    expect(r.codigo).toBe(0);
  });

  it.each([
    [
      'x-selah-api-key',
      `curl -H "x-selah-api-key: ${VALOR}"`,
      'SELAH_API_KEY_COM_VALOR',
    ],
    ['NOTTA_*', `NOTTA_MASTER_KEY=${VALOR}`, 'NOTTA_OU_SELAHIA_COM_VALOR'],
    [
      'SELAHIA_API_KEY',
      `SELAHIA_API_KEY="${VALOR}"`,
      'NOTTA_OU_SELAHIA_COM_VALOR',
    ],
    ['PEM', PEM, 'CHAVE_PRIVADA_PEM'],
    ['hex64', `const chave = '${HEX64}';`, 'HEX64_EM_ATRIBUICAO'],
  ])(
    'acha %s e imprime so arquivo:linha:tipo, nunca o valor',
    (_n, linha, tipo) => {
      const r = rodar({ 'docs/nota.md': `ok\n${linha}\n` });
      expect(r.codigo).toBe(1);
      expect(r.saida).toContain(`docs/nota.md:2:${tipo}`);
      for (const proibido of [VALOR, HEX64, 'rsa private']) {
        expect(r.saida.toLowerCase()).not.toContain(proibido.toLowerCase());
      }
    },
  );

  it('allowlist: teste e .env.example passam so para os tipos liberados', () => {
    const ok = rodar({
      'backend/test/x.e2e-spec.ts': `process.env.NOTTA_JWT_SECRET = '${VALOR}';\nconst k = '${HEX64}'; const kk = { chave: '${HEX64}' };`,
      'backend/src/a.spec.ts': `NOTTA_MASTER_KEY: '${VALOR}'`,
      'backend/.env.example': `NOTTA_MASTER_KEY=${VALOR}`,
    });
    expect(ok.codigo).toBe(0);
    // chave real do SelahIA e PEM nao passam nem em teste
    const ruim = rodar({
      'backend/src/a.spec.ts': `x-selah-api-key: ${VALOR}\n${PEM}`,
    });
    expect(ruim.codigo).toBe(1);
    expect(ruim.saida).toContain(
      'backend/src/a.spec.ts:1:SELAH_API_KEY_COM_VALOR',
    );
    expect(ruim.saida).toContain('backend/src/a.spec.ts:2:CHAVE_PRIVADA_PEM');
  });

  it('ignora arquivo binario', () => {
    const r = rodar({ 'img.bin': `\0${PEM}` });
    expect(r.codigo).toBe(0);
  });
});
