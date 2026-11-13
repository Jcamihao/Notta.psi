import { conferirPapelRuntime } from './prisma.service';

const ok = { superuser: false, bypassrls: false, dono: false };

describe('conferirPapelRuntime (boot)', () => {
  it('praxis_app (sem superuser, sem BYPASSRLS, nao dono) passa', () => {
    expect(() => conferirPapelRuntime(ok)).not.toThrow();
  });

  it.each([
    ['superuser', { ...ok, superuser: true }, /superuser/],
    ['BYPASSRLS', { ...ok, bypassrls: true }, /BYPASSRLS/],
    ['dono das tabelas', { ...ok, dono: true }, /dono/],
    ['papel nao encontrado', undefined, /papel/],
  ])('%s derruba o boot com mensagem clara', (_n, linha, motivo) => {
    expect(() => conferirPapelRuntime(linha)).toThrow(/DATABASE_URL/);
    expect(() => conferirPapelRuntime(linha)).toThrow(motivo);
  });
});
