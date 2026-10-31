import {
  aadDe,
  CriptografiaService,
  derivarChaveClinica,
} from './criptografia.service';

const MASTER = '0123456789abcdef'.repeat(4);
// AAD canonico de uma linha qualquer (tabela|coluna|id|psicologoId).
const AAD = aadDe('Documento', 'texto', 'doc-1', 'psi-1');
const FORMATO = /^v1\.k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]*$/;

// null = variavel ausente.
function servico(chave: string | null = MASTER) {
  if (chave === null) delete process.env.NOTTA_MASTER_KEY;
  else process.env.NOTTA_MASTER_KEY = chave;
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
  const original = process.env.NOTTA_MASTER_KEY;
  const permite = process.env.NOTTA_PERMITE_SEGREDO_DE_TESTE;
  afterEach(() => {
    if (original === undefined) delete process.env.NOTTA_MASTER_KEY;
    else process.env.NOTTA_MASTER_KEY = original;
    if (permite === undefined)
      delete process.env.NOTTA_PERMITE_SEGREDO_DE_TESTE;
    else process.env.NOTTA_PERMITE_SEGREDO_DE_TESTE = permite;
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
      process.env.NOTTA_MASTER_KEY =
        '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
      const kat = new CriptografiaService();
      const valor =
        'v1.k1.AAECAwQFBgcICQoL.UtRQmYiumFT16wf5vg42lg.Ix22cjLVbmN5';
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
      expect(erro?.message).toMatch(/NOTTA_MASTER_KEY/);
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
      expect(erro?.message).toMatch(/NOTTA_MASTER_KEY/);
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
        delete process.env.NOTTA_PERMITE_SEGREDO_DE_TESTE;
        expect(() => servico(chave)).toThrow(/NOTTA_MASTER_KEY/);
        process.env.NOTTA_PERMITE_SEGREDO_DE_TESTE = '1';
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
    ).toBe('2b5c2aaf86d96fe2dcef3c208bb3a1d2dd858abfc5bd283493a960ea31c69370');
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
