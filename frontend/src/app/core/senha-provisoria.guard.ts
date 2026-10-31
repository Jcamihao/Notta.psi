import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateChildFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { UsuarioStore } from './usuario.store';

// Senha provisoria (item 62): toda rota do shell leva para /trocar-senha, menos ela mesma.
// Espera o /eu (pronto). /eu com erro deixa passar: o servidor bloqueia com 403 e o interceptor
// traz a pessoa para ca do mesmo jeito.
export const senhaProvisoriaGuard: CanActivateChildFn = (rota) => {
  const usuarios = inject(UsuarioStore);
  const router = inject(Router);
  return toObservable(usuarios.pronto).pipe(
    filter(Boolean),
    take(1),
    map(
      () =>
        rota.routeConfig?.path === 'trocar-senha' ||
        !usuarios.senhaProvisoria() ||
        router.createUrlTree(['/trocar-senha']),
    ),
  );
};
