import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { ConsentimentoController } from './consentimento.controller';
import { ConsentimentoService } from './consentimento.service';

// PrismaModule e global; a auditoria precisa ser importada. Exporta o service para pacientes
// (estado na lista) e para o item 12 (`exigirConcedido`).
@Module({
  imports: [AuditoriaModule],
  controllers: [ConsentimentoController],
  providers: [ConsentimentoService],
  exports: [ConsentimentoService],
})
export class ConsentimentoModule {}
