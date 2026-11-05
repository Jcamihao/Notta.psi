import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Publico } from '../auth/jwt-auth.guard';
import { LimiteConsentimentoPublico } from '../limite-tentativas/limite-tentativas.guard';
import { AceitarTermoDto } from './convite-consentimento.dto';
import { ConsentimentoPublicoService } from './consentimento-publico.service';
import { TokenPipe } from './convite.token';

// Toda resposta destas rotas (sucesso, 404, 400, 429) sai sem cache e sem Referer: o token esta na
// URL e a pagina mostra o termo. E guard (nao @Header) para valer tambem nas respostas de erro;
// roda antes do throttler de rota, entao o 429 tambem leva os cabecalhos.
@Injectable()
class CabecalhosPrivadosGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const res = ctx.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return true;
  }
}

// SEM JWT (@Publico). Throttler proprio por IP (/64 no IPv6).
@Publico()
@UseGuards(CabecalhosPrivadosGuard)
@Controller('publico/consentimento')
export class ConsentimentoPublicoController {
  constructor(private readonly publico: ConsentimentoPublicoService) {}

  @LimiteConsentimentoPublico()
  @Get(':token')
  abrir(@Param('token', TokenPipe) token: string) {
    return this.publico.abrir(token);
  }

  @LimiteConsentimentoPublico()
  @Post(':token/aceitar')
  @HttpCode(200)
  aceitar(
    @Param('token', TokenPipe) token: string,
    // So valida o corpo ({aceito: true}); o valor nao e usado.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _dto: AceitarTermoDto,
  ) {
    return this.publico.aceitar(token);
  }

  @LimiteConsentimentoPublico()
  @Post(':token/recusar')
  @HttpCode(200)
  recusar(@Param('token', TokenPipe) token: string) {
    return this.publico.recusar(token);
  }
}
