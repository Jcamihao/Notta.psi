import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ClinicasModule } from './clinicas/clinicas.module';
import { ConsentimentoModule } from './consentimento/consentimento.module';
import { ConviteConsentimentoModule } from './convite-consentimento/convite-consentimento.module';
import { CriptografiaModule } from './criptografia/criptografia.module';
import { DocumentosModule } from './documentos/documentos.module';
import { EquipeModule } from './equipe/equipe.module';
import { GeracaoIaModule } from './geracao-ia/geracao-ia.module';
import { IaModule } from './ia/ia.module';
import { LimiteTentativasModule } from './limite-tentativas/limite-tentativas.module';
import { PacientesModule } from './pacientes/pacientes.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaudeController } from './saude/saude.controller';
import { TransferenciasModule } from './transferencias/transferencias.module';

@Module({
  imports: [
    PrismaModule,
    CriptografiaModule,
    LimiteTentativasModule,
    AuthModule,
    ClinicasModule,
    EquipeModule,
    ConsentimentoModule,
    ConviteConsentimentoModule,
    PacientesModule,
    DocumentosModule,
    IaModule,
    GeracaoIaModule,
    TransferenciasModule,
  ],
  controllers: [SaudeController],
})
export class AppModule {}
