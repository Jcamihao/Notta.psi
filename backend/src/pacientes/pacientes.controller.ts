import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { LimiteExportar } from '../limite-tentativas/limite-tentativas.guard';
import { CriarPacienteDto, EditarPacienteDto } from './pacientes.dto';
import { PacientesService } from './pacientes.service';

// Qualquer usuario autenticado (ADMIN tambem atende). Sem @PermiteSenhaProvisoria: dado clinico.
// O isolamento e do banco (psicologo_proprio) E do where do service, ambos pelo token.
@Controller('pacientes')
export class PacientesController {
  constructor(private readonly pacientes: PacientesService) {}

  @Post()
  criar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Body() dto: CriarPacienteDto,
  ) {
    return this.pacientes.criar(user, dto);
  }

  @Get()
  listar(@UsuarioAtual() user: UsuarioAutenticado) {
    return this.pacientes.listar(user);
  }

  @Get(':id')
  obter(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pacientes.obter(user, id);
  }

  @Patch(':id')
  atualizar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPacienteDto,
  ) {
    return this.pacientes.atualizar(user, id, dto);
  }

  // Exclusao por anonimizacao (LGPD, item 26). 200 com { excluidoEm }. Sem
  // @PermiteSenhaProvisoria: dado clinico. ADMIN nao exclui paciente de colega (404 identico).
  @Delete(':id')
  excluir(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pacientes.excluir(user, id);
  }

  // Exportacao (LGPD, item 26, portabilidade): JSON com o paciente em claro, anexo. Cabecalhos so
  // depois do sucesso (um erro nao leva `attachment` nem `no-store` junto). Nome do arquivo = uuid.
  @LimiteExportar()
  @Get(':id/exportar')
  async exportar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dados = await this.pacientes.exportar(user, id);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="paciente-${id}.json"`,
      'Cache-Control': 'no-store',
    });
    return dados;
  }
}
