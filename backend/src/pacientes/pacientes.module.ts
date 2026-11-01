import { Module } from '@nestjs/common';
import { CriptografiaModule } from '../criptografia/criptografia.module';
import { PacientesController } from './pacientes.controller';
import { PacientesService } from './pacientes.service';

// PrismaModule e global; a criptografia precisa ser importada.
@Module({
  imports: [CriptografiaModule],
  controllers: [PacientesController],
  providers: [PacientesService],
})
export class PacientesModule {}
