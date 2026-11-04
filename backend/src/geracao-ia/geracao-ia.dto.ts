import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export const TIPOS_GERADOS = ['EVOLUCAO', 'ANAMNESE'] as const;
export type TipoGerado = (typeof TIPOS_GERADOS)[number];

// Campo extra = 400 (whitelist global). Os termos extras sao palavras que o psicologo quer
// esconder da IA (ex.: nome de um familiar): ate 20, cada um 1..60 caracteres e nao so espacos.
export class PreviaIaDto {
  @IsIn(TIPOS_GERADOS)
  tipoDocumento!: TipoGerado;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  @Matches(/\S/, { each: true, message: 'termo nao pode ser so espacos' })
  termosExtras?: string[];
}
