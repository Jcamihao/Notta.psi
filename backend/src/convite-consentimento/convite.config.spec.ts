import { lerConfigConvite } from './convite.config';

const prod = {
  NODE_ENV: 'production',
  NOTTA_TERMO_REVISADO: '1',
  NOTTA_APP_URL: 'https://app.exemplo.com',
};
const com = (extra: Record<string, string | undefined>) =>
  ({ ...prod, ...extra }) as NodeJS.ProcessEnv;

describe('lerConfigConvite: NOTTA_TERMO_REVISADO', () => {
  it('producao sem a variavel derruba o boot', () => {
    expect(() =>
      lerConfigConvite(com({ NOTTA_TERMO_REVISADO: undefined })),
    ).toThrow(/NOTTA_TERMO_REVISADO/);
  });

  it.each(['', '0', 'true', 'sim', ' 1', '1 ', '2'])(
    'producao com NOTTA_TERMO_REVISADO=%j derruba o boot (so o valor exato 1 vale)',
    (v) => {
      expect(() => lerConfigConvite(com({ NOTTA_TERMO_REVISADO: v }))).toThrow(
        /NOTTA_TERMO_REVISADO/,
      );
    },
  );

  it.each([undefined, '', 'Production', ' production '])(
    'NODE_ENV=%j conta como producao (so development e test dispensam)',
    (nodeEnv) => {
      expect(() =>
        lerConfigConvite(
          com({ NODE_ENV: nodeEnv, NOTTA_TERMO_REVISADO: undefined }),
        ),
      ).toThrow(/NOTTA_TERMO_REVISADO/);
    },
  );

  it('producao com NOTTA_TERMO_REVISADO=1 sobe', () => {
    expect(lerConfigConvite(com({})).appUrl).toBe('https://app.exemplo.com');
  });

  it.each(['development', 'test', ' Development '])(
    'NODE_ENV=%j nao exige a variavel',
    (nodeEnv) => {
      expect(() => lerConfigConvite({ NODE_ENV: nodeEnv })).not.toThrow();
    },
  );
});

describe('lerConfigConvite: NOTTA_APP_URL', () => {
  it('dev/test sem a variavel usa o ng serve local', () => {
    expect(lerConfigConvite({ NODE_ENV: 'development' }).appUrl).toBe(
      'http://localhost:4200',
    );
  });

  it('producao sem a variavel derruba o boot', () => {
    expect(() => lerConfigConvite(com({ NOTTA_APP_URL: undefined }))).toThrow(
      /NOTTA_APP_URL/,
    );
  });

  it.each(['lixo', 'ftp://app.exemplo.com', '//app.exemplo.com'])(
    'URL invalida %j derruba o boot',
    (url) => {
      expect(() => lerConfigConvite(com({ NOTTA_APP_URL: url }))).toThrow(
        /NOTTA_APP_URL/,
      );
    },
  );

  it('usuario e senha embutidos derrubam o boot sem repetir a URL', () => {
    const url = 'https://joao:segredo@app.exemplo.com';
    let msg = '';
    try {
      lerConfigConvite(com({ NOTTA_APP_URL: url }));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/usuario nem senha/);
    expect(msg).not.toContain('segredo');
  });

  it.each(['https://app.exemplo.com/?a=1', 'https://app.exemplo.com/#x'])(
    'query ou fragmento (%j) derruba o boot',
    (url) => {
      expect(() => lerConfigConvite(com({ NOTTA_APP_URL: url }))).toThrow(
        /query nem fragmento/,
      );
    },
  );

  it.each(['http://app.exemplo.com', 'http://localhost:4200'])(
    'http (%j) e recusado em producao, ate para localhost',
    (url) => {
      expect(() => lerConfigConvite(com({ NOTTA_APP_URL: url }))).toThrow(
        /precisa ser https/,
      );
    },
  );

  it.each(['http://localhost:4200', 'http://127.0.0.1:4200'])(
    '%j passa em development',
    (url) => {
      expect(
        lerConfigConvite({
          NODE_ENV: 'development',
          NOTTA_APP_URL: url,
        }).appUrl,
      ).toBe(url);
    },
  );

  it('http para host que nao e local e recusado ate em development', () => {
    expect(() =>
      lerConfigConvite({
        NODE_ENV: 'development',
        NOTTA_APP_URL: 'http://app.exemplo.com',
      }),
    ).toThrow(/precisa ser https/);
  });

  it('tira a barra do fim e guarda o caminho', () => {
    expect(
      lerConfigConvite(com({ NOTTA_APP_URL: 'https://app.exemplo.com/psi//' }))
        .appUrl,
    ).toBe('https://app.exemplo.com/psi');
    expect(
      lerConfigConvite(com({ NOTTA_APP_URL: 'https://app.exemplo.com/' }))
        .appUrl,
    ).toBe('https://app.exemplo.com');
  });
});
