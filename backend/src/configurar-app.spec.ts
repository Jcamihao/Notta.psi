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
  afterEach(() => {
    if (original === undefined) delete process.env.NOTTA_TRUST_PROXY;
    else process.env.NOTTA_TRUST_PROXY = original;
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
});
