import { UnprocessableEntityException } from '@nestjs/common';
import { avaliarSenha, exigirSenhaForte } from './politica-senha';

const pessoa = { email: 'maria.souza@clinica.com.br', nome: 'Maria Souza' };
const motivo = (senha: string, p = pessoa) => avaliarSenha(senha, p);

describe('avaliarSenha: tamanho', () => {
  it('menos de 10 caracteres = CURTA', () => {
    expect(motivo('Xq7!vB2mK')).toBe('CURTA'); // 9
    expect(motivo('')).toBe('CURTA');
  });

  it('10 caracteres exatos de senha forte passa', () => {
    expect(motivo('Xq7!vB2mKz')).toBeNull();
  });

  it('conta CARACTERES, nao bytes (10 acentuados passam, mesmo com 20 bytes)', () => {
    const dez = 'çãõéíóúâêô';
    expect(Array.from(dez)).toHaveLength(10);
    expect(Buffer.byteLength(dez)).toBeGreaterThan(10);
    expect(motivo(dez)).toBeNull();
    expect(motivo('çãõéíóúâê')).toBe('CURTA'); // 9 caracteres
  });

  it('72 bytes exatos passam (o maximo do bcrypt e problema do DTO)', () => {
    const s = 'Xq7!vB2m'.repeat(9);
    expect(Buffer.byteLength(s)).toBe(72);
    expect(motivo(s)).toBeNull();
  });
});

describe('avaliarSenha: lista de comuns', () => {
  it.each([
    'password123',
    'Password!!!',
    'qwerty1234',
    'iloveyou99',
    'senha12345',
  ])('%s = COMUM', (s) => {
    expect(motivo(s)).toBe('COMUM');
  });

  it('ignora caixa', () => {
    expect(motivo('SENHAFORTE12')).toBe('COMUM');
    expect(motivo('FlAmEnGo2020')).toBe('COMUM');
  });

  it('leetspeak simples: @ 0 1 3 $ 5', () => {
    expect(motivo('P@ssw0rd!!!')).toBe('COMUM'); // password
    expect(motivo('Fl@meng0123')).toBe('COMUM'); // flamengo
    expect(motivo('$enha12345!')).toBe('COMUM'); // senha
  });

  it('1 vale i e l', () => {
    expect(motivo('1loveyou1!')).toBe('COMUM'); // iloveyou
    expect(motivo('b1ackcat12')).toBe('COMUM'); // blackcat
  });

  it('remove digitos e simbolos do FIM antes de comparar: Senha1234! cai', () => {
    expect(motivo('Senha1234!')).toBe('COMUM');
    expect(motivo('Flamengo@@@@2026')).toBe('COMUM');
    expect(motivo('dragon......')).toBe('COMUM');
  });

  it('ignora acento (a lista e ASCII)', () => {
    expect(motivo('Gloria123456')).toBe('COMUM');
    expect(motivo('Glória123456')).toBe('COMUM');
  });

  it('senha forte e longa que so comeca com palavra comum nao cai', () => {
    expect(motivo('flamengo-cadeira-tijolo-9')).toBeNull();
  });
});

describe('avaliarSenha: pessoal', () => {
  it('igual ao e-mail', () => {
    const p = { email: 'qualquercoisa@x.com', nome: 'Zeca' };
    expect(avaliarSenha('QualquerCoisa@X.com', p)).toBe('PESSOAL');
  });

  it('contem a parte local do e-mail', () => {
    expect(motivo('xx-maria.souza-9Z!')).toBe('PESSOAL');
    expect(motivo('MARIA.SOUZA#2026')).toBe('PESSOAL');
  });

  it('contem uma palavra do nome com 3+ letras, em qualquer caixa e acento', () => {
    const p = { email: 'fulano@x.com', nome: 'João Álvaro da Silva' };
    expect(avaliarSenha('minhaSILVA#8472', p)).toBe('PESSOAL');
    expect(avaliarSenha('alvaro#8472Kz', p)).toBe('PESSOAL');
    expect(avaliarSenha('Joao#8472Kzxx', p)).toBe('PESSOAL');
  });

  it('contem o nome com leetspeak', () => {
    const p = { email: 'fulano@x.com', nome: 'Joao Pedro' };
    expect(avaliarSenha('J0ao#8472Kzxx', p)).toBe('PESSOAL');
  });

  it('palavra do nome com menos de 3 letras e particula nao contam', () => {
    const p = { email: 'zz@x.com', nome: 'Li das Neves' };
    expect(avaliarSenha('Kd#das-8472Qz', p)).toBeNull(); // "das" e particula
    expect(avaliarSenha('Kdli#8472Qzw', p)).toBeNull(); // "li" tem 2 letras
    expect(avaliarSenha('Kdneves#8472Q', p)).toBe('PESSOAL');
  });

  it('sem e-mail nem nome (contexto vazio) nao quebra', () => {
    expect(avaliarSenha('Xq7!vB2mKz', {})).toBeNull();
  });
});

describe('avaliarSenha: repetida e sequencia', () => {
  it.each([
    'aaaaaaaaaa',
    '1111111111',
    'zzzzzzzzzzzzzzzz',
    '1212121212',
    'abcabcabcabc',
    '1234567890',
    '0987654321',
    'abcdefghij',
    'jihgfedcba',
    'qwertyuiop',
    'poiuytrewq',
    'asdfghjklzxcvbnm',
    'ABCDEFGHIJKL',
  ])('%s = REPETIDA', (s) => {
    expect(motivo(s)).toBe('REPETIDA');
  });

  it('sequencia com um pedaco diferente nao e REPETIDA', () => {
    expect(motivo('1234567890x!Kz')).not.toBe('REPETIDA');
  });
});

describe('avaliarSenha: aceita fortes', () => {
  it.each([
    'Xq7!vB2mKz',
    'cavalo-bateria-grampo-lua',
    'correct horse battery staple',
    'T4rt4rug@-Azul#77',
    'uma frase longa e boba 2026',
  ])('%s passa', (s) => {
    expect(motivo(s)).toBeNull();
  });
});

describe('exigirSenhaForte', () => {
  it('forte nao lanca', () => {
    expect(() => exigirSenhaForte('Xq7!vB2mKz', pessoa)).not.toThrow();
  });

  it.each([
    ['Xq7!vB2m', 'CURTA', 'Senha fraca: use pelo menos 10 caracteres'],
    ['Senha1234!', 'COMUM', 'Senha fraca: esta senha e muito comum'],
    [
      'maria.souza#2026Kz',
      'PESSOAL',
      'Senha fraca: nao use seu nome nem seu e-mail na senha',
    ],
    [
      'aaaaaaaaaaaa',
      'REPETIDA',
      'Senha fraca: evite repeticoes e sequencias como 1234567890',
    ],
  ])('%s = 422 com motivo %s', (senha, mot, mensagem) => {
    let erro: unknown;
    try {
      exigirSenhaForte(senha, pessoa);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(UnprocessableEntityException);
    const corpo = (erro as UnprocessableEntityException).getResponse();
    expect(corpo).toEqual({ statusCode: 422, message: mensagem, motivo: mot });
  });

  it('o corpo do erro nunca traz a senha nem trecho dela', () => {
    try {
      exigirSenhaForte('Senha1234!', pessoa);
    } catch (e) {
      const texto = JSON.stringify(
        (e as UnprocessableEntityException).getResponse(),
      );
      expect(texto.toLowerCase()).not.toContain('senha1234');
    }
  });

  it('nunca escreve em log', () => {
    const espioes = (['log', 'error', 'warn', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      exigirSenhaForte('Xq7!vB2mKz', pessoa);
      expect(() => exigirSenhaForte('Senha1234!', pessoa)).toThrow();
      for (const e of espioes) expect(e).not.toHaveBeenCalled();
    } finally {
      for (const e of espioes) e.mockRestore();
    }
  });
});
