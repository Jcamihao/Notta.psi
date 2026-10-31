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
import {
  InjectThrottlerStorage,
  ThrottlerException,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { Papel } from '@prisma/client';
import { isUUID } from 'class-validator';
import type { Response } from 'express';
import { THROTTLERS } from '../limite-tentativas/limite-tentativas.module';
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

type Token = { sub: string; clinicaId: string; tv: unknown };

// Limites por psicologo contados ANTES do banco (I-2 da 2a revisao): uma requisicao barrada
// nao gasta conexao do pool, senao um usuario sozinho degrada TODAS as clinicas.
// 1) throttler `api` (300/min, chave `api:<sub>`, somado entre rotas);
// 2) teto de requisicoes SIMULTANEAS por psicologo (sem fila: acima = 429 na hora).
// O contador libera no 'close' da resposta: sucesso, erro ou desconexao do cliente.
// Em memoria, por processo (1 instancia, como o throttler).
// TARPIT: a recusa 429 so responde depois de RECUSA_ATRASO_MS. Medido: recusar na hora nao
// basta, porque cada 429 convida o proximo pedido na mesma conexao e 500 conexoes em laco
// saturam o event loop (cada iteracao ~80 ms; uma requisicao legitima precisa de varias
// iteracoes e leva 1 s ou mais). Segurando a resposta, o atacante cai para ~1 req/s por
// conexao e o custo some. O timer sai se o cliente desistir.
const API = THROTTLERS.find((t) => t.name === 'api')!;
export const TETO_SIMULTANEAS = 5;
export const RECUSA_ATRASO_MS = 1000;

// Espera RECUSA_ATRASO_MS ou o cliente desistir (close), o que vier primeiro.
const segurar = (res: Response) =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, RECUSA_ATRASO_MS);
    res.once('close', () => {
      clearTimeout(t);
      ok();
    });
  });

export const UsuarioAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Req>().user,
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly simultaneas = new Map<string, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly tenant: TenantPrismaService,
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const marcado = (chave: string) =>
      this.reflector.getAllAndOverride<boolean>(chave, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    if (marcado(PUBLICO)) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    const res = ctx.switchToHttp().getResponse<Response>();
    // 401 SO para token/payload invalido ou psicologo inexistente. Token invalido nao toca o banco.
    const token = await this.verificar(req.headers.authorization);
    if (!token) throw new UnauthorizedException();
    await this.limitar(token.sub, res);
    // Erro de banco/pool NAO e culpa do token: 503, senao o front desloga todo mundo sob carga.
    const user = await this.buscar(token).catch(() => {
      res.header('Retry-After', '2');
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

  private async limitar(sub: string, res: Response): Promise<void> {
    const { isBlocked, timeToBlockExpire } = await this.storage.increment(
      `api:${sub}`,
      API.ttl,
      API.limit,
      API.ttl,
      API.name,
    );
    if (isBlocked) {
      res.header('Retry-After', String(timeToBlockExpire));
      await segurar(res);
      throw new ThrottlerException('Muitas tentativas. Tente mais tarde.');
    }
    const simultaneas = this.simultaneas;
    const n = simultaneas.get(sub) ?? 0;
    if (n >= TETO_SIMULTANEAS) {
      res.header('Retry-After', '1');
      await segurar(res);
      throw new ThrottlerException('Muitas requisicoes simultaneas');
    }
    simultaneas.set(sub, n + 1);
    res.once('close', () => {
      const resta = simultaneas.get(sub)! - 1;
      if (resta > 0) simultaneas.set(sub, resta);
      else simultaneas.delete(sub);
    });
  }

  // So assinatura e formato do payload: sem banco.
  private async verificar(header?: string): Promise<Token | null> {
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
    return { sub, clinicaId, tv };
  }

  private async buscar({
    sub,
    clinicaId,
    tv,
  }: Token): Promise<UsuarioAutenticado | null> {
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
