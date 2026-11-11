import { InjectionToken } from '@angular/core';

// Relogio injetavel: as telas pegam o "agora" por aqui (os testes fixam a data).
export const AGORA = new InjectionToken<() => Date>('agora', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

const MS_DIA = 24 * 60 * 60 * 1000;

// Dias inteiros ate o descarte, arredondados para cima. Null sem prazo ou com data invalida.
export function diasAteDescarte(descarteEm: string | null, agora: Date): number | null {
  if (!descarteEm) return null;
  const alvo = Date.parse(descarteEm);
  if (Number.isNaN(alvo)) return null;
  return Math.ceil((alvo - agora.getTime()) / MS_DIA);
}

// Frase de aviso para o rascunho. Null quando nao ha prazo. Nunca cita o numero do prazo.
export function textoDescarte(descarteEm: string | null, agora: Date): string | null {
  const dias = diasAteDescarte(descarteEm, agora);
  if (dias === null) return null;
  if (dias <= 0) {
    return 'O prazo acabou. Será apagado na próxima limpeza. Edite ou aprove para guardar.';
  }
  if (dias === 1) return 'Será apagado amanhã se não for editado.';
  return `Será apagado em ${dias} dias se não for editado.`;
}

// Destaque visual (junto com o texto, nunca so a cor): faltam 2 dias ou menos, ou ja venceu.
export function descarteUrgente(descarteEm: string | null, agora: Date): boolean {
  const dias = diasAteDescarte(descarteEm, agora);
  return dias !== null && dias <= 2;
}
