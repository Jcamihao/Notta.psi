// Origens que podem chamar a API com cookie (checagem de Origin do CSRF, item 46):
// PRAXIS_APP_URL e PRAXIS_CORS_ORIGIN (so a origem, sem caminho). Em development/test, sem nenhuma
// das duas, vale http://localhost:4200 (ng serve), como em convite.config. Fora disso, sem origem
// = boot falha (falha fechada). Nunca ecoa o valor.
export const ORIGENS_PERMITIDAS = Symbol('ORIGENS_PERMITIDAS');

export function origensPermitidas(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dev = ['development', 'test'].includes(
    (env.NODE_ENV ?? '').trim().toLowerCase(),
  );
  const origens = new Set<string>();
  for (const bruto of [env.PRAXIS_APP_URL, env.PRAXIS_CORS_ORIGIN]) {
    if (bruto === undefined || bruto.trim() === '') continue;
    try {
      origens.add(new URL(bruto.trim()).origin);
    } catch {
      throw new Error('PRAXIS_APP_URL ou PRAXIS_CORS_ORIGIN invalida');
    }
  }
  if (origens.size === 0) {
    if (!dev) {
      throw new Error(
        'PRAXIS_APP_URL obrigatoria fora de development/test: e a origem aceita no CSRF',
      );
    }
    origens.add('http://localhost:4200');
  }
  return [...origens];
}
