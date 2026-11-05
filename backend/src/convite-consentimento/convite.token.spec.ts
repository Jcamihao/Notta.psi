import { NotFoundException } from '@nestjs/common';
import {
  gerarToken,
  hashToken,
  LINK_INVALIDO,
  TokenPipe,
} from './convite.token';

describe('token do convite', () => {
  it('gera 32 bytes aleatorios em base64url (43 caracteres), sem repetir', () => {
    const a = gerarToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(Array.from({ length: 50 }, gerarToken)).size).toBe(50);
  });

  it('hash e SHA-256 em hex (64 caracteres), deterministico, e nao contem o token', () => {
    const t = gerarToken();
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(h);
    expect(h).not.toContain(t);
    expect(hashToken('x')).toBe(
      '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881',
    );
  });

  it.each([
    '',
    'curto',
    'a'.repeat(42),
    'a'.repeat(44),
    `${'a'.repeat(42)}=`,
    `${'a'.repeat(42)}/`,
    `${'a'.repeat(42)} `,
  ])('TokenPipe recusa %j com o 404 generico', (v) => {
    expect.assertions(2);
    try {
      new TokenPipe().transform(v);
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundException);
      expect((e as NotFoundException).message).toBe(LINK_INVALIDO);
    }
  });

  it('TokenPipe aceita um token gerado', () => {
    const t = gerarToken();
    expect(new TokenPipe().transform(t)).toBe(t);
  });
});
