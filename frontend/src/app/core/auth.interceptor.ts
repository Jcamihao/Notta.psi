import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { SessaoStore } from './sessao.store';
import { UsuarioStore } from './usuario.store';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Rotas publicas (termo do paciente): sem sessao. Nao anexa o Bearer de um psicologo que por
  // acaso esteja logado neste navegador e nunca trata a resposta como sessao expirada.
  if (req.url.startsWith('/api/publico/')) return next(req);

  const sessao = inject(SessaoStore);
  const router = inject(Router);
  const usuarios = inject(UsuarioStore);

  const token = sessao.token();
  const daApi = req.url.startsWith('/api/');
  const authReq =
    daApi && token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  const ehLogin = req.method === 'POST' && req.url === '/api/auth/login';

  return next(authReq).pipe(
    tap({
      error: (e: { status?: number; error?: { message?: unknown } }) => {
        if (e.status === 401 && !ehLogin) {
          sessao.sair();
          void router.navigateByUrl('/login');
        }
        // Senha provisoria (item 62): o /eu desatualizado deixou passar; atualiza e leva para a troca.
        if (e.status === 403 && e.error?.message === 'Troca de senha obrigatoria') {
          usuarios.recarregar();
          void router.navigateByUrl('/trocar-senha');
        }
      },
    }),
  );
};
