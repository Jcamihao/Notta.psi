import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Aparar, Bytes } from '../comum/validacao';
import { LimiteLogin } from '../limite-tentativas/limite-tentativas.guard';
import { AuthService } from './auth.service';
import {
  Publico,
  UsuarioAtual,
  type UsuarioAutenticado,
} from './jwt-auth.guard';

// Sem IsEmail aqui: e-mail mal formado cai no mesmo 401 de credencial errada.
class LoginDto {
  @Aparar()
  @IsString()
  @MaxLength(254)
  email!: string;

  @Bytes(1, 72)
  senha!: string;
}

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @LimiteLogin()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.senha);
  }

  @Get('eu')
  eu(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.auth.eu(usuario);
  }
}
