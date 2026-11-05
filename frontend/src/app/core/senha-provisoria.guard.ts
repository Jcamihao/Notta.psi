import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { SessaoStore } from './sessao.store';

// Senha provisoria (item 62): toda rota do shell leva para /trocar-senha, menos ela mesma.
// Espera o /eu. /eu com erro deixa passar: o servidor bloqueia com 403 e o interceptor traz a
// pessoa para ca do mesmo jeito.
export const senhaProvisoriaGuard: CanActivateChildFn = async (rota) => {
  const sessao = inject(SessaoStore);
  const router = inject(Router);
  await sessao.garantir();
  return (
    rota.routeConfig?.path === 'trocar-senha' ||
    !sessao.senhaProvisoria() ||
    router.createUrlTree(['/trocar-senha'])
  );
};
