// Testes de integracao exigem Postgres real: sem DATABASE_URL falha alto, nunca pula.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL ausente: testes e2e exigem Postgres real (ver backend/README.md)',
  );
}
