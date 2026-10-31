import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

// Pool de conexoes (P2024) ou transacao interativa (P2028) esgotados sob carga, DEPOIS do
// guard (que ja trata o dele): 503 com corpo fixo + Retry-After, sem detalhe e sem log
// (a mensagem do Prisma pode trazer argumentos da query). Outros erros do Prisma seguem o
// filtro padrao do Nest (500 generico).
const ESGOTADO = new Set(['P2024', 'P2028']);

@Catch(Prisma.PrismaClientKnownRequestError)
export class BancoIndisponivelFilter extends BaseExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    if (!ESGOTADO.has(e.code)) return super.catch(e, host);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(503)
      .header('Retry-After', '2')
      .json({ statusCode: 503, message: 'Servico indisponivel' });
  }
}
