import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { opcoesJwt } from './jwt.config';

@Module({
  // registerAsync: o segredo e lido e validado ao subir o app (boot), nao no import.
  imports: [JwtModule.registerAsync({ useFactory: () => opcoesJwt() })],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
