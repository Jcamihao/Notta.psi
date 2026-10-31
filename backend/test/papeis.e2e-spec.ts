import { randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { Papeis } from '../src/auth/papeis';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// Controllers SO deste teste (nao existem no AppModule).
@Controller('teste-papeis')
class TestePapeisController {
  @Papeis('ADMIN')
  @Get('admin')
  admin() {
    return { ok: true };
  }

  @Get('livre')
  livre() {
    return { ok: true };
  }
}

const sufixo = randomUUID().slice(0, 8);
const SENHA = 'senha-forte-123';
const emailAdmin = `admin-${sufixo}@teste.local`;
const emailPsi = `psi-${sufixo}@teste.local`;
const FORBIDDEN = {
  statusCode: 403,
  message: 'Forbidden resource',
  error: 'Forbidden',
};

let app: NestExpressApplication;
let clinicaId: string;
let tokenAdmin: string;
let tokenPsi: string;

async function token(email: string) {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, senha: SENHA })
    .expect(200);
  return (res.body as { token: string }).token;
}

const get = (rota: string, t?: string) => {
  const r = request(app.getHttpServer()).get(`/teste-papeis/${rota}`);
  return t ? r.set('Authorization', `Bearer ${t}`) : r;
};

beforeAll(async () => {
  app = await criarAppSemLimite({ controllers: [TestePapeisController] });
  const res = await request(app.getHttpServer())
    .post('/clinicas')
    .send(corpoClinica(emailAdmin, { senha: SENHA }))
    .expect(201);
  clinicaId = (res.body as { clinicaId: string }).clinicaId;
  // Endpoint de equipe e do item 8: PSICOLOGO criado direto no banco (notta_app, dentro de run).
  const senhaHash = await bcrypt.hash(SENHA, 4);
  await app.get(TenantPrismaService).run(clinicaId, (tx) =>
    tx.psicologo.create({
      data: {
        clinicaId,
        email: emailPsi,
        nome: 'Psi Teste',
        senhaHash,
        abordagemPadrao: 'TCC',
        papel: 'PSICOLOGO',
      },
    }),
  );
  tokenAdmin = await token(emailAdmin);
  tokenPsi = await token(emailPsi);
});

afterAll(async () => {
  await apagarClinicas(app, [clinicaId]);
  await app.close();
});

describe("@Papeis('ADMIN') com JWT real", () => {
  it('ADMIN = 200', async () => {
    await get('admin', tokenAdmin).expect(200, { ok: true });
  });

  it('PSICOLOGO = 403 generico, sem citar papeis', async () => {
    const res = await get('admin', tokenPsi).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(JSON.stringify(res.body)).not.toMatch(/ADMIN|PSICOLOGO|papel/i);
  });

  it('sem token = 401 (JwtAuthGuard roda ANTES do PapeisGuard)', async () => {
    await get('admin').expect(401, {
      statusCode: 401,
      message: 'Unauthorized',
    });
    await get('admin', 'lixo').expect(401);
  });

  it('rota sem @Papeis: qualquer autenticado = 200, sem token = 401', async () => {
    await get('livre', tokenAdmin).expect(200);
    await get('livre', tokenPsi).expect(200);
    await get('livre').expect(401);
  });

  it('rota publica existente segue publica', async () => {
    await request(app.getHttpServer()).get('/saude').expect(200);
  });

  it('papel lido do banco a cada requisicao: rebaixar o admin corta na hora', async () => {
    const tenant = app.get(TenantPrismaService);
    const mudar = (papel: 'ADMIN' | 'PSICOLOGO') =>
      tenant.run(clinicaId, (tx) =>
        tx.psicologo.updateMany({
          where: { email: emailAdmin, clinicaId },
          data: { papel },
        }),
      );
    await mudar('PSICOLOGO');
    try {
      await get('admin', tokenAdmin).expect(403);
    } finally {
      await mudar('ADMIN');
    }
    await get('admin', tokenAdmin).expect(200);
  });
});
