import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { criarAppSemLimite } from './criar-app-sem-limite';

// App completo como no main.ts (OPCOES_APP): a API e so JSON.
let app: NestExpressApplication;
beforeAll(async () => {
  app = await criarAppSemLimite();
});
afterAll(() => app.close());

describe('corpo da requisicao', () => {
  it('POST /auth/login com form urlencoded -> 415, login nunca processado', async () => {
    const login = jest.spyOn(app.get(AuthService), 'login');
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .type('form')
      .send('email=a%40b.com&senha=senha-forte-123');
    expect(res.status).toBe(415);
    expect(login).not.toHaveBeenCalled();
    login.mockRestore();
  });

  it('POST /auth/login com JSON de 100 mil niveis -> 400 fixo (antes: 500 + stack no log)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('['.repeat(100_000) + ']'.repeat(100_000))
      .expect(400);
    expect(res.body).toEqual({
      statusCode: 400,
      message: 'JSON invalido',
      error: 'Bad Request',
    });
  });

  // M-1: o contador de profundidade le BYTES; em UTF-16 o `∀` tem o byte 0x22 e o enganava.
  it.each(['utf-16le', 'utf-16be', 'utf-16'])(
    'POST /auth/login com corpo do review em %s -> 415 fixo (antes: 500 + stack no log)',
    async (charset) => {
      const json = `{"email":"\u2200","senha":${'['.repeat(5000)}${']'.repeat(5000)}}`;
      let corpo = Buffer.from(json, 'utf16le');
      if (charset === 'utf-16be') corpo = corpo.swap16();
      if (charset === 'utf-16') {
        corpo = Buffer.concat([Buffer.from([0xff, 0xfe]), corpo]);
      }
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await request(app.getHttpServer())
          .post('/auth/login')
          .set('Content-Type', `application/json; charset=${charset}`)
          .serialize((b: Buffer) => b as unknown as string)
          .send(corpo as unknown as string)
          .expect(415);
        expect(res.body).toEqual({
          statusCode: 415,
          message: 'Use application/json com charset utf-8',
          error: 'Unsupported Media Type',
        });
        expect(erro).not.toHaveBeenCalled();
      } finally {
        erro.mockRestore();
      }
    },
  );
});
