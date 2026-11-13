import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { configurarApp, OPCOES_APP } from './configurar-app';

const express = (app: NestExpressApplication) =>
  app.getHttpAdapter().getInstance();

class DtoTeste {
  @IsString()
  nome!: string;
}

@Controller()
class CtrlTeste {
  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Post('dto')
  dto(@Body() b: DtoTeste) {
    return b;
  }

  // Corpo livre (sem DTO): so o parser decide.
  @Post('livre')
  livre(@Body() b: unknown) {
    chamadasLivre++;
    return { recebido: typeof b };
  }
}

let chamadasLivre = 0;

@Module({ controllers: [CtrlTeste] })
class ModTeste {}

async function criar() {
  const mod = await Test.createTestingModule({ imports: [ModTeste] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>(OPCOES_APP);
  configurarApp(app);
  await app.init();
  return app;
}

const CORPO_413_ESPERADO = {
  statusCode: 413,
  message: 'Corpo muito grande',
  error: 'Payload Too Large',
};

const aninhado = (n: number) => '['.repeat(n) + ']'.repeat(n);

describe('configurarApp', () => {
  const original = process.env.PRAXIS_TRUST_PROXY;
  const corsOriginal = process.env.PRAXIS_CORS_ORIGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.PRAXIS_TRUST_PROXY;
    else process.env.PRAXIS_TRUST_PROXY = original;
    if (corsOriginal === undefined) delete process.env.PRAXIS_CORS_ORIGIN;
    else process.env.PRAXIS_CORS_ORIGIN = corsOriginal;
  });

  it.each(['abc', '-1', '1.5', '1 ', ''])(
    'PRAXIS_TRUST_PROXY invalido %j lanca sem ecoar o valor',
    async (valor) => {
      process.env.PRAXIS_TRUST_PROXY = valor;
      const mod = await Test.createTestingModule({
        imports: [ModTeste],
      }).compile();
      const app = mod.createNestApplication<NestExpressApplication>();
      let msg = '';
      try {
        configurarApp(app);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/PRAXIS_TRUST_PROXY/);
      if (valor.trim() !== '') expect(msg).not.toContain(valor);
    },
  );

  it.each(['0', '1', '2'])('PRAXIS_TRUST_PROXY=%s ok', async (valor) => {
    process.env.PRAXIS_TRUST_PROXY = valor;
    const app = await criar();
    expect(express(app).get('trust proxy')).toBe(Number(valor));
    await app.close();
  });

  it('sem PRAXIS_TRUST_PROXY o trust proxy fica desligado', async () => {
    delete process.env.PRAXIS_TRUST_PROXY;
    const app = await criar();
    expect(express(app).get('trust proxy')).toBeFalsy();
    await app.close();
  });

  it('nao envia x-powered-by', async () => {
    delete process.env.PRAXIS_TRUST_PROXY;
    const app = await criar();
    const res = await request(app.getHttpServer()).get('/ping').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });

  it('ValidationPipe recusa campo extra e aceita o valido', async () => {
    delete process.env.PRAXIS_TRUST_PROXY;
    const app = await criar();
    const http = app.getHttpServer();
    await request(http).post('/dto').send({ nome: 'a', extra: 1 }).expect(400);
    await request(http).post('/dto').send({ nome: 'a' }).expect(201);
    await app.close();
  });

  it('helmet: headers de seguranca presentes', async () => {
    delete process.env.PRAXIS_TRUST_PROXY;
    const app = await criar();
    const res = await request(app.getHttpServer()).get('/ping').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });

  it('CORS: sem PRAXIS_CORS_ORIGIN nao envia access-control-allow-origin', async () => {
    delete process.env.PRAXIS_CORS_ORIGIN;
    const app = await criar();
    const http = app.getHttpServer();
    const res = await request(http)
      .get('/ping')
      .set('Origin', 'https://app.exemplo.com')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await request(http)
      .options('/dto')
      .set('Origin', 'https://app.exemplo.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('CORS: com PRAXIS_CORS_ORIGIN responde so para a origem exata', async () => {
    process.env.PRAXIS_CORS_ORIGIN = 'https://app.exemplo.com';
    const app = await criar();
    const http = app.getHttpServer();
    const certa = await request(http)
      .get('/ping')
      .set('Origin', 'https://app.exemplo.com');
    expect(certa.headers['access-control-allow-origin']).toBe(
      'https://app.exemplo.com',
    );
    for (const outra of [
      'https://evil.com',
      'https://app.exemplo.com.evil.com',
      'http://app.exemplo.com',
    ]) {
      const res = await request(http).get('/ping').set('Origin', outra);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    const pre = await request(http)
      .options('/dto')
      .set('Origin', 'https://evil.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it.each([
    '*',
    'https://app.exemplo.com/',
    'app.exemplo.com',
    'https://a.com,https://b.com',
    'ftp://app.exemplo.com',
    'https://app.exemplo.com/caminho',
    '',
  ])('PRAXIS_CORS_ORIGIN invalida %j derruba sem ecoar', async (valor) => {
    process.env.PRAXIS_CORS_ORIGIN = valor;
    const mod = await Test.createTestingModule({
      imports: [ModTeste],
    }).compile();
    const app = mod.createNestApplication<NestExpressApplication>();
    let msg = '';
    try {
      configurarApp(app);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/PRAXIS_CORS_ORIGIN/);
    if (valor.length > 1) expect(msg).not.toContain(valor);
  });

  it('corpo JSON: 200 kb passa, 300 kb -> 413', async () => {
    delete process.env.PRAXIS_TRUST_PROXY;
    const app = await criar();
    const http = app.getHttpServer();
    await request(http)
      .post('/dto')
      .send({ nome: 'a'.repeat(200 * 1024) })
      .expect(201);
    await request(http)
      .post('/dto')
      .send({ nome: 'a'.repeat(300 * 1024) })
      .expect(413);
    await app.close();
  });

  it('JSON malformado -> 400 generico, sem ecoar trecho do corpo', async () => {
    delete process.env.PRAXIS_TRUST_PROXY;
    const app = await criar();
    const res = await request(app.getHttpServer())
      .post('/dto')
      .set('Content-Type', 'application/json')
      .send('{"nome":"a","senha": SENHA-SECRETA-123}')
      .expect(400);
    expect(res.body).toEqual({
      statusCode: 400,
      message: 'JSON invalido',
      error: 'Bad Request',
    });
    await app.close();
  });

  it('profundidade: 32 niveis passa; 33 e 100 mil niveis -> 400 fixo (nunca 500)', async () => {
    const app = await criar();
    const http = app.getHttpServer();
    const post = (corpo: string) =>
      request(http)
        .post('/livre')
        .set('Content-Type', 'application/json')
        .send(corpo);
    await post(`{"a":${aninhado(31)}}`).expect(201);
    // Colchete dentro de string nao conta.
    await post(`{"a":"${'['.repeat(100)}","b":${aninhado(31)}}`).expect(201);
    for (const corpo of [`{"a":${aninhado(32)}}`, aninhado(100_000)]) {
      const res = await post(corpo).expect(400);
      expect(res.body).toEqual({
        statusCode: 400,
        message: 'JSON invalido',
        error: 'Bad Request',
      });
    }
    await app.close();
  });

  it('erros do body-parser: corpo fixo e nenhum log (413, descompressao)', async () => {
    const env = process.env.NODE_ENV;
    // Fora de "test" o express loga o stack de erro nao tratado: e o que nao pode acontecer.
    process.env.NODE_ENV = 'development';
    const erro = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = await criar();
      const http = app.getHttpServer();
      const grande = await request(http)
        .post('/livre')
        .send({ nome: 'a'.repeat(300 * 1024) })
        .expect(413);
      expect(grande.body).toEqual(CORPO_413_ESPERADO);
      const fixo400 = {
        statusCode: 400,
        message: 'JSON invalido',
        error: 'Bad Request',
      };
      const gzipQuebrado = await request(http)
        .post('/livre')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send('nao-e-gzip')
        .expect(400);
      expect(gzipQuebrado.body).toEqual(fixo400);
      // gzip valido mas que descomprime acima do limite: 413 fixo.
      const bomba = await request(http)
        .post('/livre')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        // sem serialize o superagent manda o Buffer como JSON ({"type":"Buffer",...})
        .serialize((b: Buffer) => b as unknown as string)
        .send(gzipSync(`{"a":"${'x'.repeat(400 * 1024)}"}`))
        .expect(413);
      expect(bomba.body).toEqual(CORPO_413_ESPERADO);
      await app.close();
      expect(erro).not.toHaveBeenCalled();
    } finally {
      erro.mockRestore();
      process.env.NODE_ENV = env;
    }
  });

  describe('M-1: JSON so em utf-8 (outro charset = 415 fixo, antes de contar profundidade)', () => {
    const CORPO_415 = {
      statusCode: 415,
      message: 'Use application/json com charset utf-8',
      error: 'Unsupported Media Type',
    };
    // Corpo do review: o `∀` em UTF-16 tem o byte 0x22, que enganava o contador de profundidade.
    const corpoReview = `{"email":"\u2200","senha":${'['.repeat(5000)}${']'.repeat(5000)}}`;
    const bom = Buffer.from([0xff, 0xfe]);
    const enviar = (
      app: NestExpressApplication,
      tipo: string,
      corpo: Buffer | string,
    ) =>
      request(app.getHttpServer())
        .post('/livre')
        .set('Content-Type', tipo)
        // sem serialize o superagent manda o Buffer como JSON
        .serialize((b: Buffer) => b as unknown as string)
        .send(corpo as string);

    it.each([
      [
        'utf-16le',
        'application/json; charset=utf-16le',
        Buffer.from(corpoReview, 'utf16le'),
      ],
      [
        'utf-16be',
        'application/json; charset=utf-16be',
        Buffer.from(corpoReview, 'utf16le').swap16(),
      ],
      [
        'utf-16 com BOM',
        'application/json; charset=utf-16',
        Buffer.concat([bom, Buffer.from(corpoReview, 'utf16le')]),
      ],
      ['latin1', 'application/json; charset=latin1', Buffer.from('{"a":"x"}')],
      [
        'iso-8859-1 entre aspas',
        'application/json; charset="iso-8859-1"',
        Buffer.from('{}'),
      ],
      ['utf-8x', 'application/json; charset=utf-8x', Buffer.from('{}')],
      [
        'utf8 (o body-parser nao o aceita)',
        'application/json; charset=utf8',
        Buffer.from('{}'),
      ],
      [
        'dois charset, o ruim por ultimo',
        'application/json; charset=utf-8; charset=utf-16le',
        Buffer.from('{}'),
      ],
      [
        'tipo em maiusculas',
        'APPLICATION/JSON; CHARSET=UTF-16LE',
        Buffer.from('{}'),
      ],
    ])(
      '%s -> 415 fixo, handler nao roda, nenhum log',
      async (_n, tipo, corpo) => {
        const env = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development'; // fora de "test" o express loga o stack
        const erro = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const app = await criar();
          const antes = chamadasLivre;
          const res = await enviar(app, tipo, corpo).expect(415);
          expect(res.body).toEqual(CORPO_415);
          expect(chamadasLivre).toBe(antes);
          await app.close();
          expect(erro).not.toHaveBeenCalled();
        } finally {
          erro.mockRestore();
          process.env.NODE_ENV = env;
        }
      },
    );

    it.each([
      'application/json',
      'application/json; charset=utf-8',
      'application/json; charset=UTF-8',
      'application/json; charset="utf-8"',
    ])('%s passa', async (tipo) => {
      const app = await criar();
      await enviar(app, tipo, '{"a":1}').expect(201);
      await app.close();
    });
  });

  it('so JSON: form urlencoded nunca e processado (400 ou 415)', async () => {
    const app = await criar();
    const antes = chamadasLivre;
    const res = await request(app.getHttpServer())
      .post('/livre')
      .type('form')
      .send('email=a%40b.com&senha=senha-forte-123');
    expect([400, 415]).toContain(res.status);
    expect(chamadasLivre).toBe(antes);
    await app.close();
  });

  describe('M-5: PRAXIS_TRUST_PROXY e exigida, salvo NODE_ENV=development ou test', () => {
    const env = process.env.NODE_ENV;
    afterEach(() => {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
    });
    const definir = (v: string | undefined) => {
      if (v === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = v;
    };

    it.each([
      ['production', 'production'],
      ['Production', 'Production'],
      [' production ', ' production '],
      ['ausente', undefined],
      ['vazio', ''],
      ['staging', 'staging'],
      ['devel', 'devel'],
    ])(
      'NODE_ENV %s sem a variavel derruba o boot pedindo o numero de saltos',
      async (_n, valor) => {
        definir(valor);
        delete process.env.PRAXIS_TRUST_PROXY;
        const mod = await Test.createTestingModule({
          imports: [ModTeste],
        }).compile();
        const app =
          mod.createNestApplication<NestExpressApplication>(OPCOES_APP);
        expect(() => configurarApp(app)).toThrow(/PRAXIS_TRUST_PROXY.*saltos/);
        expect(() => configurarApp(app)).toThrow(/0 = sem proxy/);
      },
    );

    it.each(['development', 'test', ' Development ', 'TEST'])(
      'NODE_ENV %j sobe sem a variavel',
      async (valor) => {
        definir(valor);
        delete process.env.PRAXIS_TRUST_PROXY;
        const app = await criar();
        expect(express(app).get('trust proxy')).toBeFalsy();
        await app.close();
      },
    );

    it.each([
      ['production', '0'],
      ['production', '1'],
      [undefined, '0'],
      ['Production', '2'],
    ])('NODE_ENV %s com %s explicito sobe', async (amb, valor) => {
      definir(amb);
      process.env.PRAXIS_TRUST_PROXY = valor;
      const app = await criar();
      expect(express(app).get('trust proxy')).toBe(Number(valor));
      await app.close();
    });
  });
});
