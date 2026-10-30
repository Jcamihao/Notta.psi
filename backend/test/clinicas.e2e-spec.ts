import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';

const sufixo = randomUUID().slice(0, 8);
const email = (n: string) => `${n}-${sufixo}@teste.local`;
const UUID = /^[0-9a-f-]{36}$/;

let app: NestExpressApplication;
let tenant: TenantPrismaService;
const criadas: string[] = [];

async function cadastrar(corpo: object) {
  const res = await request(app.getHttpServer()).post('/clinicas').send(corpo);
  if (res.status === 201) {
    criadas.push((res.body as { clinicaId: string }).clinicaId);
  }
  return res;
}

beforeAll(async () => {
  app = await criarAppSemLimite();
  tenant = app.get(TenantPrismaService);
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

afterEach(() => jest.restoreAllMocks());

describe('POST /clinicas', () => {
  it('201 cria clinica + psicologo ADMIN; hash bcrypt custo 12; resposta sem senha/hash', async () => {
    const corpo = corpoClinica(`  ${email('Ok').toUpperCase()}  `, {
      nomeClinica: '  Clinica Sol  ',
      nomePsicologo: '  Ana  ',
    });
    const res = await cadastrar(corpo);
    expect(res.status).toBe(201);
    const body = res.body as { clinicaId: string; psicologoId: string };
    expect(Object.keys(body).sort()).toEqual(['clinicaId', 'psicologoId']);
    expect(body.clinicaId).toMatch(UUID);
    expect(body.psicologoId).toMatch(UUID);
    expect(JSON.stringify(res.body)).not.toContain(corpo.senha);
    expect(JSON.stringify(res.body)).not.toContain('$2');

    const salvo = await tenant.run(body.clinicaId, (tx) =>
      tx.psicologo.findFirst({
        where: { id: body.psicologoId, clinicaId: body.clinicaId },
        include: { clinica: true },
      }),
    );
    expect(salvo).not.toBeNull();
    expect(salvo!.papel).toBe('ADMIN');
    expect(salvo!.email).toBe(email('ok'));
    expect(salvo!.nome).toBe('Ana');
    expect(salvo!.clinica.nome).toBe('Clinica Sol');
    expect(salvo!.senhaHash.startsWith('$2')).toBe(true);
    expect(bcrypt.getRounds(salvo!.senhaHash)).toBe(12);
    expect(await bcrypt.compare(corpo.senha, salvo!.senhaHash)).toBe(true);
  });

  it('e-mail duplicado (igual e com caixa/espacos diferentes) -> 409 do contrato', async () => {
    expect((await cadastrar(corpoClinica(email('dup')))).status).toBe(201);
    for (const variante of [email('dup'), `  ${email('DUP').toUpperCase()} `]) {
      const res = await cadastrar(corpoClinica(variante));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        statusCode: 409,
        message: 'E-mail ja cadastrado',
      });
    }
  });

  it('transacao unica: se o psicologo falha, a Clinica nao fica no banco', async () => {
    expect((await cadastrar(corpoClinica(email('rb')))).status).toBe(201);
    const spy = jest.spyOn(tenant, 'run');
    const res = await cadastrar(corpoClinica(email('rb'))); // 2a insercao (psicologo) falha
    expect(res.status).toBe(409);
    const idTentado = spy.mock.calls[0][0];
    spy.mockRestore();
    const restantes = await tenant.run(idTentado, (tx) =>
      tx.clinica.count({ where: { id: idTentado } }),
    );
    expect(restantes).toBe(0);
  });

  it('erro inesperado -> 500 generico, sem detalhe', async () => {
    jest
      .spyOn(tenant, 'run')
      .mockRejectedValue(new Error('detalhe-secreto-do-banco'));
    const res = await cadastrar(corpoClinica(email('erro')));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secreto');
  });

  it('senha: 72 bytes ok; 73 bytes, 40 emojis e 7 bytes -> 400', async () => {
    const ok = await cadastrar(
      corpoClinica(email('s72'), { senha: 'a'.repeat(72) }),
    );
    expect(ok.status).toBe(201);
    for (const [i, senha] of [
      'a'.repeat(73),
      '😀'.repeat(40),
      'a'.repeat(7),
    ].entries()) {
      const res = await cadastrar(corpoClinica(email(`sx${i}`), { senha }));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(senha);
    }
  });

  it.each([
    ['campo extra', { extra: 1 }],
    ['papel no corpo', { papel: 'ADMIN' }],
    ['abordagem invalida', { abordagemPadrao: 'XYZ' }],
    ['nome da clinica so espacos', { nomeClinica: '   ' }],
    ['nome do psicologo com 121', { nomePsicologo: 'a'.repeat(121) }],
    ['e-mail invalido', { email: 'nao-e-email' }],
    [
      'e-mail com 257',
      {
        email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(60)}.com`,
      },
    ],
  ])('400: %s', async (_nome, extra) => {
    const res = await cadastrar(corpoClinica(email('inv'), extra));
    expect(res.status).toBe(400);
  });
});
