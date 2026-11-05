import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessaoStore } from './sessao.store';

// So ADMIN entra. Espera o /eu (restauracao de sessao ao abrir o app) antes de decidir.
// O servidor e a autoridade (403); isto so evita mostrar a tela a quem nao pode usar.
export const adminGuard: CanActivateFn = async () => {
  const sessao = inject(SessaoStore);
  const router = inject(Router);
  await sessao.garantir();
  if (!sessao.autenticado()) return router.createUrlTree(['/login']);
  return sessao.ehAdmin() || router.createUrlTree(['/']);
};
