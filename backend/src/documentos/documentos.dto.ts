import { applyDecorators } from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateBy,
} from 'class-validator';
import { dataValida } from '../comum/validacao';

export const TIPOS = ['NOTA_BRUTA', 'EVOLUCAO', 'ANAMNESE'] as const;
export type TipoDocumento = (typeof TIPOS)[number];
export const LIMITE_CONTEUDO = 20000;

// Texto clinico: NAO se apara (so se rejeita vazio ou so espacos); o que o psicologo digitou fica.
const Conteudo = () =>
  applyDecorators(
    IsString(),
    Length(1, LIMITE_CONTEUDO),
    Matches(/\S/, { message: 'conteudo nao pode ser so espacos' }),
  );

// Sem clinicaId/psicologoId/pacienteId/status/id: campo extra = 400 (whitelist global).
export class CriarDocumentoDto {
  @IsIn(TIPOS)
  tipo!: TipoDocumento;

  @IsOptional()
  @ValidateBy({
    name: 'dataSessao',
    validator: {
      validate: dataValida,
      defaultMessage: (a) =>
        `${a?.property} deve ser uma data real YYYY-MM-DD, de 1900-01-01 ate hoje`,
    },
  })
  dataSessao?: string;

  @Conteudo()
  conteudo!: string;
}
