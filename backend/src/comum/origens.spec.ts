import { origensPermitidas } from './origens';

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;

describe('origensPermitidas (origem aceita no CSRF)', () => {
  it('NOTTA_APP_URL vira so a origem (sem caminho, sem barra)', () => {
    expect(
      origensPermitidas(
        env({ NODE_ENV: 'production', NOTTA_APP_URL: 'https://app.ex.com/x/' }),
      ),
    ).toEqual(['https://app.ex.com']);
  });

  it('soma NOTTA_CORS_ORIGIN sem repetir', () => {
    expect(
      origensPermitidas(
        env({
          NODE_ENV: 'production',
          NOTTA_APP_URL: 'https://app.ex.com',
          NOTTA_CORS_ORIGIN: 'https://app.ex.com',
        }),
      ),
    ).toEqual(['https://app.ex.com']);
    expect(
      origensPermitidas(
        env({
          NODE_ENV: 'production',
          NOTTA_APP_URL: 'https://app.ex.com',
          NOTTA_CORS_ORIGIN: 'https://outro.ex.com',
        }),
      ),
    ).toEqual(['https://app.ex.com', 'https://outro.ex.com']);
  });

  it.each(['development', 'test', ' Development '])(
    'NODE_ENV=%s sem origem: vale http://localhost:4200',
    (NODE_ENV) => {
      expect(origensPermitidas(env({ NODE_ENV }))).toEqual([
        'http://localhost:4200',
      ]);
    },
  );

  it.each([undefined, 'production', 'Production', ''])(
    'NODE_ENV=%s sem origem: boot falha (falha fechada)',
    (NODE_ENV) => {
      expect(() =>
        origensPermitidas(env(NODE_ENV === undefined ? {} : { NODE_ENV })),
      ).toThrow(/NOTTA_APP_URL obrigatoria/);
    },
  );

  it('origem invalida derruba o boot sem ecoar o valor', () => {
    const f = () =>
      origensPermitidas(
        env({ NODE_ENV: 'production', NOTTA_APP_URL: 'nao-e-url-segredo' }),
      );
    expect(f).toThrow(/invalida/);
    expect(f).not.toThrow(/segredo/);
  });
});
