// Testes de integracao exigem Postgres real: sem DATABASE_URL falha alto, nunca pula.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL ausente: testes e2e exigem Postgres real (ver backend/README.md)',
  );
}

// Chave mestra FIXA so de teste (nao e segredo), explicita aqui para o e2e nao
// depender de .env. Se NOTTA_MASTER_KEY ja estiver exportada, ela vale.
process.env.NOTTA_MASTER_KEY ||= 'e2e0'.repeat(16);
process.env.NOTTA_JWT_SECRET ||= 'segredo-jwt-so-de-teste-e2e-'.repeat(2);
