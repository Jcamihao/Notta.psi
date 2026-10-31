import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
  UseInterceptors,
} from '@nestjs/common';
import { normalizeIp } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { finalize } from 'rxjs';

// Teto GLOBAL de rotas com bcrypt em andamento (login, cadastro de clinica, criacao de
// psicologo, troca de senha). O bcrypt nativo roda no
// threadpool do libuv (4 threads): sem teto, uma rajada enfileira centenas de hashes e
// tudo que usa o threadpool espera. Acima do teto responde 503 na hora (sem fila).
// Alem do teto global, no maximo TETO_HASH_POR_IP por tracker de IP (/64 no IPv6, como o
// throttler): um IP/ /64 sozinho nao segura todas as vagas e deixa os outros sem login.
// Residual: botnet distribuida (muitos IPs, cada um com 2 vagas) ainda ocupa as 8 vagas;
// isso se resolve na borda (WAF/limite no proxy), nao aqui.
// Contador do processo: 1 instancia (como o limite em memoria).
export const TETO_HASH = 8;
export const TETO_HASH_POR_IP = 2;
const PREFIXO_IPV6 = 64;
let emUso = 0;
const porIp = new Map<string, number>();

@Injectable()
export class TetoHashInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const ip = normalizeIp(
      ctx.switchToHttp().getRequest<Request>().ip ?? '',
      PREFIXO_IPV6,
    );
    const doIp = porIp.get(ip) ?? 0;
    if (emUso >= TETO_HASH || doIp >= TETO_HASH_POR_IP) {
      ctx.switchToHttp().getResponse<Response>().header('Retry-After', '1');
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Servico indisponivel',
      });
    }
    emUso++;
    porIp.set(ip, doIp + 1);
    // finalize: libera no sucesso, no erro e se o cliente desistir.
    return next.handle().pipe(
      finalize(() => {
        emUso--;
        const resta = porIp.get(ip)! - 1;
        if (resta > 0) porIp.set(ip, resta);
        else porIp.delete(ip);
      }),
    );
  }
}

export const TetoHash = () => UseInterceptors(TetoHashInterceptor);
