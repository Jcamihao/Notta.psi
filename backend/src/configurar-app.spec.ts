import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { configurarApp } from './configurar-app';

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
}

@Module({ controllers: [CtrlTeste] })
class ModTeste {}

async function criar() {
  const mod = await Test.createTestingModule({ imports: [ModTeste] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  configurarApp(app);
  await app.init();
  return app;
}

describe('configurarApp', () => {
  const original = process.env.NOTTA_TRUST_PROXY;
  const corsOriginal = process.env.NOTTA_CORS_ORIGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.NOTTA_TRUST_PROXY;
    else process.env.NOTTA_TRUST_PROXY = original;
    if (corsOriginal === undefined) delete process.env.NOTTA_CORS_ORIGIN;
    else process.env.NOTTA_CORS_ORIGIN = corsOriginal;
  });

  it.each(['abc', '-1', '1.5', '1 ', ''])(
    'NOTTA_TRUST_PROXY invalido %j lanca sem ecoar o valor',
    async (valor) => {
      process.env.NOTTA_TRUST_PROXY = valor;
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
      expect(msg).toMatch(/NOTTA_TRUST_PROXY/);
      if (valor.trim() !== '') expect(msg).not.toContain(valor);
    },
  );

  it.each(['0', '1', '2'])('NOTTA_TRUST_PROXY=%s ok', async (valor) => {
    process.env.NOTTA_TRUST_PROXY = valor;
    const app = await criar();
    expect(express(app).get('trust proxy')).toBe(Number(valor));
    await app.close();
  });

  it('sem NOTTA_TRUST_PROXY o trust proxy fica desligado', async () => {
    delete process.env.NOTTA_TRUST_PROXY;
    const app = await criar();
    expect(express(app).get('trust proxy')).toBeFalsy();
    await app.close();
  });

  it('nao envia x-powered-by', async () => {
    delete process.env.NOTTA_TRUST_PROXY;
    const app = await criar();
    const res = await request(app.getHttpServer()).get('/ping').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });

  it('ValidationPipe recusa campo extra e aceita o valido', async () => {
    delete process.env.NOTTA_TRUST_PROXY;
    const app = await criar();
    const http = app.getHttpServer();
    await request(http).post('/dto').send({ nome: 'a', extra: 1 }).expect(400);
    await request(http).post('/dto').send({ nome: 'a' }).expect(201);
    await app.close();
  });

  it('helmet: headers de seguranca presentes', async () => {
    delete process.env.NOTTA_TRUST_PROXY;
    const app = await criar();
    const res = await request(app.getHttpServer()).get('/ping').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });

  it('CORS: sem NOTTA_CORS_ORIGIN nao envia access-control-allow-origin', async () => {
    delete process.env.NOTTA_CORS_ORIGIN;
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

  it('CORS: com NOTTA_CORS_ORIGIN responde so para a origem exata', async () => {
    process.env.NOTTA_CORS_ORIGIN = 'https://app.exemplo.com';
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
  ])('NOTTA_CORS_ORIGIN invalida %j derruba sem ecoar', async (valor) => {
    process.env.NOTTA_CORS_ORIGIN = valor;
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
    expect(msg).toMatch(/NOTTA_CORS_ORIGIN/);
    if (valor.length > 1) expect(msg).not.toContain(valor);
  });

  it('corpo JSON: 200 kb passa, 300 kb -> 413', async () => {
    delete process.env.NOTTA_TRUST_PROXY;
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
    delete process.env.NOTTA_TRUST_PROXY;
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
});
