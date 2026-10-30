import { validarEnv } from './env';

describe('validarEnv', () => {
  it('derruba o boot sem DATABASE_URL, sem ecoar valor', () => {
    expect(() => validarEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validarEnv({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('aceita DATABASE_URL presente', () => {
    expect(() =>
      validarEnv({ DATABASE_URL: 'postgresql://x:y@h/db' }),
    ).not.toThrow();
  });
});
