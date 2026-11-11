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

describe('validarEnv: NOTTA_RETENCAO_RASCUNHO_DIAS', () => {
  const base = { DATABASE_URL: 'postgresql://x:y@h/db' };

  it('ausente ou valido passa', () => {
    expect(() => validarEnv(base)).not.toThrow();
    expect(() =>
      validarEnv({ ...base, NOTTA_RETENCAO_RASCUNHO_DIAS: '14' }),
    ).not.toThrow();
  });

  it('invalido derruba o boot sem ecoar o valor', () => {
    expect(() =>
      validarEnv({ ...base, NOTTA_RETENCAO_RASCUNHO_DIAS: '0' }),
    ).toThrow(/NOTTA_RETENCAO_RASCUNHO_DIAS/);
    expect(() =>
      validarEnv({ ...base, NOTTA_RETENCAO_RASCUNHO_DIAS: 'sete' }),
    ).toThrow(/NOTTA_RETENCAO_RASCUNHO_DIAS/);
  });
});
