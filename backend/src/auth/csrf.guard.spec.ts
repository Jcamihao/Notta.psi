import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard, OrigemApenas } from './csrf.guard';
import { Publico } from './jwt-auth.guard';

const ORIGEM = 'https://app.ex.com';
const CSRF = 'A'.repeat(43);
const OUTRO = 'B'.repeat(43);
const guard = new CsrfGuard(new Reflector(), [ORIGEM]);

const rotaComum = () => {};
const rotaPublica = () => {};
Publico()(rotaPublica);
const rotaOrigem = () => {};
Publico()(rotaOrigem);
OrigemApenas()(rotaOrigem);
class Classe {}

function ctx(
  method: string,
  headers: Record<string, string | string[]>,
  handler: () => void = rotaComum,
) {
  return {
    getHandler: () => handler,
    getClass: () => Classe,
    switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
  } as unknown as ExecutionContext;
}
const cookies = `praxis_acesso=jwt; praxis_csrf=${CSRF}`;
const certo = {
  cookie: cookies,
  origin: ORIGEM,
  'x-csrf-token': CSRF,
};
const recusa = (c: ExecutionContext) => {
  try {
    guard.canActivate(c);
  } catch (e) {
    return e;
  }
  return null;
};

describe('CsrfGuard (item 46)', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('%s nunca e checado', (m) => {
    expect(guard.canActivate(ctx(m, { cookie: cookies }))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s por cookie com Origin e header certos passa',
    (m) => {
      expect(guard.canActivate(ctx(m, certo))).toBe(true);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s por cookie sem header = 403 (corpo fixo)',
    (m) => {
      const e = recusa(ctx(m, { cookie: cookies, origin: ORIGEM }));
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        message: 'Requisicao recusada',
        error: 'Forbidden',
      });
    },
  );

  it.each([
    ['header diferente do cookie', { ...certo, 'x-csrf-token': OUTRO }],
    ['header com formato errado', { ...certo, 'x-csrf-token': 'curto' }],
    ['cookie csrf ausente', { ...certo, cookie: 'praxis_acesso=jwt' }],
    [
      'cookie csrf com formato errado',
      {
        ...certo,
        cookie: 'praxis_acesso=jwt; praxis_csrf=curto',
        'x-csrf-token': 'curto',
      },
    ],
    ['Origin de outro site', { ...certo, origin: 'https://atacante.com' }],
    ['Origin "null"', { ...certo, origin: 'null' }],
    ['sem Origin nem Referer', { cookie: cookies, 'x-csrf-token': CSRF }],
    [
      'Referer de outro site',
      {
        cookie: cookies,
        'x-csrf-token': CSRF,
        referer: 'https://atacante.com/x',
      },
    ],
    [
      'Referer invalido',
      { cookie: cookies, 'x-csrf-token': CSRF, referer: 'lixo' },
    ],
    ['header repetido (array)', { ...certo, 'x-csrf-token': [CSRF, CSRF] }],
  ])('%s = 403', (_n, headers) => {
    expect(recusa(ctx('POST', headers))).toBeInstanceOf(ForbiddenException);
  });

  it('Referer da origem certa vale quando nao ha Origin', () => {
    expect(
      guard.canActivate(
        ctx('POST', {
          cookie: cookies,
          'x-csrf-token': CSRF,
          referer: `${ORIGEM}/pagina?x=1`,
        }),
      ),
    ).toBe(true);
  });

  it('Authorization presente (Bearer): fora do CSRF', () => {
    expect(guard.canActivate(ctx('POST', { authorization: 'Bearer x' }))).toBe(
      true,
    );
    expect(
      guard.canActivate(
        ctx('POST', { authorization: 'Bearer x', cookie: cookies }),
      ),
    ).toBe(true);
  });

  it('sem cookie de acesso: fora (o JwtAuthGuard responde 401)', () => {
    expect(guard.canActivate(ctx('POST', {}))).toBe(true);
    expect(guard.canActivate(ctx('POST', { cookie: 'outro=1' }))).toBe(true);
  });

  it('@Publico(): fora, mesmo com cookie', () => {
    expect(
      guard.canActivate(ctx('POST', { cookie: cookies }, rotaPublica)),
    ).toBe(true);
  });

  it('@OrigemApenas(): exige Origin, nao exige CSRF, vale com ou sem cookie e com Bearer', () => {
    expect(guard.canActivate(ctx('POST', { origin: ORIGEM }, rotaOrigem))).toBe(
      true,
    );
    expect(
      guard.canActivate(
        ctx('POST', { origin: ORIGEM, cookie: cookies }, rotaOrigem),
      ),
    ).toBe(true);
    expect(recusa(ctx('POST', {}, rotaOrigem))).toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      recusa(ctx('POST', { origin: 'https://atacante.com' }, rotaOrigem)),
    ).toBeInstanceOf(ForbiddenException);
    expect(
      recusa(ctx('POST', { authorization: 'Bearer x' }, rotaOrigem)),
    ).toBeInstanceOf(ForbiddenException);
  });
});
