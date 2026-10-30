import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessaoStore } from './sessao.store';

export const authGuard: CanActivateFn = () =>
  inject(SessaoStore).autenticado() || inject(Router).createUrlTree(['/login']);
