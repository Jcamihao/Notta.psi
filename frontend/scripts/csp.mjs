import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

// Hashes (sha256, base64) de scripts inline que a CSP do servidor lista de proposito.
// Vazio: o build nao deve ter nenhum <script> inline. Se um dia precisar de um, o hash vai aqui E em
// docs/SEGURANCA-HEADERS.md (script-src 'sha256-...'); nunca afrouxe a CSP com 'unsafe-inline'.
export const HASHES_PERMITIDOS = [];

const arquivos = (dir) =>
  readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });

const linhaDe = (texto, indice) => texto.slice(0, indice).split('\n').length;

// Tipos que o navegador trata como dado (nao executa): <script type="application/json"> passa.
const executavel = (tipo) =>
  !tipo ||
  /^(module|(text|application)\/(x-)?(java|ecma)script|importmap|speculationrules)$/i.test(tipo);

function verificarJs(texto, nome, achados) {
  const regras = [
    [/\beval\s*\(/g, 'eval('],
    [/\bnew\s+Function\s*\(/g, 'new Function('],
    [/\bsetTimeout\s*\(\s*["'`]/g, 'setTimeout com texto (eval disfarcado)'],
    [/\bsetInterval\s*\(\s*["'`]/g, 'setInterval com texto (eval disfarcado)'],
  ];
  for (const [re, rotulo] of regras) {
    for (const m of texto.matchAll(re)) {
      achados.push(`${nome}:${linhaDe(texto, m.index)}: ${rotulo}`);
    }
  }
}

function verificarHtml(texto, nome, achados) {
  // O Angular so poe nonce nos <style> que injeta se o <app-root> trouxer ngCspNonce; sem ele a
  // CSP bloqueia o estilo de todos os componentes (verificado no navegador).
  if (nome === 'index.html' && !/ngcspnonce="PRAXIS_CSP_NONCE"/i.test(texto)) {
    achados.push(
      'index.html: <app-root> sem ngCspNonce="PRAXIS_CSP_NONCE" (o estilo dos componentes seria bloqueado)',
    );
  }
  // Handler inline (onclick=, onload=, ...): a CSP sem 'unsafe-inline' bloqueia.
  for (const m of texto.matchAll(/<[a-z][^>]*?\son[a-z]+\s*=/gi)) {
    achados.push(
      `${nome}:${linhaDe(texto, m.index)}: handler inline (${m[0].match(/\son[a-z]+/i)[0].trim()}=)`,
    );
  }
  // javascript: em href/src/action.
  for (const m of texto.matchAll(/\s(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/gi)) {
    achados.push(`${nome}:${linhaDe(texto, m.index)}: URL javascript:`);
  }
  // <script> inline: so com hash esperado (nonce nao serve: o HTML estatico nao tem como trocar).
  for (const m of texto.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const tipo = attrs.match(/\stype\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    if (!executavel(tipo)) continue;
    const hash = `sha256-${createHash('sha256').update(m[2]).digest('base64')}`;
    if (HASHES_PERMITIDOS.includes(hash)) continue;
    const nonce = /\snonce\s*=/i.test(attrs) ? ' (nonce nao vale: o HTML e estatico)' : '';
    achados.push(
      `${nome}:${linhaDe(texto, m.index)}: <script> inline sem hash esperado${nonce}, ${hash}`,
    );
  }
  // CSP sem 'unsafe-inline' em style-src: <style> e style="" tambem caem.
  for (const m of texto.matchAll(/<style\b/gi)) {
    achados.push(`${nome}:${linhaDe(texto, m.index)}: <style> inline`);
  }
  for (const m of texto.matchAll(/<[a-z][^>]*?\sstyle\s*=/gi)) {
    achados.push(`${nome}:${linhaDe(texto, m.index)}: atributo style=""`);
  }
}

// Le o build de producao e devolve a lista de violacoes da CSP estrita (vazia = ok).
export function verificar(dir) {
  const achados = [];
  const lidos = { js: 0, html: 0 };
  for (const caminho of arquivos(dir)) {
    const ext = extname(caminho).toLowerCase();
    const nome = relative(dir, caminho);
    if (ext === '.js' || ext === '.mjs') {
      verificarJs(readFileSync(caminho, 'utf8'), nome, achados);
      lidos.js++;
    } else if (ext === '.html' || ext === '.htm') {
      verificarHtml(readFileSync(caminho, 'utf8'), nome, achados);
      lidos.html++;
    }
  }
  return { achados, lidos };
}
