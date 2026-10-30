import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ClinicasModule } from './clinicas/clinicas.module';
import { CriptografiaModule } from './criptografia/criptografia.module';
import { LimiteTentativasModule } from './limite-tentativas/limite-tentativas.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaudeController } from './saude/saude.controller';

@Module({
  imports: [
    PrismaModule,
    CriptografiaModule,
    LimiteTentativasModule,
    AuthModule,
    ClinicasModule,
  ],
  controllers: [SaudeController],
})
export class AppModule {}
