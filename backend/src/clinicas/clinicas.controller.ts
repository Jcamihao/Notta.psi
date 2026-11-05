import { Body, Controller, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { OrigemApenas } from '../auth/csrf.guard';
import { Publico } from '../auth/jwt-auth.guard';
import { TetoHash } from '../auth/teto-hash';
import { NovoPsicologoDto } from '../comum/novo-psicologo';
import { Aparar } from '../comum/validacao';
import { LimiteCadastroClinica } from '../limite-tentativas/limite-tentativas.guard';
import { ClinicasService } from './clinicas.service';

// email, senha e abordagemPadrao vem de NovoPsicologoDto (mesmas regras da equipe).
export class CriarClinicaDto extends NovoPsicologoDto {
  @Aparar()
  @IsString()
  @Length(1, 120)
  nomeClinica!: string;

  @Aparar()
  @IsString()
  @Length(1, 120)
  nomePsicologo!: string;
}

@Controller('clinicas')
export class ClinicasController {
  constructor(private readonly clinicas: ClinicasService) {}

  @Publico()
  @OrigemApenas()
  @LimiteCadastroClinica()
  @TetoHash()
  @Post()
  criar(@Body() dto: CriarClinicaDto) {
    return this.clinicas.criar(dto);
  }
}
