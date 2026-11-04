import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { ConsentimentoModule } from '../consentimento/consentimento.module';
import { CriptografiaModule } from '../criptografia/criptografia.module';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';

// PrismaModule e global; criptografia, auditoria e consentimento precisam ser importados.
@Module({
  imports: [CriptografiaModule, AuditoriaModule, ConsentimentoModule],
  controllers: [DocumentosController],
  providers: [DocumentosService],
})
export class DocumentosModule {}
