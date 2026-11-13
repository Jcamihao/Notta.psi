import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CriptografiaModule } from '../criptografia/criptografia.module';
import { TransferenciasController } from './transferencias.controller';
import { TransferenciasService } from './transferencias.service';

// PrismaModule e global. Criptografia (recifra o lote) e auditoria (trilha na mesma transacao).
@Module({
  imports: [CriptografiaModule, AuditoriaModule],
  controllers: [TransferenciasController],
  providers: [TransferenciasService],
})
export class TransferenciasModule {}
