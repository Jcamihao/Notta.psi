import { lerConfigIa } from './ia.config';

const CHAVE = 'k7Qw9ZpLr2VnX4sB8tYhM1aD6fGcJ3uE';
const base = {
  NOTTA_IA_HABILITADA: '1',
  SELAHIA_URL: 'https://selahia.exemplo.com',
  SELAHIA_API_KEY: CHAVE,
  NODE_ENV: 'production',
};
const com = (extra: Record<string, string | undefined>) =>
  ({ ...base, ...extra }) as NodeJS.ProcessEnv;

describe('lerConfigIa: desabilitada', () => {
  it.each([undefined, '', '0', 'true', 'TRUE', 'sim', ' 1', '1 ', '2'])(
    'NOTTA_IA_HABILITADA=%j desliga e nao exige mais nada',
    (v) => {
      const c = lerConfigIa({ NOTTA_IA_HABILITADA: v });
      expect(c.habilitada).toBe(false);
    },
  );

  it('desligada ignora URL e chave invalidas', () => {
    expect(
      lerConfigIa({
        SELAHIA_URL: 'lixo',
        SELAHIA_API_KEY: 'changeme',
        NODE_ENV: 'production',
      }).habilitada,
    ).toBe(false);
  });
});

describe('lerConfigIa: habilitada', () => {
  it('config valida em producao (https)', () => {
    const c = lerConfigIa(com({}));
    expect(c).toMatchObject({
      habilitada: true,
      url: 'https://selahia.exemplo.com',
      apiKey: CHAVE,
    });
    expect(c.timeoutMs).toBe(50_000);
  });

  it('tira barra final da URL e apara a chave', () => {
    const c = lerConfigIa(
      com({
        SELAHIA_URL: ' https://selahia.exemplo.com/api// ',
        SELAHIA_API_KEY: `  ${CHAVE}\n`,
      }),
    );
    expect(c.url).toBe('https://selahia.exemplo.com/api');
    expect(c.apiKey).toBe(CHAVE);
  });

  it.each([
    undefined,
    '',
    '   ',
    'nao-e-url',
    '//selahia.exemplo.com',
    'https://',
  ])('URL ausente ou invalida (%j) derruba o boot', (url) => {
    expect(() => lerConfigIa(com({ SELAHIA_URL: url }))).toThrow(/SELAHIA_URL/);
  });

  it('so aceita http e https', () => {
    for (const url of ['ftp://x.com', 'file:///etc/passwd', 'ws://x.com']) {
      expect(() => lerConfigIa(com({ SELAHIA_URL: url }))).toThrow(
        /SELAHIA_URL/,
      );
    }
  });

  it.each([
    'production',
    'Production',
    ' production ',
    'staging',
    undefined,
    '',
  ])(
    'http recusado fora de development/test (NODE_ENV=%j), ate para localhost',
    (nodeEnv) => {
      for (const url of [
        'http://selahia.exemplo.com',
        'http://localhost:3010',
      ]) {
        expect(() =>
          lerConfigIa(com({ SELAHIA_URL: url, NODE_ENV: nodeEnv })),
        ).toThrow(/https/);
      }
    },
  );

  it.each(['development', 'test', ' Development ', 'TEST'])(
    'http://localhost e http://127.0.0.1 passam em NODE_ENV=%j',
    (nodeEnv) => {
      for (const url of ['http://localhost:3010', 'http://127.0.0.1:3010']) {
        expect(
          lerConfigIa(com({ SELAHIA_URL: url, NODE_ENV: nodeEnv })).url,
        ).toBe(url);
      }
    },
  );

  it('em development, http para host que nao e local continua recusado', () => {
    for (const url of [
      'http://selahia.exemplo.com',
      'http://localhost.evil.com',
      'http://10.0.0.5:3010',
      'http://[::1]:3010',
    ]) {
      expect(() =>
        lerConfigIa(com({ SELAHIA_URL: url, NODE_ENV: 'development' })),
      ).toThrow(/https/);
    }
  });

  it('URL com usuario ou senha embutidos derruba o boot, sem ecoar a senha', () => {
    for (const url of [
      'https://admin:senhaSecreta123@selahia.exemplo.com',
      'https://admin@selahia.exemplo.com',
      'https://:senhaSecreta123@selahia.exemplo.com',
    ]) {
      let msg = '';
      try {
        lerConfigIa(com({ SELAHIA_URL: url }));
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/SELAHIA_URL/);
      expect(msg).not.toContain('senhaSecreta123');
      expect(msg).not.toContain('admin');
    }
  });

  it.each([
    undefined,
    '',
    '   ',
    'changeme',
    ' ChangeMe ',
    'TROQUE-ISTO',
    'sua-chave-aqui',
    'example',
  ])('chave ausente, vazia ou de exemplo (%j) derruba o boot', (chave) => {
    expect(() => lerConfigIa(com({ SELAHIA_API_KEY: chave }))).toThrow(
      /SELAHIA_API_KEY/,
    );
  });

  it('mensagens de erro nunca repetem a chave nem a URL', () => {
    const casos = [
      com({ SELAHIA_URL: 'http://selahia.exemplo.com' }),
      com({ SELAHIA_URL: 'lixo-' + CHAVE }),
      com({ SELAHIA_API_KEY: 'changeme' }),
    ];
    for (const env of casos) {
      try {
        lerConfigIa(env);
        throw new Error('deveria lancar');
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain(CHAVE);
        expect(msg).not.toContain('selahia.exemplo.com');
      }
    }
  });
});

describe('lerConfigIa: NOTTA_IA_LIMITE_DIARIO (item 19)', () => {
  it('padrao 20 quando ausente ou vazio (habilitada ou nao)', () => {
    expect(lerConfigIa(com({})).limiteDiario).toBe(20);
    expect(
      lerConfigIa(com({ NOTTA_IA_LIMITE_DIARIO: '  ' })).limiteDiario,
    ).toBe(20);
    expect(lerConfigIa({}).limiteDiario).toBe(20);
  });

  it.each([
    ['1', 1],
    ['5', 5],
    [' 100 ', 100],
  ])('valor %j vale %d', (v, esperado) => {
    expect(lerConfigIa(com({ NOTTA_IA_LIMITE_DIARIO: v })).limiteDiario).toBe(
      esperado,
    );
  });

  it.each(['0', '-1', '1.5', 'abc', '1e3', '20 geracoes', '9999999', '+5'])(
    'valor invalido %j derruba o boot com a IA habilitada',
    (v) => {
      expect(() => lerConfigIa(com({ NOTTA_IA_LIMITE_DIARIO: v }))).toThrow(
        'NOTTA_IA_LIMITE_DIARIO invalido',
      );
    },
  );

  it('desabilitada ignora valor invalido', () => {
    expect(() =>
      lerConfigIa({ NOTTA_IA_HABILITADA: '0', NOTTA_IA_LIMITE_DIARIO: 'x' }),
    ).not.toThrow();
  });
});
