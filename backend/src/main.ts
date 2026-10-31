import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configurarApp, OPCOES_APP } from './configurar-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    OPCOES_APP,
  );
  configurarApp(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
