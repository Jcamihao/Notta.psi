import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LimiteApiGuard } from '../limite-tentativas/limite-tentativas.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { opcoesJwt } from './jwt.config';
import { PapeisGuard } from './papeis';

@Module({
  // registerAsync: o segredo e lido e validado ao subir o app (boot), nao no import.
  imports: [JwtModule.registerAsync({ useFactory: () => opcoesJwt() })],
  controllers: [AuthController],
  // Guards globais rodam NA ORDEM desta lista: JWT (401), limite `api` por psicologo
  // (precisa do req.user do JWT), papeis (403).
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: LimiteApiGuard },
    { provide: APP_GUARD, useClass: PapeisGuard },
  ],
})
export class AuthModule {}
