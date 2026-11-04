import { Routes } from '@angular/router';
import { adminGuard } from './core/admin.guard';
import { authGuard } from './core/auth.guard';
import { senhaProvisoriaGuard } from './core/senha-provisoria.guard';
import { visitanteGuard } from './core/visitante.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [visitanteGuard],
    loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'cadastro',
    canActivate: [visitanteGuard],
    loadComponent: () => import('./pages/cadastro.page').then((m) => m.CadastroPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [senhaProvisoriaGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/inicio.page').then((m) => m.InicioPage),
      },
      {
        path: 'equipe',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/equipe.page').then((m) => m.EquipePage),
      },
      {
        path: 'pacientes',
        loadComponent: () => import('./pacientes/pacientes.page').then((m) => m.PacientesPage),
      },
      {
        path: 'pacientes/novo',
        loadComponent: () =>
          import('./pacientes/paciente-form.page').then((m) => m.PacienteFormPage),
      },
      {
        path: 'pacientes/:id/documentos/novo',
        loadComponent: () =>
          import('./documentos/documento-novo.page').then((m) => m.DocumentoNovoPage),
      },
      {
        path: 'pacientes/:id/documentos/:docId',
        loadComponent: () =>
          import('./documentos/documento-leitura.page').then((m) => m.DocumentoLeituraPage),
      },
      {
        path: 'pacientes/:id',
        loadComponent: () =>
          import('./pacientes/paciente-form.page').then((m) => m.PacienteFormPage),
      },
      {
        path: 'trocar-senha',
        loadComponent: () => import('./pages/trocar-senha.page').then((m) => m.TrocarSenhaPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
