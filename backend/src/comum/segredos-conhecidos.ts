// Segredos que NUNCA valem em producao: ja foram publicados (exemplos do repo, tutoriais) ou
// estao nas suites de teste. Comparacao sempre aparada e sem diferenciar caixa; o JWT recusa
// tambem quando o valor CONTEM um destes (pega prefixo, sufixo e repeticao).
export const SEGREDOS_CONHECIDOS = {
  jwtPublicados: [
    'troque-isto-por-um-segredo-longo-e-aleatorio-fake',
    '0123456789abcdef0123456789abcdef',
    'my-super-secret-jwt-key-for-production',
  ],
  // Chave do SelahIA que nunca vale: texto de exemplo/placeholder.
  selahiaExemplos: [
    'changeme',
    'change-me',
    'troque-isto',
    'troque-por-uma-chave',
    'sua-chave-aqui',
    'sua-chave',
    'chave-de-exemplo',
    'your-api-key',
    'your_api_key',
    'api-key',
    'apikey',
    'secret',
    'example',
    'test',
    'xxx',
  ],
  // Usados pelas suites de teste. So passam com NOTTA_PERMITE_SEGREDO_DE_TESTE=1.
  jwtDeTeste: [
    'segredo-jwt-so-de-teste-e2e-',
    'segredo-jwt-de-teste-unitario-',
    'segredo-unitario-',
  ],
  masterDeTeste: [
    '0123456789abcdef'.repeat(4),
    'e2e0'.repeat(16),
    'fedcba9876543210'.repeat(4),
  ],
} as const;

export const normalizarSegredo = (v: string) => v.trim().toLowerCase();

// Variavel definida SO pelos helpers de teste (test/permite-segredo-de-teste.ts); nunca no
// .env.example, nunca em producao.
export const permiteSegredoDeTeste = (env: NodeJS.ProcessEnv = process.env) =>
  env.NOTTA_PERMITE_SEGREDO_DE_TESTE === '1';

export const contemConhecido = (valor: string, lista: readonly string[]) => {
  const n = normalizarSegredo(valor);
  return lista.some((k) => n.includes(k));
};
