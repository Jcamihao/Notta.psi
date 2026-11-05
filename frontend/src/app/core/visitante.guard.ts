import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessaoStore } from './sessao.store';

export const visitanteGuard: CanActivateFn = async () => {
  const sessao = inject(SessaoStore);
  const router = inject(Router);
  await sessao.garantir();
  return !sessao.autenticado() || router.createUrlTree(['/']);
};
