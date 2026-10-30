import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { SessaoStore } from './sessao.store';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const sessao = inject(SessaoStore);
  const router = inject(Router);

  const token = sessao.token();
  const daApi = req.url.startsWith('/api/');
  const authReq =
    daApi && token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  const ehLogin = req.method === 'POST' && req.url === '/api/auth/login';

  return next(authReq).pipe(
    tap({
      error: (e: { status?: number }) => {
        if (e.status === 401 && !ehLogin) {
          sessao.sair();
          void router.navigateByUrl('/login');
        }
      },
    }),
  );
};
