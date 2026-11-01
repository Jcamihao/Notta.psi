import { Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';

@Module({
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
