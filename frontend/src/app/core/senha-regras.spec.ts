import { regrasSenha } from './senha-regras';

const ctx = { email: 'maria.souza@clinica.com', nome: 'Maria Souza' };
const estado = (senha: string, c = ctx) =>
  Object.fromEntries(regrasSenha(senha, c).map((r) => [r.id, r.ok])) as Record<
    'tamanho' | 'padrao' | 'pessoal',
    boolean
  >;

describe('regrasSenha', () => {
  it('senha vazia: nenhuma regra atendida (a dica mostra neutro)', () => {
    expect(estado('')).toEqual({ tamanho: false, padrao: false, pessoal: false });
  });

  it('forte atende as tres regras', () => {
    expect(estado('tijolo-azul-lua-4821')).toEqual({ tamanho: true, padrao: true, pessoal: true });
  });

  it('tamanho conta CARACTERES (emoji conta 1), minimo 10', () => {
    expect(estado('Xq7!vB2mK').tamanho).toBeFalse(); // 9
    expect(estado('Xq7!vB2mKz').tamanho).toBeTrue(); // 10
    expect(estado('🙂'.repeat(10)).tamanho).toBeTrue();
    expect(estado('🙂'.repeat(9)).tamanho).toBeFalse();
  });

  it('repeticao e sequencia falham', () => {
    for (const s of ['aaaaaaaaaa', '1212121212', 'abcabcabcabc', '1234567890', 'ABCDEFGHIJ']) {
      expect(estado(s).padrao).withContext(s).toBeFalse();
    }
    for (const s of ['qwertyuiop', 'jihgfedcba', '0987654321']) {
      expect(estado(s).padrao).withContext(s).toBeFalse();
    }
  });

  it('com menos de 4 caracteres digitar "a" ainda nao e repeticao', () => {
    expect(estado('a').padrao).toBeTrue();
    expect(estado('aaaa').padrao).toBeFalse();
  });

  it('contem a parte local do e-mail ou palavra do nome (3+ letras), sem caixa nem acento', () => {
    expect(estado('x-MARIA.SOUZA-9').pessoal).toBeFalse();
    expect(estado('x-souza-9Zk').pessoal).toBeFalse();
    expect(estado('Mária#8472Kz').pessoal).toBeFalse();
    expect(estado('tijolo-azul-lua').pessoal).toBeTrue();
  });

  it('palavras do nome com menos de 3 letras e particulas nao contam', () => {
    const c = { email: 'zz@x.com', nome: 'Li das Neves' };
    expect(estado('Kd#das-8472Qz', c).pessoal).toBeTrue();
    expect(estado('Kdli#8472Qzw', c).pessoal).toBeTrue();
    expect(estado('Kdneves#8472Q', c).pessoal).toBeFalse();
  });

  it('sem e-mail nem nome nao quebra', () => {
    expect(estado('Xq7!vB2mKz', { email: '', nome: '' })).toEqual({
      tamanho: true,
      padrao: true,
      pessoal: true,
    });
  });
});
