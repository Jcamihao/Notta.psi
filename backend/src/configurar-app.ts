import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Response } from 'express';
import helmet from 'helmet';

export function configurarApp(app: NestExpressApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.disable('x-powered-by');
  app.use(helmet());
  // Limite do corpo JSON (acima = 413). Substitui o parser padrao de 100 kb.
  app.useBodyParser('json', { limit: '256kb' });
  // JSON malformado: a mensagem do V8 traz um trecho do corpo (pode ser a senha). Resposta fixa.
  app.use(
    (
      err: { type?: string },
      _req: unknown,
      res: Response,
      next: NextFunction,
    ) =>
      err?.type === 'entity.parse.failed'
        ? res.status(400).json({
            statusCode: 400,
            message: 'JSON invalido',
            error: 'Bad Request',
          })
        : next(err),
  );

  // Saltos de proxy confiaveis. Ausente = desligado. Nunca ecoar o valor.
  const proxy = process.env.NOTTA_TRUST_PROXY;
  if (proxy !== undefined) {
    if (!/^\d+$/.test(proxy) || !Number.isSafeInteger(Number(proxy))) {
      throw new Error(
        'NOTTA_TRUST_PROXY invalida: use inteiro >= 0 (numero de saltos)',
      );
    }
    app.set('trust proxy', Number(proxy));
  }

  // CORS so com UMA origem exata. Ausente = desligado (o front usa proxy, mesma origem).
  // Lista com 1 item: o cors compara a origem recebida e so responde se for igual
  // (nunca `*`, nunca reflete outra origem). Nunca ecoar o valor.
  const origem = process.env.NOTTA_CORS_ORIGIN;
  if (origem !== undefined) {
    if (!origemValida(origem)) {
      throw new Error(
        'NOTTA_CORS_ORIGIN invalida: use UMA origem exata (esquema://host[:porta], sem barra no fim)',
      );
    }
    app.enableCors({ origin: [origem] });
  }
}

function origemValida(valor: string): boolean {
  try {
    const url = new URL(valor);
    return /^https?:$/.test(url.protocol) && url.origin === valor;
  } catch {
    return false;
  }
}
