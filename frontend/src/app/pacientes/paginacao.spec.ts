import { OPCOES_POR_PAGINA, paginar, POR_PAGINA_PADRAO } from './paginacao';

const lista = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('paginacao: constantes', () => {
  it('opcoes 10, 20 e 30; padrao 20', () => {
    expect([...OPCOES_POR_PAGINA]).toEqual([10, 20, 30]);
    expect(POR_PAGINA_PADRAO).toBe(20);
  });
});

describe('paginar', () => {
  it('lista vazia: uma pagina, zero itens, de e ate zerados', () => {
    expect(paginar([], 1, 20)).toEqual({
      itens: [],
      pagina: 1,
      totalPaginas: 1,
      de: 0,
      ate: 0,
      total: 0,
    });
  });

  it('um item: uma pagina, de 1 a 1', () => {
    const r = paginar(['a'], 1, 10);
    expect(r).toEqual({ itens: ['a'], pagina: 1, totalPaginas: 1, de: 1, ate: 1, total: 1 });
  });

  const casos: [number, number, number][] = [
    [10, 10, 1],
    [11, 10, 2],
    [20, 20, 1],
    [21, 20, 2],
    [30, 30, 1],
    [31, 30, 2],
  ];
  for (const [n, por, paginas] of casos) {
    it(`${n} itens com ${por} por pagina: ${paginas} pagina(s)`, () => {
      const p1 = paginar(lista(n), 1, por);
      expect(p1.totalPaginas).toBe(paginas);
      expect(p1.itens.length).toBe(Math.min(n, por));
      expect(p1.itens[0]).toBe(1);
      expect(p1.ate).toBe(Math.min(n, por));
      if (paginas >= 2) {
        const p2 = paginar(lista(n), 2, por);
        expect(p2.itens[0]).toBe(por + 1);
        expect(p2.de).toBe(por + 1);
        expect(p2.ate).toBe(Math.min(2 * por, n));
      }
    });
  }

  it('500 itens com cada tamanho: paginas e ultima pagina', () => {
    expect(paginar(lista(500), 1, 10).totalPaginas).toBe(50);
    expect(paginar(lista(500), 1, 20).totalPaginas).toBe(25);
    expect(paginar(lista(500), 1, 30).totalPaginas).toBe(17);
    const ultima = paginar(lista(500), 17, 30);
    expect(ultima.itens.length).toBe(20);
    expect(ultima.de).toBe(481);
    expect(ultima.ate).toBe(500);
    expect(ultima.total).toBe(500);
    expect(paginar(lista(500), 25, 20).itens[19]).toBe(500);
  });

  it('ultima pagina incompleta: de e ate corretos (45 com 20 => 41 a 45)', () => {
    const r = paginar(lista(45), 3, 20);
    expect(r.itens).toEqual([41, 42, 43, 44, 45]);
    expect(r).toEqual(
      jasmine.objectContaining({ pagina: 3, totalPaginas: 3, de: 41, ate: 45, total: 45 }),
    );
  });

  it('pagina menor que 1 vira 1', () => {
    expect(paginar(lista(45), 0, 20).pagina).toBe(1);
    expect(paginar(lista(45), -3, 20).pagina).toBe(1);
    expect(paginar(lista(45), -Infinity, 20).pagina).toBe(1);
  });

  it('pagina maior que o total vira a ultima', () => {
    const r = paginar(lista(45), 99, 20);
    expect(r.pagina).toBe(3);
    expect(r.itens).toEqual([41, 42, 43, 44, 45]);
    expect(paginar(lista(45), Infinity, 20).pagina).toBe(3);
  });

  it('pagina NaN vira 1', () => {
    expect(paginar(lista(45), NaN, 20).pagina).toBe(1);
  });

  it('pagina fracionaria cai na pagina inteira de baixo (2,7 vira 2)', () => {
    expect(paginar(lista(45), 2.7, 20).pagina).toBe(2);
  });

  it('pagina corrigida em lista vazia e sempre 1', () => {
    expect(paginar([], 5, 10).pagina).toBe(1);
  });

  for (const invalido of [0, 5, 15, 25, 40, NaN, -10]) {
    it(`porPagina ${invalido} invalido cai em 20`, () => {
      const r = paginar(lista(45), 1, invalido);
      expect(r.itens.length).toBe(20);
      expect(r.totalPaginas).toBe(3);
    });
  }

  it('nao muta a lista de entrada', () => {
    const entrada = lista(45);
    const copia = [...entrada];
    paginar(entrada, 2, 10);
    expect(entrada).toEqual(copia);
  });

  it('devolve um array novo (mexer no resultado nao mexe na entrada)', () => {
    const entrada = lista(5);
    paginar(entrada, 1, 10).itens.pop();
    expect(entrada.length).toBe(5);
  });
});
