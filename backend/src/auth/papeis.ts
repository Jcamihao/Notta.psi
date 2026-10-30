import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Papel } from '@prisma/client';
import { UsuarioAutenticado } from './jwt-auth.guard';

// @Papeis('ADMIN') na classe ou no metodo (o metodo vence). Sem @Papeis = qualquer autenticado.
// Papel e para acoes de gestao; quem isola prontuario e o banco (docs/ACESSO.md).
const PAPEIS = 'papeis';
export const Papeis = (...papeis: Papel[]) => SetMetadata(PAPEIS, papeis);

// Guard GLOBAL registrado DEPOIS do JwtAuthGuard (sem token = 401 antes de chegar aqui).
// `false` = o Nest responde 403 generico "Forbidden resource", sem dizer qual papel faltou.
@Injectable()
export class PapeisGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const papeis = this.reflector.getAllAndOverride<Papel[] | undefined>(
      PAPEIS,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!papeis) return true;
    const { user } = ctx
      .switchToHttp()
      .getRequest<{ user?: UsuarioAutenticado }>();
    return !!user && papeis.includes(user.papel);
  }
}
