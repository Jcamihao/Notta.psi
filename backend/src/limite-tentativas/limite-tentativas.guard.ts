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
import { THROTTLERS } from './limite-tentativas.module';

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

// Cada rota liga SO os seus throttlers e pula todos os outros. A lista de pulados e derivada
// de THROTTLERS: throttler novo no modulo ja e pulado nas rotas que nao o usam (nada a lembrar).
// (O guard roda antes do ValidationPipe: conta tambem as requisicoes invalidas.)
const limite = (...ativos: string[]) =>
  applyDecorators(
    SkipThrottle(
      Object.fromEntries(
        THROTTLERS.filter((t) => !ativos.includes(t.name)).map((t) => [
          t.name,
          true,
        ]),
      ),
    ),
    UseGuards(LimiteTentativasGuard),
  );

// GLOBAL (APP_GUARD em AuthModule, DEPOIS do JwtAuthGuard): throttler `api` em toda rota
// autenticada, por psicologo e somado entre rotas (chave sem classe/handler). Ignora o
// SkipThrottle de proposito: rota com limite proprio continua contando aqui.
// Rota @Publico() (sem req.user) fica de fora.
@Injectable()
export class LimiteApiGuard extends LimiteTentativasGuard {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: { psicologoId: string } }>();
    if (!req.user) return true;
    const api = THROTTLERS.find((t) => t.name === 'api')!;
    const psicologoId = req.user.psicologoId;
    return this.handleRequest({
      context: ctx,
      limit: api.limit,
      ttl: api.ttl,
      blockDuration: api.ttl,
      throttler: api,
      getTracker: () => psicologoId,
      generateKey: (_c, tracker, nome) => `${nome}:${tracker}`,
    });
  }
}

export const LimiteLogin = () => limite('login-ip', 'login-chave');
export const LimiteCadastroClinica = () => limite('clinicas');
// Guard de rota: roda DEPOIS dos guards globais (JWT), entao `req.user` ja existe.
export const LimiteEquipe = () => limite('equipe');
