import type { Request, Response } from 'express';
import { relogio } from '../comum/relogio';
import {
  definirAcesso,
  definirCookies,
  lerCookie,
  limparCookies,
  novoToken,
  prefixoApi,
} from './cookies';

type Chamada = {
  nome: string;
  valor?: string;
  opcoes: Record<string, unknown>;
};

function resFalsa() {
  const chamadas: Chamada[] = [];
  const res = {
    cookie: (nome: string, valor: string, opcoes: Record<string, unknown>) =>
      chamadas.push({ nome, valor, opcoes }),
    clearCookie: (nome: string, opcoes: Record<string, unknown>) =>
      chamadas.push({ nome, opcoes }),
  } as unknown as Response;
  return { res, chamadas };
}
const reqFalsa = (secure: boolean) => ({ secure }) as Request;

describe('lerCookie', () => {
  it('acha pelo nome exato, ignora espacos, decodifica e pega o primeiro repetido', () => {
    expect(lerCookie('a=1; praxis_acesso=x%20y; b=2', 'praxis_acesso')).toBe(
      'x y',
    );
    expect(
      lerCookie('praxis_acesso=um; praxis_acesso=dois', 'praxis_acesso'),
    ).toBe('um');
    expect(lerCookie('xpraxis_acesso=1', 'praxis_acesso')).toBeUndefined();
    expect(lerCookie('praxis_acesso=', 'praxis_acesso')).toBeUndefined();
    expect(
      lerCookie('praxis_acesso=%E0%A4%A', 'praxis_acesso'),
    ).toBeUndefined();
    expect(lerCookie(undefined, 'praxis_acesso')).toBeUndefined();
  });
});

describe('prefixoApi', () => {
  const env = (v?: string) =>
    (v === undefined ? {} : { PRAXIS_API_PREFIXO: v }) as NodeJS.ProcessEnv;
  it('padrao /api; vazio = raiz; caminho valido passa', () => {
    expect(prefixoApi(env())).toBe('/api');
    expect(prefixoApi(env(''))).toBe('');
    expect(prefixoApi(env('/v1/api'))).toBe('/v1/api');
  });
  it.each(['api', '/api/', '/a b', '//', '/a;b', 'http://x'])(
    'invalido %j derruba',
    (v) => {
      expect(() => prefixoApi(env(v))).toThrow(/PRAXIS_API_PREFIXO/);
    },
  );
});

describe('definirCookies', () => {
  const absolutaAte = new Date('2026-11-15T12:00:00.000Z');
  beforeEach(() =>
    jest
      .spyOn(relogio, 'agora')
      .mockReturnValue(new Date('2026-11-08T12:00:00.000Z')),
  );
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NODE_ENV;
  });

  it('flags de cada cookie; Max-Age do refresh e do csrf = o que resta dos 7 dias', () => {
    process.env.NODE_ENV = 'development';
    const { res, chamadas } = resFalsa();
    definirCookies(reqFalsa(false), res, {
      acesso: 'jwt',
      refresh: 'ref',
      csrf: 'csrf',
      absolutaAte,
    });
    const por = Object.fromEntries(chamadas.map((c) => [c.nome, c]));
    expect(por.praxis_acesso.opcoes).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api',
      maxAge: 900_000,
    });
    expect(por.praxis_refresh.opcoes).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 7 * 24 * 3600 * 1000,
    });
    expect(por.praxis_csrf.opcoes).toEqual({
      httpOnly: false,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 3600 * 1000,
    });
  });

  it('Secure: https (req.secure) OU qualquer NODE_ENV que nao seja development/test', () => {
    const secureDe = (nodeEnv: string | undefined, https: boolean) => {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      const { res, chamadas } = resFalsa();
      definirCookies(reqFalsa(https), res, {
        acesso: 'a',
        refresh: 'r',
        csrf: 'c',
        absolutaAte,
      });
      return chamadas.map((c) => c.opcoes.secure);
    };
    expect(secureDe('development', false)).toEqual([false, false, false]);
    expect(secureDe('test', false)).toEqual([false, false, false]);
    expect(secureDe('development', true)).toEqual([true, true, true]);
    expect(secureDe('production', false)).toEqual([true, true, true]);
    expect(secureDe(undefined, false)).toEqual([true, true, true]);
    expect(secureDe('Production', false)).toEqual([true, true, true]);
  });

  it('Max-Age nunca passa do prazo restante e tem piso de 1 s', () => {
    jest
      .spyOn(relogio, 'agora')
      .mockReturnValue(new Date(absolutaAte.getTime() + 5000));
    const { res, chamadas } = resFalsa();
    definirCookies(reqFalsa(false), res, {
      acesso: 'a',
      refresh: 'r',
      csrf: 'c',
      absolutaAte,
    });
    expect(chamadas[1].opcoes.maxAge).toBe(1000);
  });

  it('API na raiz (PRAXIS_API_PREFIXO vazio): acesso em /, refresh em /auth', () => {
    process.env.PRAXIS_API_PREFIXO = '';
    try {
      const { res, chamadas } = resFalsa();
      definirCookies(reqFalsa(false), res, {
        acesso: 'a',
        refresh: 'r',
        csrf: 'c',
        absolutaAte,
      });
      expect(chamadas[0].opcoes.path).toBe('/');
      expect(chamadas[1].opcoes.path).toBe('/auth');
    } finally {
      delete process.env.PRAXIS_API_PREFIXO;
    }
  });
});

describe('definirAcesso e limparCookies', () => {
  it('definirAcesso muda so o cookie de acesso', () => {
    const { res, chamadas } = resFalsa();
    definirAcesso(reqFalsa(true), res, 'jwt');
    expect(chamadas.map((c) => c.nome)).toEqual(['praxis_acesso']);
  });

  it('limparCookies apaga os 3 com os MESMOS atributos de caminho (senao o navegador nao apaga)', () => {
    const { res, chamadas } = resFalsa();
    limparCookies(reqFalsa(true), res);
    expect(chamadas.map((c) => [c.nome, c.opcoes.path])).toEqual([
      ['praxis_acesso', '/api'],
      ['praxis_refresh', '/api/auth'],
      ['praxis_csrf', '/'],
    ]);
  });
});

describe('novoToken', () => {
  it('43 caracteres base64url, diferente a cada chamada', () => {
    const a = novoToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(novoToken()).not.toBe(a);
  });
});
