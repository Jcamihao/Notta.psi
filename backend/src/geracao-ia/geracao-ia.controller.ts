import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { PreviaIaDto } from './geracao-ia.dto';
import { GeracaoIaService, LimiteDiarioException } from './geracao-ia.service';

// Qualquer usuario autenticado, SEM @PermiteSenhaProvisoria (dado clinico). O isolamento e do
// banco (RLS por psicologo) e do where do service, ambos pelo token.
@Controller()
export class GeracaoIaController {
  constructor(private readonly geracoes: GeracaoIaService) {}

  @Post('pacientes/:pacienteId/documentos/:origemId/previa-ia')
  previa(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
    @Param('origemId', ParseUUIDPipe) origemId: string,
    @Body() dto: PreviaIaDto,
  ) {
    return this.geracoes.previa(user, pacienteId, origemId, dto);
  }

  @Get('pacientes/:pacienteId/geracoes-ia')
  listar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
  ) {
    return this.geracoes.listar(user, pacienteId);
  }

  // 202 (PENDENTE, recem-disparado ou ja em andamento) ou 200 (PRONTO).
  @Post('geracoes-ia/:id/confirmar')
  async confirmar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const r = await this.geracoes.confirmar(user, id);
      res.status(r.status);
      return r.corpo;
    } catch (e) {
      if (e instanceof LimiteDiarioException) {
        res.setHeader('Retry-After', String(e.retryAfterSeg));
      }
      throw e;
    }
  }

  @Get('geracoes-ia/:id')
  consultar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.geracoes.consultar(user, id);
  }

  @Get('geracoes-ia/:id/previa')
  obterPrevia(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.geracoes.obterPrevia(user, id);
  }

  @Get('ia/uso')
  uso(@UsuarioAtual() user: UsuarioAutenticado) {
    return this.geracoes.uso(user);
  }
}
