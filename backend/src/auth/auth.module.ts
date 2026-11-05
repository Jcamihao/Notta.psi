import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { ORIGENS_PERMITIDAS, origensPermitidas } from '../comum/origens';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { opcoesJwt } from './jwt.config';
import { PapeisGuard } from './papeis';
import { SessaoService } from './sessao.service';

@Module({
  // registerAsync: o segredo e lido e validado ao subir o app (boot), nao no import.
  imports: [
    JwtModule.registerAsync({ useFactory: () => opcoesJwt() }),
    AuditoriaModule,
  ],
  controllers: [AuthController],
  // Guards globais rodam NA ORDEM desta lista: CSRF (403, antes de qualquer banco), JWT (401; conta
  // tambem o limite `api` e o teto de simultaneas por psicologo, antes do banco), papeis (403).
  providers: [
    AuthService,
    SessaoService,
    // Fabrica: origem invalida ou ausente em producao derruba o boot (falha fechada).
    { provide: ORIGENS_PERMITIDAS, useFactory: () => origensPermitidas() },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PapeisGuard },
  ],
})
export class AuthModule {}
