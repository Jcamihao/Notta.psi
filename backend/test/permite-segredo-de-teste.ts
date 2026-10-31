// Setup dos dois projetos Jest (unit e e2e): libera os segredos de teste conhecidos
// (SEGREDOS_CONHECIDOS). Nunca vai no .env.example nem em producao.
process.env.NOTTA_PERMITE_SEGREDO_DE_TESTE = '1';
