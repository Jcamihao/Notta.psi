import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { ConsentimentoModule } from '../consentimento/consentimento.module';
import { ConsentimentoPublicoController } from './consentimento-publico.controller';
import { ConsentimentoPublicoService } from './consentimento-publico.service';
import { ConviteConsentimentoController } from './convite-consentimento.controller';
import { ConviteConsentimentoService } from './convite-consentimento.service';
import { CONVITE_CONFIG, lerConfigConvite } from './convite.config';

// PrismaModule e global. A config (NOTTA_APP_URL, NOTTA_TERMO_REVISADO) e validada no boot
// (falha fechada): o provider e criado quando o app sobe.
@Module({
  imports: [AuditoriaModule, ConsentimentoModule],
  controllers: [ConviteConsentimentoController, ConsentimentoPublicoController],
  providers: [
    { provide: CONVITE_CONFIG, useFactory: () => lerConfigConvite() },
    ConviteConsentimentoService,
    ConsentimentoPublicoService,
  ],
})
export class ConviteConsentimentoModule {}
