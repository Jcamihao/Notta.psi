import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';

export function configurarApp(app: NestExpressApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.disable('x-powered-by');

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
}
