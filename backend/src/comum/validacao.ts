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
