import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { RegistrarConsentimentoDto } from './consentimento.dto';
import { ConsentimentoService } from './consentimento.service';

// Qualquer usuario autenticado; sem @PermiteSenhaProvisoria (dado clinico). O isolamento e do
// banco (psicologo_proprio) E do where do service, ambos pelo token.
@Controller('pacientes/:id/consentimento')
export class ConsentimentoController {
  constructor(private readonly consentimento: ConsentimentoService) {}

  @Get()
  obter(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.consentimento.obter(user, id);
  }

  @Post()
  registrar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarConsentimentoDto,
  ) {
    return this.consentimento.registrar(user, id, dto.evento);
  }
}
