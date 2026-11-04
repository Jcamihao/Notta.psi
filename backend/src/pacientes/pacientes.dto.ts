import { applyDecorators } from '@nestjs/common';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { Aparar, dataValida } from '../comum/validacao';

const Nascimento = () =>
  ValidateBy({
    name: 'dataNascimento',
    validator: {
      validate: dataValida,
      defaultMessage: (a) =>
        `${a?.property} deve ser uma data real YYYY-MM-DD, de 1900-01-01 ate hoje`,
    },
  });

const Nome = () => applyDecorators(Aparar(), IsString(), Length(1, 120));
const Telefone = () =>
  applyDecorators(
    Aparar(),
    IsString(),
    Length(8, 20),
    Matches(/^[0-9 +\-()]+$/, {
      message: 'telefone aceita so digitos, espaco, +, - e parenteses',
    }),
  );
const Email = () => applyDecorators(Aparar(), IsEmail(), MaxLength(254));

// POST: so o nome e obrigatorio. Sem clinicaId/psicologoId/id: campo extra = 400.
export class CriarPacienteDto {
  @Nome()
  nome!: string;

  @IsOptional()
  @Nascimento()
  nascimento?: string;

  @IsOptional()
  @Telefone()
  telefone?: string;

  @IsOptional()
  @Email()
  email?: string;
}

// PATCH: tudo opcional; null limpa nascimento, telefone e e-mail. nome nao aceita null
// (ValidateIf so pula o undefined: null cai no IsString e vira 400).
export class EditarPacienteDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Nome()
  nome?: string;

  @IsOptional()
  @Nascimento()
  nascimento?: string | null;

  @IsOptional()
  @Telefone()
  telefone?: string | null;

  @IsOptional()
  @Email()
  email?: string | null;
}
