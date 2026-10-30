// Cada modulo futuro valida a propria env (chave mestra, JWT). Aqui so o banco.
export function validarEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL obrigatoria (postgresql://notta_app:...)');
  }
}
