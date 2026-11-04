import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/jwt-auth.guard';
import {
  CriarDocumentoDto,
  EditarDocumentoDto,
  ListarDocumentosQuery,
} from './documentos.dto';
import { DocumentosService } from './documentos.service';

// Qualquer usuario autenticado (ADMIN tambem atende). Sem @PermiteSenhaProvisoria: dado clinico.
// O isolamento e do banco (psicologo_proprio) E do where do service, ambos pelo token.
@Controller('pacientes/:pacienteId/documentos')
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService) {}

  @Post()
  criar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
    @Body() dto: CriarDocumentoDto,
  ) {
    return this.documentos.criar(user, pacienteId, dto);
  }

  @Get()
  listar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
    @Query() query: ListarDocumentosQuery,
  ) {
    return this.documentos.listar(user, pacienteId, query.status);
  }

  @Get(':id')
  obter(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.documentos.obter(user, pacienteId, id);
  }

  @Patch(':id')
  editar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarDocumentoDto,
  ) {
    return this.documentos.editar(user, pacienteId, id, dto);
  }

  // Irreversivel: aprovado nao edita nem apaga (correcao = documento novo com substituiId).
  @Post(':id/aprovar')
  @HttpCode(200)
  aprovar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.documentos.aprovar(user, pacienteId, id);
  }
}
