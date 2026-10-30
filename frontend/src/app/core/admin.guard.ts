import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { SessaoStore } from './sessao.store';
import { UsuarioStore } from './usuario.store';

// So ADMIN entra. Espera o /eu (restauracao de sessao no boot) antes de decidir.
// O servidor e a autoridade (403); isto so evita mostrar a tela a quem nao pode usar.
export const adminGuard: CanActivateFn = () => {
  const usuarios = inject(UsuarioStore);
  const sessao = inject(SessaoStore);
  const router = inject(Router);
  return toObservable(usuarios.pronto).pipe(
    filter(Boolean),
    take(1),
    map(() => {
      if (!sessao.autenticado()) return router.createUrlTree(['/login']);
      return usuarios.ehAdmin() || router.createUrlTree(['/']);
    }),
  );
};
