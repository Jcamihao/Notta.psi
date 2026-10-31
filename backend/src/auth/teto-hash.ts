import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { finalize } from 'rxjs';

// Teto GLOBAL de rotas com bcrypt em andamento (login, cadastro de clinica, criacao de
// psicologo; a futura troca de senha tambem usa @TetoHash()). O bcrypt nativo roda no
// threadpool do libuv (4 threads): sem teto, uma rajada enfileira centenas de hashes e
// tudo que usa o threadpool espera. Acima do teto responde 503 na hora (sem fila).
// Contador do processo: 1 instancia (como o limite em memoria).
export const TETO_HASH = 8;
let emUso = 0;

@Injectable()
export class TetoHashInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    if (emUso >= TETO_HASH) {
      ctx.switchToHttp().getResponse<Response>().header('Retry-After', '1');
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Servico indisponivel',
      });
    }
    emUso++;
    // finalize: libera no sucesso, no erro e se o cliente desistir.
    return next.handle().pipe(finalize(() => emUso--));
  }
}

export const TetoHash = () => UseInterceptors(TetoHashInterceptor);
