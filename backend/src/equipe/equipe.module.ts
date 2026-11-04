import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EquipeController } from './equipe.controller';
import { EquipeService } from './equipe.service';

@Module({
  imports: [AuditoriaModule],
  controllers: [EquipeController],
  providers: [EquipeService],
})
export class EquipeModule {}
