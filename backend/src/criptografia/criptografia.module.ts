import { Module } from '@nestjs/common';
import { CriptografiaService } from './criptografia.service';

@Module({
  providers: [CriptografiaService],
  exports: [CriptografiaService],
})
export class CriptografiaModule {}
