// Dia corrente em America/Sao_Paulo, para o limite diario (item 19). O Brasil nao tem horario de
// verao desde 2019; ainda assim o deslocamento e lido do fuso (Intl) na hora, nao fixado em -03:00.
const FUSO = 'America/Sao_Paulo';

const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// Relogio de parede do fuso para o instante `d`, escrito como se fosse UTC.
function parede(d: Date) {
  const p = Object.fromEntries(
    formato.formatToParts(d).map((x) => [x.type, Number(x.value)]),
  );
  return {
    ano: p.year,
    mes: p.month,
    dia: p.day,
    deslocamentoMs:
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
      Math.floor(d.getTime() / 1000) * 1000,
  };
}

// Instante da ultima meia-noite do fuso (inicio do dia corrente).
export function inicioDoDia(agora: Date): Date {
  const { ano, mes, dia, deslocamentoMs } = parede(agora);
  return new Date(Date.UTC(ano, mes - 1, dia) - deslocamentoMs);
}

// Instante da proxima meia-noite do fuso (quando o limite renova).
export function proximaMeiaNoite(agora: Date): Date {
  const { ano, mes, dia, deslocamentoMs } = parede(agora);
  return new Date(Date.UTC(ano, mes - 1, dia + 1) - deslocamentoMs);
}
