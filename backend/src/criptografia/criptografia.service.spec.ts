import {
  aadDe,
  CriptografiaService,
  derivarChaveClinica,
  kidDe,
} from './criptografia.service';

const MASTER = '0123456789abcdef'.repeat(4);
// AAD canonico de uma linha qualquer (tabela|coluna|id|psicologoId).
const AAD = aadDe('Documento', 'texto', 'doc-1', 'psi-1');
const FORMATO = /^v1\.k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]*$/;

// null = variavel ausente.
function servico(chave: string | null = MASTER) {
  delete process.env.PRAXIS_MASTER_KEYS;
  delete process.env.PRAXIS_MASTER_KEY_ATUAL;
  if (chave === null) delete process.env.PRAXIS_MASTER_KEY;
  else process.env.PRAXIS_MASTER_KEY = chave;
  return new CriptografiaService();
}

// Troca 1 caractere da parte i (0=v, 1=kid, 2=iv, 3=tag, 4=ct) na posicao pos.
function adulterar(valor: string, i: number, pos: number): string {
  const partes = valor.split('.');
  const p = partes[i];
  const c = p[pos] === 'A' ? 'B' : 'A';
  partes[i] = p.slice(0, pos) + c + p.slice(pos + 1);
  return partes.join('.');
}

describe('CriptografiaService', () => {
  const original = process.env.PRAXIS_MASTER_KEY;
  const permite = process.env.PRAXIS_PERMITE_SEGREDO_DE_TESTE;
  afterEach(() => {
    if (original === undefined) delete process.env.PRAXIS_MASTER_KEY;
    else process.env.PRAXIS_MASTER_KEY = original;
    if (permite === undefined)
      delete process.env.PRAXIS_PERMITE_SEGREDO_DE_TESTE;
    else process.env.PRAXIS_PERMITE_SEGREDO_DE_TESTE = permite;
  });

  describe('roundtrip', () => {
    it.each([
      ['ASCII', 'Paciente relata ansiedade no trabalho.'],
      ['acentos', 'Sessão: ação, coração, avó, pão, ç'],
      ['emoji', 'humor 😀😢 hoje 🧠'],
      ['100 KB', 'x'.repeat(100 * 1024)],
      ['vazio', ''],
    ])('%s', (_, texto) => {
      const c = servico();
      expect(c.decifrar('cli-a', c.cifrar('cli-a', texto, AAD), AAD)).toBe(
        texto,
      );
    });

    it('outra instancia com a mesma chave mestra decifra', () => {
      const v = servico().cifrar('cli-a', 'abc', AAD);
      expect(servico().decifrar('cli-a', v, AAD)).toBe('abc');
    });
  });

  describe('formato', () => {
    it('bate o regex, iv tem 16 chars e duas cifragens diferem', () => {
      const c = servico();
      const a = c.cifrar('cli-a', 'mesmo texto', AAD);
      const b = c.cifrar('cli-a', 'mesmo texto', AAD);
      expect(a).toMatch(FORMATO);
      expect(b).toMatch(FORMATO);
      expect(a.split('.')[2]).toHaveLength(16);
      expect(a).not.toBe(b);
      expect(a.split('.')[2]).not.toBe(b.split('.')[2]);
    });

    it('texto vazio gera ct vazio no formato', () => {
      expect(servico().cifrar('cli-a', '', AAD)).toMatch(FORMATO);
    });

    it('nao contem o texto claro (UTF-8 nem base64)', () => {
      const texto = 'segredo clinico do paciente fulano';
      const v = servico().cifrar('cli-a', texto, AAD);
      const buf = Buffer.from(texto, 'utf8');
      expect(v).not.toContain(texto);
      expect(v).not.toContain('segredo');
      expect(v).not.toContain(buf.toString('base64url').slice(0, 12));
      expect(v).not.toContain(buf.toString('base64').slice(0, 12));
    });
  });

  describe('decifrar falha generica', () => {
    const texto = 'conteudo sensivel da sessao';
    let c: CriptografiaService;
    let v: string;
    beforeEach(() => {
      c = servico();
      v = c.cifrar('cli-a', texto, AAD);
    });

    function falhaSemVazar(fn: () => unknown) {
      let erro: unknown;
      try {
        fn();
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(Error);
      const msg = (erro as Error).message;
      expect(msg).toBe('falha ao decifrar');
      expect(msg).not.toContain(texto);
      expect(msg).not.toContain(MASTER);
      expect(msg).not.toContain(v);
    }

    it('chave de outra clinica', () => {
      falhaSemVazar(() => c.decifrar('cli-b', v, AAD));
    });

    it('outra chave mestra', () => {
      const outra = servico('fedcba9876543210'.repeat(4));
      falhaSemVazar(() => outra.decifrar('cli-a', v, AAD));
    });

    it.each([
      ['kid', 1, 1],
      ['iv inicio', 2, 0],
      ['iv fim', 2, 15],
      ['tag meio', 3, 5],
      ['tag ultimo char', 3, 21],
      ['ct meio', 4, 3],
      ['ct ultimo char', 4, -1],
    ])('adulterar %s', (_, parte, pos) => {
      const p = v.split('.')[parte];
      falhaSemVazar(() =>
        c.decifrar(
          'cli-a',
          adulterar(v, parte, pos < 0 ? p.length - 1 : pos),
          AAD,
        ),
      );
    });

    it('tag com base64url nao canonico (so bits de preenchimento mudam)', () => {
      // 22 chars = 132 bits para 16 bytes: os 4 bits baixos do ultimo char sao
      // descartados no decode. Trocar so eles da os MESMOS bytes: tem que lancar.
      const abc =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const partes = v.split('.');
      const tag = partes[3];
      const trocado = tag.slice(0, 21) + abc[abc.indexOf(tag[21]) ^ 1];
      expect(Buffer.from(trocado, 'base64url')).toEqual(
        Buffer.from(tag, 'base64url'),
      );
      partes[3] = trocado;
      falhaSemVazar(() => c.decifrar('cli-a', partes.join('.'), AAD));
    });

    it('caractere invalido de base64url numa parte', () => {
      const partes = v.split('.');
      partes[2] = partes[2].slice(0, 15) + '!';
      falhaSemVazar(() => c.decifrar('cli-a', partes.join('.'), AAD));
    });

    it('versao v2', () => {
      falhaSemVazar(() => c.decifrar('cli-a', v.replace(/^v1/, 'v2'), AAD));
    });

    it('kid k9', () => {
      falhaSemVazar(() => c.decifrar('cli-a', v.replace('.k1.', '.k9.'), AAD));
    });

    it('partes faltando e sobrando', () => {
      const partes = v.split('.');
      falhaSemVazar(() =>
        c.decifrar('cli-a', partes.slice(0, 4).join('.'), AAD),
      );
      falhaSemVazar(() => c.decifrar('cli-a', `${v}.AAAA`, AAD));
    });

    it('iv e tag com tamanho errado', () => {
      const partes = v.split('.');
      const ivCurto = [...partes];
      ivCurto[2] = partes[2].slice(0, 12);
      falhaSemVazar(() => c.decifrar('cli-a', ivCurto.join('.'), AAD));
      const tagCurta = [...partes];
      tagCurta[3] = partes[3].slice(0, 16);
      falhaSemVazar(() => c.decifrar('cli-a', tagCurta.join('.'), AAD));
    });

    it('string aleatoria, vazia e nao-string', () => {
      falhaSemVazar(() => c.decifrar('cli-a', 'qualquer coisa', AAD));
      falhaSemVazar(() => c.decifrar('cli-a', '', AAD));
      falhaSemVazar(() => c.decifrar('cli-a', 'v1.k1....', AAD));
      falhaSemVazar(() => c.decifrar('cli-a', null as unknown as string, AAD));
    });
  });

  describe('AAD (amarra o cifrado a tabela, coluna, linha e dono)', () => {
    const texto = 'nota da sessao';
    let c: CriptografiaService;
    let v: string;
    beforeEach(() => {
      c = servico();
      v = c.cifrar('cli-a', texto, AAD);
    });

    function falhaGenerica(fn: () => unknown) {
      expect(fn).toThrow(new Error('falha ao decifrar'));
    }

    it('roundtrip com o mesmo AAD', () => {
      expect(
        c.decifrar('cli-a', v, aadDe('Documento', 'texto', 'doc-1', 'psi-1')),
      ).toBe(texto);
    });

    it.each([
      ['outra linha', aadDe('Documento', 'texto', 'doc-2', 'psi-1')],
      ['outra coluna', aadDe('Documento', 'resumo', 'doc-1', 'psi-1')],
      ['outra tabela', aadDe('Sessao', 'texto', 'doc-1', 'psi-1')],
      ['outro psicologo', aadDe('Documento', 'texto', 'doc-1', 'psi-2')],
      ['sem psicologo', aadDe('Documento', 'texto', 'doc-1')],
    ])('AAD diferente (%s) falha com o erro generico', (_, outro) => {
      falhaGenerica(() => c.decifrar('cli-a', v, outro));
    });

    it('cifrado copiado de uma linha para outra nao decifra', () => {
      const linha1 = aadDe('Documento', 'texto', 'doc-1', 'psi-1');
      const linha2 = aadDe('Documento', 'texto', 'doc-2', 'psi-1');
      const daLinha1 = c.cifrar('cli-a', 'conteudo da linha 1', linha1);
      expect(c.decifrar('cli-a', daLinha1, linha1)).toBe('conteudo da linha 1');
      falhaGenerica(() => c.decifrar('cli-a', daLinha1, linha2));
    });

    it.each(['', undefined, null, 42])(
      'AAD vazio ou ausente (%p) lanca no cifrar e no decifrar',
      (aad) => {
        expect(() => c.cifrar('cli-a', 'x', aad as string)).toThrow(
          'aad invalido',
        );
        expect(() => c.decifrar('cli-a', v, aad as string)).toThrow(
          'aad invalido',
        );
      },
    );

    it('vetor conhecido: cifrado gerado em Python (cryptography/AESGCM) decifra', () => {
      // Chave mestra 000102..1f, clinica-teste-123 (chave HKDF do vetor abaixo),
      // iv 00..0b, AAD do GCM = 'v1.k1|' + aadDe('Documento','texto','doc-1','psi-1').
      process.env.PRAXIS_MASTER_KEY =
        '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
      const kat = new CriptografiaService();
      const valor =
        'v1.k1.AAECAwQFBgcICQoL.F--CYtC9l6-2WKv6DuiY9g.we0W9N_WQsKo';
      expect(kat.decifrar('clinica-teste-123', valor, AAD)).toBe('Sessão 1');
      falhaGenerica(() =>
        kat.decifrar(
          'clinica-teste-123',
          valor,
          aadDe('Documento', 'texto', 'doc-1', 'psi-2'),
        ),
      );
    });
  });

  describe('clinicaId', () => {
    it.each(['', null, undefined, 42])('invalido (%p) lanca', (id) => {
      const c = servico();
      const v = c.cifrar('cli-a', 'x', AAD);
      expect(() => c.cifrar(id as string, 'x', AAD)).toThrow();
      expect(() => c.decifrar(id as string, v, AAD)).toThrow();
    });
  });

  describe('chave mestra no construtor', () => {
    it.each([
      ['ausente', null],
      ['vazia', ''],
      ['63 hex', 'a'.repeat(63)],
      ['65 hex', 'a'.repeat(65)],
      ['nao-hex', 'z'.repeat(64)],
      ['com espacos', ` ${'a'.repeat(62)} `],
    ])('%s lanca sem ecoar o valor', (_, chave) => {
      let erro: Error | undefined;
      try {
        servico(chave);
      } catch (e) {
        erro = e as Error;
      }
      expect(erro?.message).toMatch(/PRAXIS_MASTER_KEY/);
      if (chave) expect(erro?.message).not.toContain(chave.trim());
      expect(erro?.message).not.toMatch(/\b6[0-9]\b/);
    });

    it.each([
      ['zeros (valor de exemplo antigo do .env.example)', '0'.repeat(64)],
      ['todos os bytes iguais (ff)', 'f'.repeat(64)],
      ['todos os bytes iguais (ab)', 'ab'.repeat(32)],
      ['todos os bytes iguais, maiusculo', 'AB'.repeat(32)],
      ['31 bytes zero e 01 no fim', `${'00'.repeat(31)}01`],
      [
        '15 bytes distintos repetidos',
        '000102030405060708090a0b0c0d0e'.repeat(2).padEnd(64, '0'),
      ],
    ])('fraca: %s lanca sem ecoar o valor', (_, chave) => {
      let erro: Error | undefined;
      try {
        servico(chave);
      } catch (e) {
        erro = e as Error;
      }
      expect(erro?.message).toMatch(/PRAXIS_MASTER_KEY/);
      expect(erro?.message).not.toContain(chave);
      expect(erro?.message).not.toContain(chave.slice(0, 8));
    });

    it.each([
      ['0123456789abcdef x4', MASTER],
      ['e2e0 x16', 'e2e0'.repeat(16)],
      ['maiusculo', MASTER.toUpperCase()],
    ])(
      'chave de teste das suites (%s) so passa com a variavel de teste',
      (_, chave) => {
        delete process.env.PRAXIS_PERMITE_SEGREDO_DE_TESTE;
        expect(() => servico(chave)).toThrow(/PRAXIS_MASTER_KEY/);
        process.env.PRAXIS_PERMITE_SEGREDO_DE_TESTE = '1';
        expect(() => servico(chave)).not.toThrow();
      },
    );

    it('aceita 64 hex minusculo e maiusculo', () => {
      expect(() => servico(MASTER)).not.toThrow();
      expect(() => servico(MASTER.toUpperCase())).not.toThrow();
      const v = servico(MASTER.toUpperCase()).cifrar('cli-a', 'x', AAD);
      expect(servico(MASTER).decifrar('cli-a', v, AAD)).toBe('x');
    });
  });
});

describe('derivarChaveClinica', () => {
  const m = Buffer.from(MASTER, 'hex');

  it('vetor conhecido (HKDF RFC 5869 feito em Python, independente)', () => {
    const master = Buffer.from(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
      'hex',
    );
    expect(
      derivarChaveClinica(master, 'clinica-teste-123').toString('hex'),
    ).toBe('8dcbbd7072d1dde66dc38a55010671169df898e0fca2f4ebc33d4ccee75279b0');
  });

  it('32 bytes, deterministica, difere por clinica e por chave mestra', () => {
    const a = derivarChaveClinica(m, 'cli-a');
    expect(a).toHaveLength(32);
    expect(derivarChaveClinica(m, 'cli-a').equals(a)).toBe(true);
    expect(derivarChaveClinica(m, 'cli-b').equals(a)).toBe(false);
    const outra = Buffer.from('fedcba9876543210'.repeat(4), 'hex');
    expect(derivarChaveClinica(outra, 'cli-a').equals(a)).toBe(false);
  });
});

describe('aadDe', () => {
  it('monta tabela|coluna|id|psicologoId (psicologoId opcional)', () => {
    expect(aadDe('Documento', 'texto', 'doc-1', 'psi-1')).toBe(
      'Documento|texto|doc-1|psi-1',
    );
    expect(aadDe('Clinica', 'nome', 'cli-1')).toBe('Clinica|nome|cli-1');
  });

  it.each([
    ['tabela vazia', ['', 'texto', 'doc-1', 'psi-1']],
    ['coluna vazia', ['Documento', '', 'doc-1', 'psi-1']],
    ['id vazio', ['Documento', 'texto', '', 'psi-1']],
    ['psicologoId vazio', ['Documento', 'texto', 'doc-1', '']],
    ['| na tabela', ['Doc|umento', 'texto', 'doc-1', 'psi-1']],
    ['| na coluna', ['Documento', 'te|xto', 'doc-1', 'psi-1']],
    ['| no id', ['Documento', 'texto', 'doc|1', 'psi-1']],
    ['| no psicologoId', ['Documento', 'texto', 'doc-1', 'psi|1']],
    ['id nao-string', ['Documento', 'texto', 42, 'psi-1']],
  ])('recusa %s', (_, partes) => {
    const [t, c, i, p] = partes as [string, string, string, string];
    expect(() => aadDe(t, c, i, p)).toThrow('aad invalido');
  });
});

describe('chaveiro com varias chaves (item 25, parte A)', () => {
  const CHAVE_A =
    '9a3f51c07e2b48d6a1f0e93c5b7d2a846c1e0f9d3b5a7c28e4f16d0b9a3c5e72';
  const CHAVE_B =
    'c4d8e2f1a7b93065d2e8f4a1c6b0973e5a1d9f3e7c2b8a46f0e5d1c9b7a3e268';
  const ENV_LISTA = ['PRAXIS_MASTER_KEYS', 'PRAXIS_MASTER_KEY_ATUAL'] as const;
  const salvo = ENV_LISTA.map((n) => process.env[n]);
  afterEach(() => {
    ENV_LISTA.forEach((n, i) => {
      const v = salvo[i];
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    });
  });

  // undefined = variavel ausente. PRAXIS_MASTER_KEY fica so se passada.
  function multi(
    lista: string | undefined,
    atual: string | undefined,
    unica?: string,
  ) {
    if (unica === undefined) delete process.env.PRAXIS_MASTER_KEY;
    else process.env.PRAXIS_MASTER_KEY = unica;
    if (lista === undefined) delete process.env.PRAXIS_MASTER_KEYS;
    else process.env.PRAXIS_MASTER_KEYS = lista;
    if (atual === undefined) delete process.env.PRAXIS_MASTER_KEY_ATUAL;
    else process.env.PRAXIS_MASTER_KEY_ATUAL = atual;
    return new CriptografiaService();
  }

  const falha = (fn: () => unknown) =>
    expect(fn).toThrow(new Error('falha ao decifrar'));

  it('so PRAXIS_MASTER_KEY (compat): vira k1, atual, cifra e decifra', () => {
    const c = multi(undefined, undefined, CHAVE_A);
    const v = c.cifrar('cli-a', 'compat', AAD);
    expect(kidDe(v)).toBe('k1');
    expect(c.decifrar('cli-a', v, AAD)).toBe('compat');
  });

  it('cifra com a ATUAL e le valores de qualquer kid da lista', () => {
    const antigo = multi(undefined, undefined, CHAVE_A).cifrar(
      'cli-a',
      'de k1',
      AAD,
    );
    const novo = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2').cifrar(
      'cli-a',
      'de k2',
      AAD,
    );
    expect(kidDe(novo)).toBe('k2');
    const c = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2');
    expect(c.decifrar('cli-a', antigo, AAD)).toBe('de k1');
    expect(c.decifrar('cli-a', novo, AAD)).toBe('de k2');
  });

  it('ATUAL voltando para k1 cifra com k1 e ainda le k2', () => {
    const novo = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2').cifrar(
      'cli-a',
      'de k2',
      AAD,
    );
    const c = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k1');
    const agora = c.cifrar('cli-a', 'x', AAD);
    expect(kidDe(agora)).toBe('k1');
    expect(c.decifrar('cli-a', novo, AAD)).toBe('de k2');
  });

  it('kid com mais de um digito funciona (k10)', () => {
    const c = multi(`k1:${CHAVE_A},k10:${CHAVE_B}`, 'k10');
    const v = c.cifrar('cli-a', 'dez', AAD);
    expect(v.startsWith('v1.k10.')).toBe(true);
    expect(c.decifrar('cli-a', v, AAD)).toBe('dez');
  });

  it('valor de kid que nao esta na lista falha generico, sem cair na atual', () => {
    const k1 = multi(undefined, undefined, CHAVE_A).cifrar('cli-a', 'x', AAD);
    falha(() => multi(`k2:${CHAVE_B}`, 'k2').decifrar('cli-a', k1, AAD));
    const k9 = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2')
      .cifrar('cli-a', 'x', AAD)
      .replace('.k2.', '.k9.');
    falha(() =>
      multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2').decifrar('cli-a', k9, AAD),
    );
  });

  it('cifrar com ATUAL k2 nao e lido por um servico so com k1', () => {
    const v = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2').cifrar(
      'cli-a',
      'x',
      AAD,
    );
    expect(v.startsWith('v1.k2.')).toBe(true);
    falha(() => multi(`k1:${CHAVE_A}`, 'k1').decifrar('cli-a', v, AAD));
  });

  it('kidDe le o kid do valor e recusa valor mal formado', () => {
    expect(kidDe('v1.k7.AAAA.AAAA.AAAA')).toBe('k7');
    falha(() => kidDe('lixo'));
    falha(() => kidDe(null));
  });

  it('ATUAL inexistente na lista = erro de boot', () => {
    expect(() => multi(`k1:${CHAVE_A}`, 'k2')).toThrow(/PRAXIS_MASTER_KEY/);
  });

  it.each([
    [
      'PRAXIS_MASTER_KEY e PRAXIS_MASTER_KEYS juntas',
      () => multi(`k1:${CHAVE_A}`, 'k1', CHAVE_B),
    ],
    ['PRAXIS_MASTER_KEYS sem ATUAL', () => multi(`k1:${CHAVE_A}`, undefined)],
    ['ATUAL sem PRAXIS_MASTER_KEYS', () => multi(undefined, 'k1', CHAVE_A)],
  ])('%s = erro de boot', (_, fn) => {
    expect(fn).toThrow(/PRAXIS_MASTER_KEY/);
  });

  it.each([
    ['chave curta', `k1:${'a'.repeat(62)}`],
    ['nao hex', `k1:${'z'.repeat(64)}`],
    ['fraca (bytes iguais)', `k1:${'ab'.repeat(32)}`],
    ['kid sem k', `x1:${CHAVE_A}`],
    ['kid maiusculo', `K1:${CHAVE_A}`],
    ['kid sem numero', `k:${CHAVE_A}`],
    ['kid repetido', `k1:${CHAVE_A},k1:${CHAVE_B}`],
    ['item sem dois-pontos', CHAVE_A],
    ['item vazio (virgula sobrando)', `k1:${CHAVE_A},`],
  ])('lista invalida (%s) lanca sem ecoar chave', (_, lista) => {
    let erro: Error | undefined;
    try {
      multi(lista, 'k1');
    } catch (e) {
      erro = e as Error;
    }
    expect(erro).toBeInstanceOf(Error);
    expect(erro?.message).toMatch(/PRAXIS_MASTER_KEYS/);
    for (const c of [CHAVE_A, CHAVE_B, 'a'.repeat(62), 'z'.repeat(64)]) {
      expect(erro?.message).not.toContain(c);
    }
  });

  it('chave de teste das suites na lista so passa com a variavel de teste', () => {
    const de_teste = '0123456789abcdef'.repeat(4);
    delete process.env.PRAXIS_PERMITE_SEGREDO_DE_TESTE;
    expect(() => multi(`k1:${de_teste}`, 'k1')).toThrow(/PRAXIS_MASTER_KEYS/);
    process.env.PRAXIS_PERMITE_SEGREDO_DE_TESTE = '1';
    expect(() => multi(`k1:${de_teste}`, 'k1')).not.toThrow();
  });

  it('recifrarValor: leva k1 para a atual k2 com o mesmo texto; valor ja atual volta igual', () => {
    const v1 = multi(undefined, undefined, CHAVE_A).cifrar(
      'cli-a',
      'texto de k1',
      AAD,
    );
    const c = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2');
    const v2 = c.recifrarValor('cli-a', v1, AAD);
    expect(kidDe(v2)).toBe('k2');
    expect(c.decifrar('cli-a', v2, AAD)).toBe('texto de k1');
    expect(c.recifrarValor('cli-a', v2, AAD)).toBe(v2);
  });

  it('recifrarValor com AAD diferente falha generico', () => {
    const v1 = multi(undefined, undefined, CHAVE_A).cifrar('cli-a', 'x', AAD);
    const c = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2');
    falha(() =>
      c.recifrarValor(
        'cli-a',
        v1,
        aadDe('Documento', 'texto', 'doc-2', 'psi-1'),
      ),
    );
  });

  it('kid desconhecido nunca cai para a chave atual (nem se o valor foi cifrado com a mesma chave)', () => {
    // Um servico com k3 = o MESMO material de k2 cifra com o cabecalho k3. Outro servico sem k3
    // e com k2 atual teria a chave certa em maos: so o kid desconhecido o impede de decifrar.
    const v = multi(`k1:${CHAVE_A},k3:${CHAVE_B}`, 'k3').cifrar(
      'cli-a',
      'x',
      AAD,
    );
    expect(kidDe(v)).toBe('k3');
    const c = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2');
    falha(() => c.decifrar('cli-a', v, AAD));
    falha(() => c.recifrarValor('cli-a', v, AAD));
  });

  it('recifrarValor de kid desconhecido falha generico', () => {
    const v = multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2')
      .cifrar('cli-a', 'x', AAD)
      .replace('.k2.', '.k9.');
    falha(() =>
      multi(`k1:${CHAVE_A},k2:${CHAVE_B}`, 'k2').recifrarValor('cli-a', v, AAD),
    );
  });
});
