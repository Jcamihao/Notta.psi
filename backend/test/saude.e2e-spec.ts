import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';

async function criar(prisma?: Partial<PrismaService>) {
  let b = Test.createTestingModule({ imports: [AppModule] });
  if (prisma) b = b.overrideProvider(PrismaService).useValue(prisma);
  const app = (
    await b.compile()
  ).createNestApplication<NestExpressApplication>();
  configurarApp(app);
  await app.init();
  return app;
}

describe('GET /saude', () => {
  it('200 {status:ok} com banco real', async () => {
    const app = await criar();
    const res = await request(app.getHttpServer()).get('/saude').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    await app.close();
  });

  it('503 {status:indisponivel} sem detalhe quando o banco falha', async () => {
    const app = await criar({
      $queryRaw: (() =>
        Promise.reject(new Error('senha secreta no erro'))) as never,
    });
    const res = await request(app.getHttpServer()).get('/saude').expect(503);
    expect(res.body).toEqual({ status: 'indisponivel' });
    expect(JSON.stringify(res.body)).not.toContain('secreta');
    await app.close();
  });
});
