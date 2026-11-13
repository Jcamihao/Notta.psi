import { retencaoRascunhoDias } from './comum/retencao';

// Cada modulo futuro valida a propria env (chave mestra, JWT). Aqui o banco e a retencao de rascunho.
export function validarEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL obrigatoria (postgresql://praxis_app:...)');
  }
  // Lanca com mensagem sem o valor; sem a variavel, vale o padrao.
  retencaoRascunhoDias(env);
}
