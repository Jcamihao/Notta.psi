import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ORIGENS_PERMITIDAS } from '../comum/origens';
import {
  COOKIE_ACESSO,
  COOKIE_CSRF,
  FORMATO_TOKEN,
  lerCookie,
} from './cookies';

type Req = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
};

// Rotas publicas que mudam estado e criam/renovam sessao (login, cadastro de clinica, renovar):
// ainda nao ha sessao nem CSRF, entao exigem so a checagem de Origin.
const ORIGEM_APENAS = 'origemApenas';
export const OrigemApenas = () => SetMetadata(ORIGEM_APENAS, true);

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Corpo FIXO: nunca diz qual checagem falhou.
const recusa = () => new ForbiddenException('Requisicao recusada');

const um = (v: string | string[] | undefined) =>
  Array.isArray(v) ? undefined : v;

// CSRF (item 46), guard GLOBAL antes do JwtAuthGuard (uma requisicao forjada nao gasta banco nem
// o limite do psicologo). So vale para requisicao autenticada por COOKIE com metodo nao seguro:
// - `Authorization` presente = credencial explicita (Bearer): fora (so o script do cliente a manda);
// - sem cookie de acesso = nao ha credencial ambiente: fora (o JwtAuthGuard responde 401);
// - rotas @Publico() do termo: fora (o token na URL e a credencial).
// Senao: Origin (ou Referer) = origem permitida E header X-CSRF-Token = cookie notta_csrf.
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ORIGENS_PERMITIDAS) private readonly origens: string[],
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (SEGUROS.has(req.method.toUpperCase())) return true;
    const marcado = (chave: string) =>
      this.reflector.getAllAndOverride<boolean>(chave, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    if (marcado(ORIGEM_APENAS)) {
      this.exigirOrigem(req);
      return true;
    }
    if (marcado('publico')) return true;
    if (req.headers.authorization !== undefined) return true;
    const cookies = um(req.headers.cookie);
    if (!lerCookie(cookies, COOKIE_ACESSO)) return true;

    this.exigirOrigem(req);
    const cookie = lerCookie(cookies, COOKIE_CSRF);
    const cabecalho = um(req.headers['x-csrf-token']);
    if (
      !cookie ||
      !cabecalho ||
      !FORMATO_TOKEN.test(cookie) ||
      !FORMATO_TOKEN.test(cabecalho) ||
      !timingSafeEqual(Buffer.from(cookie), Buffer.from(cabecalho))
    ) {
      throw recusa();
    }
    return true;
  }

  // Origin quando vem; sem ele, a origem do Referer. Nenhum dos dois = recusa.
  private exigirOrigem(req: Req) {
    const origin = um(req.headers.origin);
    const referer = um(req.headers.referer);
    let origem: string | undefined = origin;
    if (origem === undefined && referer !== undefined) {
      try {
        origem = new URL(referer).origin;
      } catch {
        origem = undefined;
      }
    }
    if (origem === undefined || !this.origens.includes(origem)) throw recusa();
  }
}
