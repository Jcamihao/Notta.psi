import { inicioDoDia, proximaMeiaNoite } from './dia-sp';

describe('dia em America/Sao_Paulo (limite diario)', () => {
  it.each([
    // [instante UTC, inicio do dia (UTC), proxima meia-noite (UTC)]
    ['2026-11-04T15:30:00Z', '2026-11-04T03:00:00Z', '2026-11-05T03:00:00Z'],
    // 01:00 UTC ainda e o dia anterior em Sao Paulo (22:00 do dia 3)
    ['2026-11-04T01:00:00Z', '2026-11-03T03:00:00Z', '2026-11-04T03:00:00Z'],
    // exatamente a meia-noite local ja e o dia novo
    ['2026-11-04T03:00:00Z', '2026-11-04T03:00:00Z', '2026-11-05T03:00:00Z'],
    // 1 ms antes da meia-noite local ainda e o dia velho
    [
      '2026-11-04T02:59:59.999Z',
      '2026-11-03T03:00:00Z',
      '2026-11-04T03:00:00Z',
    ],
    // virada de mes e de ano
    ['2026-12-31T23:00:00Z', '2026-12-31T03:00:00Z', '2027-01-01T03:00:00Z'],
  ])('%s', (agora, inicio, proxima) => {
    expect(inicioDoDia(new Date(agora)).toISOString()).toBe(
      new Date(inicio).toISOString(),
    );
    expect(proximaMeiaNoite(new Date(agora)).toISOString()).toBe(
      new Date(proxima).toISOString(),
    );
  });

  it('o dia tem 24 h', () => {
    const agora = new Date('2026-06-15T12:00:00Z');
    expect(
      proximaMeiaNoite(agora).getTime() - inicioDoDia(agora).getTime(),
    ).toBe(86_400_000);
  });
});
