import { Route } from '@angular/router';
import { routes } from './app.routes';
import { authGuard } from './core/auth.guard';
import { senhaProvisoriaGuard } from './core/senha-provisoria.guard';
import { DocumentoLeituraPage } from './documentos/documento-leitura.page';
import { DocumentoNovoPage } from './documentos/documento-novo.page';
import { PacienteFormPage } from './pacientes/paciente-form.page';
import { PacientesPage } from './pacientes/pacientes.page';

describe('rotas de pacientes', () => {
  const shell = routes.find((r) => r.path === '' && r.children) as Route;
  const filha = (path: string) => shell.children!.find((r) => r.path === path)!;

  it('ficam dentro do shell, protegido por auth e por senha provisoria', () => {
    expect(shell.canActivate).toContain(authGuard);
    expect(shell.canActivateChild).toContain(senhaProvisoriaGuard);
    for (const p of ['pacientes', 'pacientes/novo', 'pacientes/:id']) {
      expect(filha(p)).withContext(p).toBeDefined();
    }
  });

  it('abertas a todos os papeis (sem adminGuard) e carregadas sob demanda', async () => {
    for (const p of ['pacientes', 'pacientes/novo', 'pacientes/:id']) {
      expect(filha(p).canActivate).withContext(p).toBeUndefined();
      expect(filha(p).loadComponent).withContext(p).toBeDefined();
    }
    expect(await (filha('pacientes').loadComponent as () => Promise<unknown>)()).toBe(
      PacientesPage,
    );
    expect(await (filha('pacientes/novo').loadComponent as () => Promise<unknown>)()).toBe(
      PacienteFormPage,
    );
    expect(await (filha('pacientes/:id').loadComponent as () => Promise<unknown>)()).toBe(
      PacienteFormPage,
    );
  });

  it('/pacientes/novo vem antes de /pacientes/:id', () => {
    const paths = shell.children!.map((r) => r.path);
    expect(paths.indexOf('pacientes/novo')).toBeLessThan(paths.indexOf('pacientes/:id'));
  });

  it('rotas de documento: dentro do shell, sem adminGuard, "novo" antes de ":docId"', async () => {
    const novo = filha('pacientes/:id/documentos/novo');
    const leitura = filha('pacientes/:id/documentos/:docId');
    expect(novo.canActivate).toBeUndefined();
    expect(leitura.canActivate).toBeUndefined();
    expect(await (novo.loadComponent as () => Promise<unknown>)()).toBe(DocumentoNovoPage);
    expect(await (leitura.loadComponent as () => Promise<unknown>)()).toBe(DocumentoLeituraPage);
    const paths = shell.children!.map((r) => r.path);
    expect(paths.indexOf('pacientes/:id/documentos/novo')).toBeLessThan(
      paths.indexOf('pacientes/:id/documentos/:docId'),
    );
  });
});
