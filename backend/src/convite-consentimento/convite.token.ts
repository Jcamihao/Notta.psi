import { createHash, randomBytes } from 'node:crypto';
import { NotFoundException, type PipeTransform } from '@nestjs/common';

// Token do link: 32 bytes aleatorios em base64url (43 caracteres). Mostrado UMA vez ao psicologo;
// no banco fica so o SHA-256 em hex (a coluna recusa qualquer outra coisa).
export const gerarToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// Mesmo corpo do 404 de token desconhecido, expirado, cancelado ou usado: sem oraculo.
export const LINK_INVALIDO = 'Link invalido ou expirado';

// Formato errado = o MESMO 404 (nem chega a calcular hash nem a tocar o banco).
export class TokenPipe implements PipeTransform<string, string> {
  transform(valor: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(valor)) {
      throw new NotFoundException(LINK_INVALIDO);
    }
    return valor;
  }
}
