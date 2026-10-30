import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { CriptografiaService } from './criptografia.service';

// Integracao leve: compila o AppModule (instancia providers, sem conectar no banco).
describe('AppModule + CriptografiaModule no boot', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://x:y@localhost:1/nenhum';
    process.env.NOTTA_JWT_SECRET = 'segredo-jwt-de-teste-unitario-'.repeat(2);
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('sobe com NOTTA_MASTER_KEY valida e injeta o service', async () => {
    process.env.NOTTA_MASTER_KEY = 'ab'.repeat(32);
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const c = mod.get(CriptografiaService);
    expect(c.decifrar('cli', c.cifrar('cli', 'oi'))).toBe('oi');
    await mod.close();
  });

  it('falha no boot sem NOTTA_MASTER_KEY', async () => {
    delete process.env.NOTTA_MASTER_KEY;
    await expect(
      Test.createTestingModule({ imports: [AppModule] }).compile(),
    ).rejects.toThrow(/NOTTA_MASTER_KEY/);
  });
});
