import { applyDecorators } from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { dataValida } from '../comum/validacao';

export const TIPOS = ['NOTA_BRUTA', 'EVOLUCAO', 'ANAMNESE'] as const;
export type TipoDocumento = (typeof TIPOS)[number];
export const STATUS = ['RASCUNHO', 'APROVADO'] as const;
export type StatusDocumento = (typeof STATUS)[number];
export const LIMITE_CONTEUDO = 20000;

// Texto clinico: NAO se apara (so se rejeita vazio ou so espacos); o que o psicologo digitou fica.
const Conteudo = () =>
  applyDecorators(
    IsString(),
    Length(1, LIMITE_CONTEUDO),
    Matches(/\S/, { message: 'conteudo nao pode ser so espacos' }),
  );

const DataSessao = () =>
  ValidateBy({
    name: 'dataSessao',
    validator: {
      validate: dataValida,
      defaultMessage: (a) =>
        `${a?.property} deve ser uma data real YYYY-MM-DD, de 1900-01-01 ate hoje`,
    },
  });

// Sem clinicaId/psicologoId/pacienteId/status/id: campo extra = 400 (whitelist global).
export class CriarDocumentoDto {
  @IsIn(TIPOS)
  tipo!: TipoDocumento;

  @IsOptional()
  @DataSessao()
  dataSessao?: string;

  @Conteudo()
  conteudo!: string;

  // Correcao: id de um documento APROVADO do mesmo paciente (o servico confere).
  @IsOptional()
  @IsUUID()
  substituiId?: string;
}

// Corpo parcial; sem `tipo` (campo extra = 400) e sem corpo vazio (o servico recusa).
// `dataSessao: null` apaga a data; `conteudo: null` e recusado (so ausente vale).
export class EditarDocumentoDto {
  @ValidateIf((_, v) => v !== undefined)
  @Conteudo()
  conteudo?: string;

  @IsOptional()
  @DataSessao()
  dataSessao?: string | null;
}

export class ListarDocumentosQuery {
  @IsOptional()
  @IsIn(STATUS)
  status?: StatusDocumento;
}
