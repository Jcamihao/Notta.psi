import { criarApp } from './criar-app-sem-limite';

// Boot seguro contra Postgres real: o papel de runtime TEM de estar sujeito a RLS.
const original = process.env.DATABASE_URL;
afterEach(() => {
  process.env.DATABASE_URL = original;
});

describe('boot: papel de runtime', () => {
  it('DATABASE_URL apontando para praxis_owner (dono das tabelas) derruba o boot sem ecoar a URL', async () => {
    const owner = process.env.DATABASE_URL_OWNER;
    if (!owner) throw new Error('DATABASE_URL_OWNER ausente (ver README)');
    process.env.DATABASE_URL = owner;
    let msg = '';
    try {
      const app = await criarApp();
      await app.close();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/DATABASE_URL insegura/);
    expect(msg).toMatch(/dono/);
    expect(msg).not.toContain(owner);
    expect(msg).not.toMatch(/praxis_owner:/);
  });

  it('praxis_app sobe normalmente', async () => {
    const app = await criarApp();
    await app.close();
  });
});
