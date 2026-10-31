import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Aparar, Bytes } from '../comum/validacao';
import {
  LimiteLogin,
  LimiteTrocarSenha,
} from '../limite-tentativas/limite-tentativas.guard';
import { AuthService } from './auth.service';
import { TetoHash } from './teto-hash';
import {
  PermiteSenhaProvisoria,
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

// Sem aparar: espaco na senha e intencional. Campos extras (ex.: psicologoId) = 400:
// so a conta do token muda.
class TrocarSenhaDto {
  @Bytes(1, 72)
  senhaAtual!: string;

  @Bytes(8, 72)
  novaSenha!: string;
}

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @LimiteLogin()
  @TetoHash()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.senha);
  }

  @PermiteSenhaProvisoria()
  @LimiteTrocarSenha()
  @TetoHash()
  @Post('auth/trocar-senha')
  @HttpCode(200)
  trocarSenha(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: TrocarSenhaDto,
  ) {
    return this.auth.trocarSenha(usuario, dto.senhaAtual, dto.novaSenha);
  }

  @PermiteSenhaProvisoria()
  @Get('eu')
  eu(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.auth.eu(usuario);
  }
}
