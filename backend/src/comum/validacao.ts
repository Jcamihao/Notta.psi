import { Transform } from 'class-transformer';
import { ValidateBy } from 'class-validator';

// E-mail unico global: sempre comparado/salvo assim (cadastro, login e chave do limite).
export function normalizarEmail(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim().toLowerCase() : '';
}

export const Aparar = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

// Tamanho em BYTES UTF-8 (o bcrypt so usa os primeiros 72 bytes, nao 72 caracteres).
export const Bytes = (min: number, max: number) =>
  ValidateBy({
    name: 'bytes',
    validator: {
      validate: (v: unknown) => {
        if (typeof v !== 'string') return false;
        const n = Buffer.byteLength(v, 'utf8');
        return n >= min && n <= max;
      },
      defaultMessage: (a) => `${a?.property} deve ter de ${min} a ${max} bytes`,
    },
  });

// 'YYYY-MM-DD' que e data real (2026-02-30 nao passa), >= 1900-01-01 e nao futura.
// "Hoje" em UTC: o Brasil esta atras do UTC, entao nunca recusa data de nascimento valida.
export function dataValida(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    return false;
  }
  return v >= '1900-01-01' && v <= new Date().toISOString().slice(0, 10);
}
