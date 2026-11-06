import {
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Abordagem, Prisma } from '@prisma/client';
import { IsEmail, IsEnum, MaxLength } from 'class-validator';
import { Aparar, Bytes } from './validacao';

// Campos comuns a quem cria um psicologo com senha (cadastro de clinica e equipe).
export class NovoPsicologoDto {
  @Aparar()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Sem aparar: espaco na senha e intencional. So o formato aqui (1..72 bytes: o maximo do bcrypt);
  // a politica (10+ caracteres, lista de comuns, etc.) e `exigirSenhaForte`, que responde 422 com
  // motivo, no service.
  @Bytes(1, 72)
  senha!: string;

  @IsEnum(Abordagem)
  abordagemPadrao!: Abordagem;
}

// P2002 (e-mail unico global) -> 409 do contrato. Outro erro -> 500 generico.
// Erro do Prisma pode trazer os argumentos da query (hash, e-mail): loga so o tipo.
export function erroAoCriarPsicologo(
  e: unknown,
  logger: Logger,
  oQue: string,
): Error {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return new ConflictException('E-mail ja cadastrado');
  }
  logger.error(
    `falha ao criar ${oQue}: ${e instanceof Prisma.PrismaClientKnownRequestError ? e.code : (e as Error).name}`,
  );
  return new InternalServerErrorException();
}
