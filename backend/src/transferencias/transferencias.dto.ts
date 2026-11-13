import { IsUUID } from 'class-validator';

// Sem campo extra: clinica e papel vem do token; origem e destino vem do corpo (so ids).
export class CriarTransferenciaDto {
  @IsUUID()
  origemId!: string;

  @IsUUID()
  destinoId!: string;
}
