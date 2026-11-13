import {
  corteDescarte,
  descarteEm,
  RETENCAO_PADRAO_DIAS,
  retencaoRascunhoDias,
} from './retencao';

describe('retencaoRascunhoDias (PRAXIS_RETENCAO_RASCUNHO_DIAS)', () => {
  it('sem a variavel = padrao de 7 dias', () => {
    expect(retencaoRascunhoDias({})).toBe(RETENCAO_PADRAO_DIAS);
    expect(RETENCAO_PADRAO_DIAS).toBe(7);
  });

  it('aceita inteiro >= 1 (inclusive 1 e o teto)', () => {
    expect(retencaoRascunhoDias({ PRAXIS_RETENCAO_RASCUNHO_DIAS: '1' })).toBe(
      1,
    );
    expect(retencaoRascunhoDias({ PRAXIS_RETENCAO_RASCUNHO_DIAS: '30' })).toBe(
      30,
    );
    expect(
      retencaoRascunhoDias({ PRAXIS_RETENCAO_RASCUNHO_DIAS: '36500' }),
    ).toBe(36500);
  });

  it.each([
    ['0'],
    ['-1'],
    ['1.5'],
    ['abc'],
    [''],
    [' 7'],
    ['07'],
    ['36501'],
    ['1e3'],
    ['9999999999999999999999'],
  ])('rejeita %p com mensagem fixa (sem ecoar o valor)', (valor) => {
    let erro: unknown;
    try {
      retencaoRascunhoDias({ PRAXIS_RETENCAO_RASCUNHO_DIAS: valor });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(Error);
    // Mensagem fixa: nunca ecoa o valor digitado.
    expect((erro as Error).message).toBe(
      'PRAXIS_RETENCAO_RASCUNHO_DIAS: informe um inteiro de 1 a 36500',
    );
  });
});

describe('descarteEm', () => {
  it('atualizadoEm + prazo em dias (ms exatos)', () => {
    const atualizado = new Date('2026-11-01T10:00:00.000Z');
    expect(descarteEm(atualizado, 7)).toEqual(
      new Date('2026-11-08T10:00:00.000Z'),
    );
    expect(descarteEm(atualizado, 1)).toEqual(
      new Date('2026-11-02T10:00:00.000Z'),
    );
  });

  it('sem prazo explicito usa o do env', () => {
    const atualizado = new Date('2026-11-01T10:00:00.000Z');
    const antes = process.env.PRAXIS_RETENCAO_RASCUNHO_DIAS;
    process.env.PRAXIS_RETENCAO_RASCUNHO_DIAS = '3';
    try {
      expect(descarteEm(atualizado)).toEqual(
        new Date('2026-11-04T10:00:00.000Z'),
      );
    } finally {
      if (antes === undefined) delete process.env.PRAXIS_RETENCAO_RASCUNHO_DIAS;
      else process.env.PRAXIS_RETENCAO_RASCUNHO_DIAS = antes;
    }
  });
});

describe('corteDescarte', () => {
  it('agora - dias: vencido = atualizadoEm anterior ao corte', () => {
    const agora = new Date('2026-11-11T12:00:00.000Z');
    expect(corteDescarte(agora, 7)).toEqual(
      new Date('2026-11-04T12:00:00.000Z'),
    );
    const atualizado = new Date('2026-11-04T11:59:59.999Z');
    expect(atualizado < corteDescarte(agora, 7)).toBe(true);
    // Exatamente no corte ainda NAO e vencido (descarteEm == agora).
    expect(descarteEm(new Date('2026-11-04T12:00:00.000Z'), 7)).toEqual(agora);
  });
});
