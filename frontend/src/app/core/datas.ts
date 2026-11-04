const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Timestamp ISO -> 'DD/MM/AAAA, HH:mm' no fuso do navegador (para dia puro use dataBr).
export const dataHoraBr = (iso: string): string => DATA_HORA.format(new Date(iso));
