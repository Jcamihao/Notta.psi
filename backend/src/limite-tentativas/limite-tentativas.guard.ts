import {
  applyDecorators,
  ExecutionContext,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import {
  SkipThrottle,
  ThrottlerException,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import type { Response } from 'express';

// O throttler nomeado poe `Retry-After-<nome>`; o contrato pede `Retry-After` (segundos).
// Corpo generico: nunca ecoa o e-mail.
@Injectable()
export class LimiteTentativasGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    ctx: ExecutionContext,
    detalhe: ThrottlerLimitDetail,
  ): Promise<void> {
    ctx
      .switchToHttp()
      .getResponse<Response>()
      .header('Retry-After', String(detalhe.timeToBlockExpire));
    throw new ThrottlerException('Muitas tentativas. Tente mais tarde.');
  }
}

// Cada rota liga SO os seus throttlers e pula os demais.
// Throttler novo em limite-tentativas.module.ts => acrescente ao SkipThrottle de TODA rota abaixo.
// (O guard roda antes do ValidationPipe: conta tambem as requisicoes invalidas.)
export const LimiteLogin = () =>
  applyDecorators(
    SkipThrottle({ clinicas: true }),
    UseGuards(LimiteTentativasGuard),
  );

export const LimiteCadastroClinica = () =>
  applyDecorators(
    SkipThrottle({ 'login-ip': true, 'login-chave': true }),
    UseGuards(LimiteTentativasGuard),
  );
