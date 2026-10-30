import { Module } from '@nestjs/common';
import { CriptografiaModule } from './criptografia/criptografia.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaudeController } from './saude/saude.controller';

@Module({
  imports: [PrismaModule, CriptografiaModule],
  controllers: [SaudeController],
})
export class AppModule {}
