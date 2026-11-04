import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/jwt-auth.guard';
import { Papeis } from '../auth/papeis';
import { TetoHash } from '../auth/teto-hash';
import { NovoPsicologoDto } from '../comum/novo-psicologo';
import { Aparar } from '../comum/validacao';
import { LimiteEquipe } from '../limite-tentativas/limite-tentativas.guard';
import { EquipeService } from './equipe.service';

// Sem clinicaId/papel aqui: campo extra = 400 (forbidNonWhitelisted).
export class CriarPsicologoDto extends NovoPsicologoDto {
  @Aparar()
  @IsString()
  @Length(1, 120)
  nome!: string;
}

@Papeis('ADMIN')
@Controller('psicologos')
export class EquipeController {
  constructor(private readonly equipe: EquipeService) {}

  @LimiteEquipe()
  @TetoHash()
  @Post()
  criar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Body() dto: CriarPsicologoDto,
  ) {
    return this.equipe.criar(user, dto);
  }

  @Get()
  listar(@UsuarioAtual() user: UsuarioAutenticado) {
    return this.equipe.listar(user);
  }

  // Sem corpo. Nao reativa (decisao do dono, item 58).
  @HttpCode(200)
  @Post(':id/desativar')
  desativar(
    @UsuarioAtual() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.equipe.desativar(user, id);
  }
}
