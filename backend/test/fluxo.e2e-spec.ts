import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { apagarClinicas, corpoClinica, criarApp } from './criar-app-sem-limite';

// Pilha real: AppModule + configurarApp, com limites e guards ligados.
it('fluxo: cadastro -> login -> /eu', async () => {
  const app = await criarApp();
  const http = app.getHttpServer();
  const email = `fluxo-${randomUUID().slice(0, 8)}@teste.local`;
  let clinicaId = '';
  try {
    const cad = await request(http)
      .post('/clinicas')
      .send(corpoClinica(email, { nomeClinica: 'Clinica Fluxo' }))
      .expect(201);
    const ids = cad.body as { clinicaId: string; psicologoId: string };
    clinicaId = ids.clinicaId;

    const log = await request(http)
      .post('/auth/login')
      .send({ email, senha: 'senha-forte-123' })
      .expect(200);
    const { token } = log.body as { token: string };

    const eu = await request(http)
      .get('/eu')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eu.body).toEqual({
      psicologoId: ids.psicologoId,
      nome: 'Ana Teste',
      email,
      papel: 'ADMIN',
      abordagemPadrao: 'TCC',
      senhaProvisoria: false,
      clinica: { id: clinicaId, nome: 'Clinica Fluxo' },
    });
    expect(eu.headers['x-content-type-options']).toBe('nosniff');
  } finally {
    if (clinicaId) await apagarClinicas(app, [clinicaId]);
    await app.close();
  }
});
