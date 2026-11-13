import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { SelahIaClient } from './selahia.client';

// Boot do AppModule (sem conectar no banco): a config da IA e validada ao subir.
describe('AppModule + IaModule no boot', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://x:y@localhost:1/nenhum';
    process.env.PRAXIS_JWT_SECRET = 'segredo-jwt-de-teste-unitario-'.repeat(2);
    process.env.PRAXIS_MASTER_KEY = '0123456789abcdef'.repeat(4);
    process.env.NODE_ENV = 'production';
    // Item 22: producao exige o termo revisado e a URL do app (convite de consentimento).
    process.env.PRAXIS_TERMO_REVISADO = '1';
    process.env.PRAXIS_APP_URL = 'https://app.exemplo.com';
    delete process.env.PRAXIS_IA_HABILITADA;
    delete process.env.SELAHIA_URL;
    delete process.env.SELAHIA_API_KEY;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  const subir = () =>
    Test.createTestingModule({ imports: [AppModule] }).compile();

  it('sobe com a IA desligada (padrao), sem exigir SELAHIA_*', async () => {
    const mod = await subir();
    expect(mod.get(SelahIaClient)).toBeInstanceOf(SelahIaClient);
    await mod.close();
  });

  it('sobe com a IA ligada e config valida', async () => {
    process.env.PRAXIS_IA_HABILITADA = '1';
    process.env.SELAHIA_URL = 'https://selahia.exemplo.com';
    process.env.SELAHIA_API_KEY = 'k7Qw9ZpLr2VnX4sB8tYhM1aD6fGcJ3uE';
    const mod = await subir();
    expect(mod.get(SelahIaClient)).toBeInstanceOf(SelahIaClient);
    await mod.close();
  });

  it('IA ligada sem URL ou sem chave derruba o boot, sem ecoar a chave', async () => {
    process.env.PRAXIS_IA_HABILITADA = '1';
    process.env.SELAHIA_API_KEY = 'k7Qw9ZpLr2VnX4sB8tYhM1aD6fGcJ3uE';
    await expect(subir()).rejects.toThrow(/SELAHIA_URL/);
    await expect(subir()).rejects.not.toThrow(/k7Qw9Zp/);
    process.env.SELAHIA_URL = 'https://selahia.exemplo.com';
    process.env.SELAHIA_API_KEY = 'changeme';
    await expect(subir()).rejects.toThrow(/SELAHIA_API_KEY/);
  });
});
