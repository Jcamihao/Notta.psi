import { Routes } from '@angular/router';
import { adminGuard } from './core/admin.guard';
import { authGuard } from './core/auth.guard';
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
    ],
  },
  { path: '**', redirectTo: '' },
];
