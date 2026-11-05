import { Equals, IsBoolean } from 'class-validator';

// So `{aceito: true}` (campo extra = 400; `false` = 400: quem nao aceita usa /recusar).
export class AceitarTermoDto {
  @IsBoolean()
  @Equals(true)
  aceito!: true;
}
