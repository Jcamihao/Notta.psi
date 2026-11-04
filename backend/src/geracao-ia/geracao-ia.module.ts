import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { ConsentimentoModule } from '../consentimento/consentimento.module';
import { CriptografiaModule } from '../criptografia/criptografia.module';
import { DocumentosModule } from '../documentos/documentos.module';
import { IaModule } from '../ia/ia.module';
import { PacientesModule } from '../pacientes/pacientes.module';
import { GeracaoIaController } from './geracao-ia.controller';
import { GeracaoIaExecutor } from './geracao-ia.executor';
import { GeracaoIaService } from './geracao-ia.service';

// PrismaModule e global. Previa, confirmacao e executor (em processo, sem fila externa).
@Module({
  imports: [
    CriptografiaModule,
    AuditoriaModule,
    ConsentimentoModule,
    DocumentosModule,
    PacientesModule,
    IaModule,
  ],
  controllers: [GeracaoIaController],
  providers: [GeracaoIaService, GeracaoIaExecutor],
})
export class GeracaoIaModule {}
