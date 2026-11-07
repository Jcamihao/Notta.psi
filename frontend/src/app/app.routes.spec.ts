import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Route, Router } from '@angular/router';
import { routes } from './app.routes';
import { authGuard } from './core/auth.guard';
import { senhaProvisoriaGuard } from './core/senha-provisoria.guard';
import { DocumentoLeituraPage } from './documentos/documento-leitura.page';
import { DocumentoNovoPage } from './documentos/documento-novo.page';
import { PacienteFormPage } from './pacientes/paciente-form.page';
import { PacientesPage } from './pacientes/pacientes.page';
import { SegurancaPage } from './seguranca/seguranca.page';
import { TermoPage } from './termo/termo.page';

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

describe('rota publica do termo', () => {
  const rota = routes.find((r) => r.path === 'termo/:token') as Route;
  const shell = routes.find((r) => r.path === '' && r.children) as Route;

  it('existe no nivel de cima, fora do shell, sem nenhum guard', () => {
    expect(rota).toBeDefined();
    expect(shell.children!.some((r) => r.path === 'termo/:token')).toBeFalse();
    expect(rota.canActivate).toBeUndefined();
    expect(rota.canActivateChild).toBeUndefined();
    expect(rota.canMatch).toBeUndefined();
    expect(rota.children).toBeUndefined();
  });

  it('carrega a pagina do termo sob demanda e vem antes do shell e do curinga', async () => {
    expect(await (rota.loadComponent as () => Promise<unknown>)()).toBe(TermoPage);
    const paths = routes.map((r) => r.path);
    expect(paths.indexOf('termo/:token')).toBeLessThan(paths.indexOf(''));
    expect(paths.indexOf('termo/:token')).toBeLessThan(paths.indexOf('**'));
  });

  it('navegar para /termo/abc sem sessao NAO cai no login nem no shell', async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/termo/abc');
    expect(router.url).toBe('/termo/abc');
    TestBed.inject(HttpTestingController).match(() => true);
  });
});

describe('rota publica de seguranca', () => {
  const publica = routes.find((r) => r.path === 'seguranca')!;
  const shell = routes.find((r) => r.path === '' && r.children) as Route;

  it('existe fora do shell, sem guard', () => {
    expect(publica).toBeDefined();
    expect(publica.canActivate).toBeUndefined();
    expect(publica.canActivateChild).toBeUndefined();
    expect(shell.children!.map((r) => r.path)).not.toContain('seguranca');
  });

  it('carrega a pagina sob demanda', async () => {
    expect(await (publica.loadComponent as () => Promise<unknown>)()).toBe(SegurancaPage);
  });

  it('abre sem login: navegar para /seguranca nao redireciona', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/seguranca');
    expect(router.url).toBe('/seguranca');
  });
});
