import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { relogio } from '../comum/relogio';
import { ACESSO_SEGUNDOS } from './jwt.config';

// Nomes FIXOS, sem prefixo __Host-/__Secure-: o front le o CSRF pelo nome; o refresh precisa de
// Path proprio (__Host- exige Path=/); e __Host- sem Secure e rejeitado, o que quebraria o http de
// desenvolvimento. Ver docs/ACESSO.md (sessao).
export const COOKIE_ACESSO = 'praxis_acesso';
export const COOKIE_REFRESH = 'praxis_refresh';
export const COOKIE_CSRF = 'praxis_csrf';

// Base da API como o NAVEGADOR a ve (o proxy tira o prefixo antes do back). Padrao `/api`;
// `PRAXIS_API_PREFIXO=` (vazio) = API na raiz. O refresh so viaja para `<prefixo>/auth/*`.
export function prefixoApi(env: NodeJS.ProcessEnv = process.env): string {
  const bruto = env.PRAXIS_API_PREFIXO;
  if (bruto === undefined) return '/api';
  if (bruto !== '' && !/^(\/[A-Za-z0-9._~-]+)+$/.test(bruto)) {
    throw new Error(
      'PRAXIS_API_PREFIXO invalida: use caminho como /api (sem barra no fim) ou vazio',
    );
  }
  return bruto;
}

const emDev = (env: NodeJS.ProcessEnv) =>
  ['development', 'test'].includes((env.NODE_ENV ?? '').trim().toLowerCase());

// Valor do CSRF: 32 bytes aleatorios, 43 caracteres base64url. Uma por login.
export const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const novoToken = () => randomBytes(32).toString('base64url');

// Cookie por nome, sem dependencia. Repetido: vale o primeiro (o mais especifico, pela regra do
// navegador). Valor mal codificado = ausente.
export function lerCookie(cabecalho: string | undefined, nome: string) {
  for (const parte of (cabecalho ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 0 || parte.slice(0, i).trim() !== nome) continue;
    try {
      return decodeURIComponent(parte.slice(i + 1).trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Secure quando a requisicao e https (com PRAXIS_TRUST_PROXY, o X-Forwarded-Proto vale) ou fora de
// development/test. localhost em http dev nao tem Secure (os navegadores o tratam como seguro).
const opcoes = (req: Request, env: NodeJS.ProcessEnv = process.env) => ({
  secure: req.secure || !emDev(env),
});

export function definirCookies(
  req: Request,
  res: Response,
  c: { acesso: string; refresh: string; csrf: string; absolutaAte: Date },
) {
  const { secure } = opcoes(req);
  const prefixo = prefixoApi();
  // Max-Age do refresh e do CSRF = o que resta do limite absoluto (nunca mais que 7 dias).
  const resta = Math.max(
    1000,
    c.absolutaAte.getTime() - relogio.agora().getTime(),
  );
  res.cookie(COOKIE_ACESSO, c.acesso, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: prefixo || '/',
    maxAge: ACESSO_SEGUNDOS * 1000,
  });
  res.cookie(COOKIE_REFRESH, c.refresh, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: `${prefixo}/auth`,
    maxAge: resta,
  });
  res.cookie(COOKIE_CSRF, c.csrf, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: resta,
  });
}

// So o cookie de acesso (troca de senha: mesmo sid, `tv` novo).
export function definirAcesso(req: Request, res: Response, acesso: string) {
  res.cookie(COOKIE_ACESSO, acesso, {
    httpOnly: true,
    secure: opcoes(req).secure,
    sameSite: 'lax',
    path: prefixoApi() || '/',
    maxAge: ACESSO_SEGUNDOS * 1000,
  });
}

export function limparCookies(req: Request, res: Response) {
  const { secure } = opcoes(req);
  const prefixo = prefixoApi();
  res.clearCookie(COOKIE_ACESSO, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: prefixo || '/',
  });
  res.clearCookie(COOKIE_REFRESH, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: `${prefixo}/auth`,
  });
  res.clearCookie(COOKIE_CSRF, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
  });
}
