import { Body, Controller, Post } from '@nestjs/common';
import { Abordagem } from '@prisma/client';
import { IsEmail, IsEnum, IsString, Length, MaxLength } from 'class-validator';
import { Publico } from '../auth/jwt-auth.guard';
import { Aparar, Bytes } from '../comum/validacao';
import { LimiteCadastroClinica } from '../limite-tentativas/limite-tentativas.guard';
import { ClinicasService } from './clinicas.service';

export class CriarClinicaDto {
  @Aparar()
  @IsString()
  @Length(1, 120)
  nomeClinica!: string;

  @Aparar()
  @IsString()
  @Length(1, 120)
  nomePsicologo!: string;

  @Aparar()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Sem aparar: espaco na senha e intencional.
  @Bytes(8, 72)
  senha!: string;

  @IsEnum(Abordagem)
  abordagemPadrao!: Abordagem;
}

@Controller('clinicas')
export class ClinicasController {
  constructor(private readonly clinicas: ClinicasService) {}

  @Publico()
  @LimiteCadastroClinica()
  @Post()
  criar(@Body() dto: CriarClinicaDto) {
    return this.clinicas.criar(dto);
  }
}
