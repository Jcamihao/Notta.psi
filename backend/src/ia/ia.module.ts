import { Module } from '@nestjs/common';
import { IA_CONFIG, lerConfigIa } from './ia.config';
import { SelahIaClient } from './selahia.client';

// Sem rota. Importado no AppModule para a config ser validada no boot (falha fechada).
@Module({
  providers: [
    { provide: IA_CONFIG, useFactory: () => lerConfigIa() },
    SelahIaClient,
  ],
  exports: [SelahIaClient, IA_CONFIG],
})
export class IaModule {}
