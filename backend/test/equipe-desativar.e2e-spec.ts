import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuditoriaService } from '../src/auditoria/auditoria.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { mudarPapelComoOwner } from './acesso-owner';
import {
  apagarClinicas,
  corpoClinica,
  criarAppSemLimite,
} from './criar-app-sem-limite';

// Item 58 ponta a ponta: ADMIN desativa colega; token cai na hora, login fecha, dados ficam
// guardados sem leitura por ninguem, auditoria na mesma transacao.
const sufixo = randomUUID().slice(0, 8);
const SENHA = 'senha-forte-123';
const SENHA_NOVA = 'senha-definitiva-1';
type Usuario = {
  clinicaId: string;
  psicologoId: string;
  token: string;
  email: string;
};
const FORBIDDEN = {
  statusCode: 403,
  message: 'Forbidden resource',
  error: 'Forbidden',
};

let app: NestExpressApplication;
const criadas: string[] = [];
let n = 0;
const http = () => request(app.getHttpServer());
const com = (token: string | undefined, r: request.Test) =>
  token ? r.set('Authorization', `Bearer ${token}`) : r;
const desativar = (token: string | undefined, id: string) =>
  com(token, http().post(`/psicologos/${id}/desativar`));

async function login(email: string, senha = SENHA) {
  const res = await http()
    .post('/auth/login')
    .send({ email, senha })
    .expect(200);
  return (res.body as { token: string }).token;
}

async function novaClinica(): Promise<Usuario> {
  const email = `d58-admin-${++n}-${sufixo}@teste.local`;
  const res = await http()
    .post('/clinicas')
    .send(corpoClinica(email, { senha: SENHA }))
    .expect(201);
  const { clinicaId, psicologoId } = res.body as {
    clinicaId: string;
    psicologoId: string;
  };
  criadas.push(clinicaId);
  return { clinicaId, psicologoId, email, token: await login(email) };
}

// Colega ja com a senha trocada (senao toda rota daria 403).
async function novoColega(admin: Usuario): Promise<Usuario> {
  const email = `d58-colega-${++n}-${sufixo}@teste.local`;
  const res = await com(admin.token, http().post('/psicologos'))
    .send({ nome: 'Colega', email, senha: SENHA, abordagemPadrao: 'ACT' })
    .expect(201);
  const troca = await com(await login(email), http().post('/auth/trocar-senha'))
    .send({ senhaAtual: SENHA, novaSenha: SENHA_NOVA })
    .expect(200);
  return {
    clinicaId: admin.clinicaId,
    psicologoId: (res.body as { psicologoId: string }).psicologoId,
    email,
    token: (troca.body as { token: string }).token,
  };
}

const tenant = () => app.get(TenantPrismaService);
const linha = (u: Usuario) =>
  tenant().run(u.clinicaId, (tx) =>
    tx.psicologo.findFirstOrThrow({ where: { id: u.psicologoId } }),
  );
const trilhaDesativou = (admin: Usuario) =>
  tenant().runComoUsuario(admin, (tx) =>
    tx.auditoria.findMany({
      where: { acao: 'DESATIVOU' },
      select: { acao: true, recurso: true, recursoId: true, psicologoId: true },
    }),
  );

beforeAll(async () => {
  app = await criarAppSemLimite();
});

afterAll(async () => {
  await apagarClinicas(app, criadas);
  await app.close();
});

describe('POST /psicologos/:id/desativar', () => {
  it('ADMIN desativa colega: 200 com o corpo do contrato, sem senhaHash', async () => {
    const admin = await novaClinica();
    const c = await novoColega(admin);
    const res = await desativar(admin.token, c.psicologoId).expect(200);
    expect(res.body).toEqual({
      id: c.psicologoId,
      nome: 'Colega',
      email: c.email,
      papel: 'PSICOLOGO',
      abordagemPadrao: 'ACT',
      ativo: false,
      desativadoEm: expect.any(String) as string,
    });
    expect(
      Number.isNaN(
        Date.parse((res.body as { desativadoEm: string }).desativadoEm),
      ),
    ).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/senhaHash|\$2[aby]\$/);
    expect(await linha(c)).toMatchObject({ ativo: false });
  });

  it('token antigo do colega = 401 na hora (qualquer rota); login = 401 generico, igual ao de e-mail inexistente', async () => {
    const admin = await novaClinica();
    const c = await novoColega(admin);
    await com(c.token, http().get('/eu')).expect(200);
    await desativar(admin.token, c.psicologoId).expect(200);
    for (const rota of ['/eu', '/pacientes']) {
      await com(c.token, http().get(rota)).expect(401, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }
    const inativo = await http()
      .post('/auth/login')
      .send({ email: c.email, senha: SENHA_NOVA })
      .expect(401);
    const inexistente = await http()
      .post('/auth/login')
      .send({ email: `nao-existe-${sufixo}@teste.local`, senha: SENHA_NOVA })
      .expect(401);
    expect(inativo.body).toEqual(inexistente.body);
    expect(inativo.body).toEqual({
      statusCode: 401,
      message: 'Credenciais invalidas',
      error: 'Unauthorized',
    });
  });

  it('desativar de novo = 409 "Psicologo ja desativado"; nada auditado na 2a vez', async () => {
    const admin = await novaClinica();
    const c = await novoColega(admin);
    await desativar(admin.token, c.psicologoId).expect(200);
    const res = await desativar(admin.token, c.psicologoId).expect(409);
    expect(res.body).toMatchObject({ message: 'Psicologo ja desativado' });
    expect(await trilhaDesativou(admin)).toHaveLength(1);
  });

  it('ADMIN desativando a si mesmo ou outro ADMIN = 409 "Nao e possivel desativar este usuario"', async () => {
    const admin = await novaClinica();
    const outro = await novoColega(admin);
    await mudarPapelComoOwner(admin.clinicaId, outro.psicologoId, 'ADMIN');
    for (const alvo of [admin.psicologoId, outro.psicologoId]) {
      const res = await desativar(admin.token, alvo).expect(409);
      expect(res.body).toMatchObject({
        message: 'Nao e possivel desativar este usuario',
      });
    }
    expect(await linha(admin)).toMatchObject({ ativo: true });
    expect(await linha(outro)).toMatchObject({ ativo: true });
    await com(admin.token, http().get('/eu')).expect(200);
    expect(await trilhaDesativou(admin)).toHaveLength(0);
  });

  it('PSICOLOGO = 403 generico; sem token = 401; id nao uuid = 400', async () => {
    const admin = await novaClinica();
    const c1 = await novoColega(admin);
    const c2 = await novoColega(admin);
    const res = await desativar(c1.token, c2.psicologoId).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
    await desativar(undefined, c2.psicologoId).expect(401);
    await desativar(admin.token, 'nao-e-uuid').expect(400);
    expect(await linha(c2)).toMatchObject({ ativo: true });
  });

  it('ADMIN de OUTRA clinica e id inexistente = 404 igual; alvo intacto', async () => {
    const a = await novaClinica();
    const b = await novaClinica();
    const c = await novoColega(a);
    const alheio = await desativar(b.token, c.psicologoId).expect(404);
    const inexistente = await desativar(b.token, randomUUID()).expect(404);
    expect(alheio.body).toEqual(inexistente.body);
    expect(await linha(c)).toMatchObject({ ativo: true });
    await com(c.token, http().get('/eu')).expect(200);
    expect(await trilhaDesativou(b)).toHaveLength(0);
  });

  it('GET /psicologos traz ativo e desativadoEm; desativado continua na lista', async () => {
    const admin = await novaClinica();
    const c = await novoColega(admin);
    await desativar(admin.token, c.psicologoId).expect(200);
    const lista = (
      await com(admin.token, http().get('/psicologos')).expect(200)
    ).body as { psicologoId: string; ativo: boolean; desativadoEm: unknown }[];
    expect(
      lista.find((p) => p.psicologoId === admin.psicologoId),
    ).toMatchObject({ ativo: true, desativadoEm: null });
    const d = lista.find((p) => p.psicologoId === c.psicologoId)!;
    expect(d.ativo).toBe(false);
    expect(typeof d.desativadoEm).toBe('string');
  });

  it('e-mail do desativado continua ocupado (409 ao recriar)', async () => {
    const admin = await novaClinica();
    const c = await novoColega(admin);
    await desativar(admin.token, c.psicologoId).expect(200);
    await com(admin.token, http().post('/psicologos'))
      .send({
        nome: 'De novo',
        email: c.email,
        senha: SENHA,
        abordagemPadrao: 'ACT',
      })
      .expect(409, {
        statusCode: 409,
        message: 'E-mail ja cadastrado',
        error: 'Conflict',
      });
  });

  it('dados do desativado ficam no banco e o ADMIN continua sem le-los (404)', async () => {
    const admin = await novaClinica();
    const c = await novoColega(admin);
    const p = await com(c.token, http().post('/pacientes'))
      .send({ nome: 'Paciente do colega' })
      .expect(201);
    const pacienteId = (p.body as { id: string }).id;
    await com(c.token, http().post(`/pacientes/${pacienteId}/consentimento`))
      .send({ evento: 'CONCEDIDO' })
      .expect(201);
    const d = await com(
      c.token,
      http().post(`/pacientes/${pacienteId}/documentos`),
    )
      .send({ tipo: 'EVOLUCAO', conteudo: 'texto clinico de teste' })
      .expect(201);
    const docId = (d.body as { id: string }).id;
    const contar = () =>
      tenant().runComoUsuario(c, async (tx) => ({
        pacientes: await tx.paciente.count(),
        documentos: await tx.documento.count(),
        consentimentos: await tx.consentimento.count(),
        trilha: await tx.auditoria.count(),
      }));
    const antes = await contar();
    expect(antes).toMatchObject({ pacientes: 1, documentos: 1 });

    await desativar(admin.token, c.psicologoId).expect(200);

    expect(await contar()).toEqual(antes);
    await com(admin.token, http().get(`/pacientes/${pacienteId}`)).expect(404);
    await com(
      admin.token,
      http().get(`/pacientes/${pacienteId}/documentos/${docId}`),
    ).expect(404);
    const lista = await com(admin.token, http().get('/pacientes')).expect(200);
    expect(lista.body).toEqual([]);
  });

  it('auditoria DESATIVOU: 1 linha, recurso Psicologo, recursoId = alvo, psicologoId = ADMIN, sem dado do colega', async () => {
    const admin = await novaClinica();
    const c = await novoColega(admin);
    await desativar(admin.token, c.psicologoId).expect(200);
    const linhas = await trilhaDesativou(admin);
    expect(linhas).toEqual([
      {
        acao: 'DESATIVOU',
        recurso: 'Psicologo',
        recursoId: c.psicologoId,
        psicologoId: admin.psicologoId,
      },
    ]);
  });

  it('falha da auditoria desfaz a desativacao (mesma transacao): 500 e colega segue ativo', async () => {
    const admin = await novaClinica();
    const c = await novoColega(admin);
    const espia = jest
      .spyOn(app.get(AuditoriaService), 'registrar')
      .mockRejectedValueOnce(new Error('trilha caiu'));
    try {
      await desativar(admin.token, c.psicologoId).expect(500);
    } finally {
      espia.mockRestore();
    }
    expect(await linha(c)).toMatchObject({ ativo: true, desativadoEm: null });
    await com(c.token, http().get('/eu')).expect(200);
    expect(await trilhaDesativou(admin)).toHaveLength(0);
  });
});
