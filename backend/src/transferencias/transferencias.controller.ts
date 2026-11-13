import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { Papeis } from '../auth/papeis';
import { LimiteTransferir } from '../limite-tentativas/limite-tentativas.guard';
import { CriarTransferenciaDto } from './transferencias.dto';
import { TransferenciasService } from './transferencias.service';

// Transferencia de pacientes (item 67): DUAS AUTORIZACOES. O ADMIN cria e cancela; o DESTINO aceita,
// recusa e executa o lote. A trava de quem pode o que esta no banco (funcoes SECURITY DEFINER); o
// @Papeis so responde antes, com 403 generico. Id invalido = 400 (ParseUUIDPipe).
@Controller('transferencias')
export class TransferenciasController {
  constructor(private readonly transferencias: TransferenciasService) {}

  @Papeis('ADMIN')
  @LimiteTransferir()
  @Post()
  criar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Body() dto: CriarTransferenciaDto,
  ) {
    return this.transferencias.criar(user, dto);
  }

  // Qualquer psicologo autenticado: o banco mostra so o que ele pode ver.
  @Get()
  listar(@UsuarioAtual() user: UsuarioAutenticado) {
    return this.transferencias.listar(user);
  }

  // So a contagem de pacientes por psicologo desativado (nenhum nome de paciente).
  @Papeis('ADMIN')
  @Get('contagens')
  contagens(@UsuarioAtual() user: UsuarioAutenticado) {
    return this.transferencias.contagens(user);
  }

  @LimiteTransferir()
  @HttpCode(200)
  @Post(':id/aceitar')
  aceitar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transferencias.aceitar(user, id);
  }

  @LimiteTransferir()
  @HttpCode(200)
  @Post(':id/recusar')
  recusar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transferencias.recusar(user, id);
  }

  // Executa UM lote (ate 50 pacientes) pelo DESTINO. Resposta: so contagens.
  @LimiteTransferir()
  @HttpCode(200)
  @Post(':id/executar')
  executar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transferencias.executar(user, id);
  }

  @Papeis('ADMIN')
  @LimiteTransferir()
  @HttpCode(200)
  @Delete(':id')
  cancelar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transferencias.cancelar(user, id);
  }
}
