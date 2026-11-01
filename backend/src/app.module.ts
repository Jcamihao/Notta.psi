import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ClinicasModule } from './clinicas/clinicas.module';
import { ConsentimentoModule } from './consentimento/consentimento.module';
import { CriptografiaModule } from './criptografia/criptografia.module';
import { EquipeModule } from './equipe/equipe.module';
import { LimiteTentativasModule } from './limite-tentativas/limite-tentativas.module';
import { PacientesModule } from './pacientes/pacientes.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaudeController } from './saude/saude.controller';

@Module({
  imports: [
    PrismaModule,
    CriptografiaModule,
    LimiteTentativasModule,
    AuthModule,
    ClinicasModule,
    EquipeModule,
    ConsentimentoModule,
    PacientesModule,
  ],
  controllers: [SaudeController],
})
export class AppModule {}
