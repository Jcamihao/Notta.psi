import { LoggerService, Type } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configurarApp, OPCOES_APP } from '../src/configurar-app';
import { LimiteTentativasGuard } from '../src/limite-tentativas/limite-tentativas.guard';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { apagarClinicas as apagarClinicasComoOwner } from './acesso-owner';

// Env de teste EXPLICITA (nao depende de .env). Valores fixos so de teste, nao sao segredo.
// Se ja exportadas, valem as exportadas.
process.env.NOTTA_MASTER_KEY ||= 'e2e0'.repeat(16);
process.env.NOTTA_JWT_SECRET ||= 'segredo-jwt-so-de-teste-e2e-'.repeat(2);

// App completo (AppModule + configurarApp), igual ao main.ts.
// `controllers`: controllers SO de teste, somados ao AppModule.
// `tenant`: troca o TenantPrismaService (ex.: banco/pool forcado a falhar).
export async function criarApp(
  opcoes: {
    semLimite?: boolean;
    logger?: LoggerService;
    controllers?: Type[];
    tenant?: object;
  } = {},
) {
  let b = Test.createTestingModule({
    imports: [AppModule],
    controllers: opcoes.controllers,
  });
  if (opcoes.tenant) {
    b = b.overrideProvider(TenantPrismaService).useValue(opcoes.tenant);
  }
  if (opcoes.semLimite) {
    b = b
      .overrideGuard(LimiteTentativasGuard)
      .useValue({ canActivate: () => true });
  }
  const app = (await b.compile()).createNestApplication<NestExpressApplication>(
    { ...OPCOES_APP, ...(opcoes.logger && { logger: opcoes.logger }) },
  );
  configurarApp(app);
  await app.init();
  return app;
}

// Para suites que NAO testam limite de tentativas (guards de throttle desligados).
export function criarAppSemLimite(
  opcoes: { logger?: LoggerService; controllers?: Type[] } = {},
) {
  return criarApp({ ...opcoes, semLimite: true });
}

// Limpeza como notta_owner: o notta_app nao tem DELETE em Psicologo/Clinica (M-2).
// `_app` fica so pela assinatura que as suites ja usam; nao e usado.
export function apagarClinicas(_app: unknown, ids: string[]) {
  return apagarClinicasComoOwner(ids);
}

export function corpoClinica(email: string, extra: object = {}) {
  return {
    nomeClinica: 'Clinica Teste',
    nomePsicologo: 'Ana Teste',
    email,
    senha: 'senha-forte-123',
    abordagemPadrao: 'TCC',
    ...extra,
  };
}
