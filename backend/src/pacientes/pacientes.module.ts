import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { ConsentimentoModule } from '../consentimento/consentimento.module';
import { CriptografiaModule } from '../criptografia/criptografia.module';
import { PacientesController } from './pacientes.controller';
import { PacientesService } from './pacientes.service';

// PrismaModule e global; criptografia e auditoria precisam ser importadas.
@Module({
  imports: [CriptografiaModule, AuditoriaModule, ConsentimentoModule],
  controllers: [PacientesController],
  providers: [PacientesService],
})
export class PacientesModule {}
