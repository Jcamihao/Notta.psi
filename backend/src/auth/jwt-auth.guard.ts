import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Papel } from '@prisma/client';
import { isUUID } from 'class-validator';
import type { Response } from 'express';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type UsuarioAutenticado = {
  psicologoId: string;
  clinicaId: string;
  papel: Papel;
  senhaProvisoria: boolean;
};

type Req = {
  headers: { authorization?: string };
  user?: UsuarioAutenticado;
};

// Guard GLOBAL (APP_GUARD): toda rota exige JWT, salvo as marcadas com @Publico().
const PUBLICO = 'publico';
export const Publico = () => SetMetadata(PUBLICO, true);

// Senha provisoria (criada pelo ADMIN, item 62): o guard responde 403 "Troca de senha
// obrigatoria" em TODA rota autenticada, salvo as marcadas com @PermiteSenhaProvisoria()
// (hoje GET /eu e POST /auth/trocar-senha). Rota nova nasce bloqueada (falha fechada).
const PERMITE_SENHA_PROVISORIA = 'permiteSenhaProvisoria';
export const PermiteSenhaProvisoria = () =>
  SetMetadata(PERMITE_SENHA_PROVISORIA, true);

const uuid = (v: unknown): v is string => isUUID(v);

export const UsuarioAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Req>().user,
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly tenant: TenantPrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const marcado = (chave: string) =>
      this.reflector.getAllAndOverride<boolean>(chave, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    if (marcado(PUBLICO)) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    // 401 SO para token/payload invalido ou psicologo inexistente (autenticar devolve null).
    // Erro de banco/pool NAO e culpa do token: 503, senao o front desloga todo mundo sob carga.
    const user = await this.autenticar(req.headers.authorization).catch(() => {
      ctx.switchToHttp().getResponse<Response>().header('Retry-After', '2');
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Servico indisponivel',
      });
    });
    if (!user) throw new UnauthorizedException();
    if (user.senhaProvisoria && !marcado(PERMITE_SENHA_PROVISORIA)) {
      throw new ForbiddenException('Troca de senha obrigatoria');
    }
    req.user = user;
    return true;
  }

  private async autenticar(
    header?: string,
  ): Promise<UsuarioAutenticado | null> {
    const [tipo, token] = header?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !token) return null;
    // Algoritmo (HS256) e segredo vem de opcoesJwt (verifyOptions). Qualquer erro aqui = 401.
    const p = await this.jwt
      .verifyAsync<Record<string, unknown>>(token)
      .catch(() => null);
    if (!p) return null;
    const { sub, clinicaId, tv } = p;
    if (typeof p.exp !== 'number' || !uuid(sub) || !uuid(clinicaId)) {
      return null;
    }
    // Psicologo ainda existe? Papel e senhaProvisoria frescos. Filtro por clinicaId no codigo E RLS.
    const psicologo = await this.tenant.run(clinicaId, (tx) =>
      tx.psicologo.findFirst({
        where: { id: sub, clinicaId },
        select: { papel: true, senhaProvisoria: true, tokenVersao: true },
      }),
    );
    // tv diferente (ou ausente/nao numero) = token emitido antes da ultima troca de senha.
    if (!psicologo || psicologo.tokenVersao !== tv) return null;
    return {
      psicologoId: sub,
      clinicaId,
      papel: psicologo.papel,
      senhaProvisoria: psicologo.senhaProvisoria,
    };
  }
}
