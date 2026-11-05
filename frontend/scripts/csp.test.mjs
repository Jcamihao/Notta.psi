import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verificar } from './csp.mjs';

// Monta um "build" falso e devolve as violacoes. Prova que a verificacao FALHA quando deve.
const build = (arquivos) => {
  const dir = mkdtempSync(join(tmpdir(), 'csp-'));
  for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(dir, nome), conteudo);
  return verificar(dir).achados;
};
const RAIZ = '<app-root ngCspNonce="NOTTA_CSP_NONCE">';
const limpo =
  '<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><app-root ngCspNonce="NOTTA_CSP_NONCE"></app-root><script src="main.js" type="module"></script></body></html>';

test('build limpo passa', () => {
  assert.deepEqual(build({ 'index.html': limpo, 'main.js': 'const a = 1; export { a };' }), []);
});

test('index.html sem ngCspNonce no app-root falha', () => {
  const a = build({ 'index.html': limpo.replace(' ngCspNonce="NOTTA_CSP_NONCE"', '') });
  assert.equal(a.length, 1);
  assert.match(a[0], /ngCspNonce/);
});

test('eval( no JS falha', () => {
  assert.equal(build({ 'index.html': limpo, 'main.js': 'x = eval("1")' }).length, 1);
});

test('new Function( no JS falha (com espacos)', () => {
  assert.equal(
    build({ 'index.html': limpo, 'main.js': 'x = new  Function ("return 1")' }).length,
    1,
  );
});

test('nome que so contem eval nao falha (retrieval, medieval)', () => {
  assert.deepEqual(build({ 'index.html': limpo, 'main.js': 'retrieval(1); medieval(2);' }), []);
});

test('setTimeout com texto falha', () => {
  assert.equal(build({ 'index.html': limpo, 'main.js': 'setTimeout("f()", 1)' }).length, 1);
});

test('handler inline no HTML falha (onclick e onload do truque do CSS critico)', () => {
  const a = build({
    'index.html': limpo.replace(RAIZ, '<button onclick="x()">' + RAIZ),
  });
  assert.equal(a.length, 1);
  const b = build({
    'index.html': limpo.replace(
      '</head>',
      '<link rel="stylesheet" href="s.css" media="print" onload="this.media=\'all\'"></head>',
    ),
  });
  assert.equal(b.length, 1);
});

test('script inline sem hash falha; com nonce tambem (HTML estatico)', () => {
  assert.equal(
    build({ 'index.html': limpo.replace('</body>', '<script>alert(1)</script></body>') }).length,
    1,
  );
  const n = build({
    'index.html': limpo.replace('</body>', '<script nonce="abc">alert(1)</script></body>'),
  });
  assert.equal(n.length, 1);
  assert.match(n[0], /nonce nao vale/);
});

test('script inline de dado (application/json) passa', () => {
  assert.deepEqual(
    build({
      'index.html': limpo.replace(
        '</body>',
        '<script type="application/json">{"a":1}</script></body>',
      ),
    }),
    [],
  );
});

test('<style> e style="" no HTML falham', () => {
  assert.equal(
    build({ 'index.html': limpo.replace('</head>', '<style>a{}</style></head>') }).length,
    1,
  );
  assert.equal(
    build({ 'index.html': limpo.replace(RAIZ, '<div style="color:red">' + RAIZ) }).length,
    1,
  );
});

test('URL javascript: falha', () => {
  assert.equal(
    build({ 'index.html': limpo.replace(RAIZ, '<a href="javascript:x()">' + RAIZ) }).length,
    1,
  );
});
