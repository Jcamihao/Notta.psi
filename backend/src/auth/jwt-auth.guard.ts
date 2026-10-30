import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Papel } from '@prisma/client';
import { isUUID } from 'class-validator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type UsuarioAutenticado = {
  psicologoId: string;
  clinicaId: string;
  papel: Papel;
};

type Req = {
  headers: { authorization?: string };
  user?: UsuarioAutenticado;
};

// Guard GLOBAL (APP_GUARD): toda rota exige JWT, salvo as marcadas com @Publico().
const PUBLICO = 'publico';
export const Publico = () => SetMetadata(PUBLICO, true);

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
    const publico = this.reflector.getAllAndOverride<boolean>(PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publico) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    // Qualquer falha = 401 generico, sem dizer o motivo.
    const user = await this.autenticar(req.headers.authorization).catch(
      () => null,
    );
    if (!user) throw new UnauthorizedException();
    req.user = user;
    return true;
  }

  private async autenticar(
    header?: string,
  ): Promise<UsuarioAutenticado | null> {
    const [tipo, token] = header?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !token) return null;
    // Algoritmo (HS256) e segredo vem de opcoesJwt (verifyOptions).
    const p = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    const { sub, clinicaId } = p;
    if (typeof p.exp !== 'number' || !uuid(sub) || !uuid(clinicaId)) {
      return null;
    }
    // Psicologo ainda existe? Papel fresco. Filtro por clinicaId no codigo E RLS.
    const psicologo = await this.tenant.run(clinicaId, (tx) =>
      tx.psicologo.findFirst({
        where: { id: sub, clinicaId },
        select: { papel: true },
      }),
    );
    if (!psicologo) return null;
    return { psicologoId: sub, clinicaId, papel: psicologo.papel };
  }
}
