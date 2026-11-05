import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { ConviteConsentimentoService } from './convite-consentimento.service';

// Qualquer usuario autenticado; sem @PermiteSenhaProvisoria (dado clinico). O isolamento e do
// banco (RLS por psicologo) E do where do service, ambos pelo token.
@Controller('pacientes/:pacienteId/convites-consentimento')
export class ConviteConsentimentoController {
  constructor(private readonly convites: ConviteConsentimentoService) {}

  // 201 {id, link, expiraEm}: o link (com o token) so aparece AQUI, uma vez.
  @Post()
  criar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
  ) {
    return this.convites.criar(user, pacienteId);
  }

  @Get()
  listar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
  ) {
    return this.convites.listar(user, pacienteId);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.convites.cancelar(user, pacienteId, id);
  }
}
