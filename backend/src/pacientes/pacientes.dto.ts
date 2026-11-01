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
import { Aparar } from '../comum/validacao';

// 'YYYY-MM-DD' que e data real (2026-02-30 nao passa), >= 1900-01-01 e nao futura.
// "Hoje" em UTC: o Brasil esta atras do UTC, entao nunca recusa data de nascimento valida.
function dataValida(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    return false;
  }
  return v >= '1900-01-01' && v <= new Date().toISOString().slice(0, 10);
}

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
