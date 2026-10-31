import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { BancoIndisponivelFilter } from './prisma/banco-indisponivel.filter';

// A API e so JSON: sem os parsers padrao do Nest (json + urlencoded). main.ts e TODO teste que
// cria o app passam isto, e configurarApp registra so o json.
export const OPCOES_APP = { bodyParser: false } as const;

// JSON muito aninhado estoura a pilha (ValidationPipe recursivo = 500). Conta a profundidade
// de [ e { fora de strings ANTES do JSON.parse; acima do teto = 400. O(n), sem alocar.
const PROFUNDIDADE_MAXIMA = 32;
export function profundidadeExcede(buf: Buffer, max = PROFUNDIDADE_MAXIMA) {
  let nivel = 0;
  let emString = false;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (emString) {
      if (c === 0x5c)
        i++; // \ escapa o proximo byte
      else if (c === 0x22) emString = false;
    } else if (c === 0x22) emString = true;
    else if (c === 0x5b || c === 0x7b) {
      if (++nivel > max) return true;
    } else if (c === 0x5d || c === 0x7d) nivel--;
  }
  return false;
}

const CORPO_400 = {
  statusCode: 400,
  message: 'JSON invalido',
  error: 'Bad Request',
};
const CORPO_415_CHARSET = {
  statusCode: 415,
  message: 'Use application/json com charset utf-8',
  error: 'Unsupported Media Type',
};
// Qualquer parametro charset que nao seja utf-8 (o body-parser aceitaria utf-16* e
// decodificaria DEPOIS do verify de profundidade, que conta bytes). Todos os charset do
// cabecalho valem: o `content-type` do body-parser fica com o ultimo.
const charsetRecusado = (contentType = '') =>
  [...contentType.matchAll(/;\s*charset\s*=\s*"?([^";]*)"?/gi)].some(
    (m) => m[1].trim().toLowerCase() !== 'utf-8',
  );

const CORPO_413 = {
  statusCode: 413,
  message: 'Corpo muito grande',
  error: 'Payload Too Large',
};

export function configurarApp(app: NestExpressApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new BancoIndisponivelFilter(app.getHttpAdapter()));
  app.disable('x-powered-by');
  app.use(helmet());
  // So JSON em utf-8 (outro charset = 415, antes do parser), ate 256 kb (acima = 413),
  // profundidade ate 32.
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.is('json') && charsetRecusado(req.headers['content-type'])
      ? res.status(415).json(CORPO_415_CHARSET)
      : next(),
  );
  app.useBodyParser('json', {
    limit: '256kb',
    verify: (_req: unknown, _res: unknown, buf: Buffer) => {
      if (profundidadeExcede(buf)) throw new Error('JSON profundo demais');
    },
  });
  // Corpo que nao e JSON (form, texto...) nao foi lido por parser nenhum: 415, nunca processado.
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.body === undefined &&
    (Number(req.headers['content-length'] ?? 0) > 0 ||
      req.headers['transfer-encoding'] !== undefined)
      ? res.status(415).json({
          statusCode: 415,
          message: 'Use application/json',
          error: 'Unsupported Media Type',
        })
      : next(),
  );
  // Todo erro do body-parser (tem `type`, ou status 4xx como o de descompressao, que nao tem
  // `type`): corpo FIXO, sem log e sem stack. A mensagem original pode trazer trecho do corpo
  // (senha). 413 continua 413; o resto vira 400. Erro de rota nao chega aqui (filtro do Nest).
  app.use(
    (
      err: { type?: unknown; status?: number },
      _req: unknown,
      res: Response,
      next: NextFunction,
    ) => {
      const status = Number(err?.status);
      const doParser =
        typeof err?.type === 'string' || (status >= 400 && status < 500);
      if (!doParser) return next(err);
      if (err.status === 413) return res.status(413).json(CORPO_413);
      return res.status(400).json(CORPO_400);
    },
  );

  // Saltos de proxy confiaveis. Nunca ecoar o valor.
  // Obrigatoria em qualquer ambiente, salvo NODE_ENV (aparado, sem caixa) development ou test:
  // atras de proxy sem ela, todo mundo divide o IP do proxy (20 logins errados travam o login
  // de todos). `0` = sem proxy, dito explicitamente. NODE_ENV ausente (imagem Docker) ou
  // "Production" exigem a variavel.
  const proxy = process.env.NOTTA_TRUST_PROXY;
  const ambiente = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  if (
    proxy === undefined &&
    ambiente !== 'development' &&
    ambiente !== 'test'
  ) {
    throw new Error(
      'NOTTA_TRUST_PROXY obrigatoria (salvo NODE_ENV=development ou test): informe o numero de saltos de proxy confiaveis (0 = sem proxy)',
    );
  }
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
