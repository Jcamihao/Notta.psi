import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Aparar, Bytes } from '../comum/validacao';
import {
  LimiteLogin,
  LimiteRenovar,
  LimiteTrocarSenha,
} from '../limite-tentativas/limite-tentativas.guard';
import { AuthService } from './auth.service';
import {
  COOKIE_CSRF,
  COOKIE_REFRESH,
  definirAcesso,
  definirCookies,
  FORMATO_TOKEN,
  lerCookie,
  limparCookies,
  novoToken,
} from './cookies';
import { OrigemApenas } from './csrf.guard';
import {
  PermiteSenhaProvisoria,
  Publico,
  SessaoAtual,
  UsuarioAtual,
  type UsuarioAutenticado,
} from './jwt-auth.guard';
import type { SessaoAtual as Sessao } from './sessao.service';
import { SessaoService } from './sessao.service';
import { TetoHash } from './teto-hash';

// Sem IsEmail aqui: e-mail mal formado cai no mesmo 401 de credencial errada.
class LoginDto {
  @Aparar()
  @IsString()
  @MaxLength(254)
  email!: string;

  @Bytes(1, 72)
  senha!: string;
}

// Sem aparar: espaco na senha e intencional. Campos extras (ex.: psicologoId) = 400:
// so a conta do token muda.
class TrocarSenhaDto {
  @Bytes(1, 72)
  senhaAtual!: string;

  // So o formato (1..72 bytes); a politica de senha forte e `exigirSenhaForte` (422 com motivo).
  @Bytes(1, 72)
  novaSenha!: string;
}

// Clientes que NAO sao navegador (scripts, testes) mandam este cabecalho e recebem o JWT de acesso no
// corpo (`token`), para usar em `Authorization: Bearer`. O navegador (front) NUNCA manda: o JWT so
// existe no cookie httpOnly.
const cabecalhoApi = (v?: string) => v === 'api';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessoes: SessaoService,
  ) {}

  @Publico()
  @OrigemApenas()
  @LimiteLogin()
  @TetoHash()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Headers('x-notta-cliente') cliente: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { usuario, acesso, refresh, absolutaAte } = await this.auth.login(
      dto.email,
      dto.senha,
    );
    res.setHeader('Cache-Control', 'no-store');
    definirCookies(req, res, {
      acesso,
      refresh,
      csrf: novoToken(),
      absolutaAte,
    });
    return cabecalhoApi(cliente) ? { usuario, token: acesso } : { usuario };
  }

  // Renovacao: so o cookie de refresh (sem corpo). Falha qualquer = o mesmo 401 + cookies limpos.
  @Publico()
  @OrigemApenas()
  @LimiteRenovar()
  @Post('auth/renovar')
  @HttpCode(200)
  async renovar(
    @Headers('x-notta-cliente') cliente: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const cru = lerCookie(req.headers.cookie, COOKIE_REFRESH);
    const nova = cru ? await this.auth.renovar(cru) : null;
    if (!nova) {
      limparCookies(req, res);
      throw new UnauthorizedException();
    }
    // O CSRF acompanha a sessao (nao muda a cada renovacao: abas concorrentes nao se quebram).
    const csrf = lerCookie(req.headers.cookie, COOKIE_CSRF);
    definirCookies(req, res, {
      acesso: nova.acesso,
      refresh: nova.refresh,
      csrf: csrf && FORMATO_TOKEN.test(csrf) ? csrf : novoToken(),
      absolutaAte: nova.absolutaAte,
    });
    return cabecalhoApi(cliente)
      ? { ok: true, token: nova.acesso }
      : { ok: true };
  }

  // Sair e sair de todos nao ficam presos a senha provisoria: encerrar a sessao e sempre permitido.
  @PermiteSenhaProvisoria()
  @Post('auth/sair')
  @HttpCode(200)
  async sair(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @SessaoAtual() sessao: Sessao,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessoes.sair(usuario, sessao);
    limparCookies(req, res);
    return { ok: true };
  }

  @PermiteSenhaProvisoria()
  @Post('auth/sair-de-todos')
  @HttpCode(200)
  async sairDeTodos(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @SessaoAtual() sessao: Sessao,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessoes.sairDeTodos(usuario, sessao);
    limparCookies(req, res);
    return { ok: true };
  }

  @PermiteSenhaProvisoria()
  @LimiteTrocarSenha()
  @TetoHash()
  @Post('auth/trocar-senha')
  @HttpCode(200)
  async trocarSenha(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @SessaoAtual() sessao: Sessao,
    @Body() dto: TrocarSenhaDto,
    @Headers('x-notta-cliente') cliente: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const acesso = await this.auth.trocarSenha(
      usuario,
      sessao,
      dto.senhaAtual,
      dto.novaSenha,
    );
    res.setHeader('Cache-Control', 'no-store');
    // Mesma sessao, JWT novo (tv novo): so o cookie de acesso muda.
    definirAcesso(req, res, acesso);
    return cabecalhoApi(cliente) ? { ok: true, token: acesso } : { ok: true };
  }

  @PermiteSenhaProvisoria()
  @Get('eu')
  eu(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.auth.eu(usuario);
  }
}
