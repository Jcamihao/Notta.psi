import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { SEM_RENOVAR, SessaoStore } from './sessao.store';

const METODOS_COM_CSRF = ['POST', 'PUT', 'PATCH', 'DELETE'];
// Ainda nao ha sessao nestas chamadas: sem CSRF e sem tentar renovar em 401.
const SEM_SESSAO = ['/api/auth/login', '/api/clinicas', '/api/auth/renovar'];

// Cookie `notta_csrf` (nao httpOnly de proposito: double-submit). Some junto com a sessao.
function lerCsrf(): string | null {
  for (const parte of document.cookie.split(';')) {
    const i = parte.indexOf('=');
    if (i <= 0 || parte.slice(0, i).trim() !== 'notta_csrf') continue;
    try {
      return decodeURIComponent(parte.slice(i + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Rotas publicas (termo do paciente): sem sessao. Nunca anexa CSRF de um psicologo que por acaso
  // esteja logado neste navegador e nunca trata a resposta como sessao expirada.
  if (!req.url.startsWith('/api/') || req.url.startsWith('/api/publico/')) return next(req);

  const sessao = inject(SessaoStore);
  const router = inject(Router);
  const semSessao = SEM_SESSAO.includes(req.url);

  // A sessao vai nos cookies (mesma origem, via proxy /api): nenhum Authorization aqui.
  const enviar = () => {
    const csrf = !semSessao && METODOS_COM_CSRF.includes(req.method) ? lerCsrf() : null;
    return next(csrf ? req.clone({ setHeaders: { 'X-CSRF-Token': csrf } }) : req);
  };

  // Sessao perdida: so avisa e vai ao login quem estava logado (visitante abrindo o app so segue).
  const expirar = (erro: HttpErrorResponse) => {
    if (sessao.autenticado()) {
      sessao.expirou();
      void router.navigateByUrl('/login');
    }
    return throwError(() => erro);
  };

  // 401: o acesso (15 min) venceu. Renova UMA vez (fila e Web Lock no store) e repete. Se a
  // renovacao nao responder (503, 429, rede), nao derruba a sessao.
  const renovarERepetir = (erro: HttpErrorResponse) => {
    if (!lerCsrf()) return expirar(erro); // sem cookies de sessao: nao ha o que renovar
    return from(sessao.renovar()).pipe(
      switchMap((resultado) => {
        if (resultado === 'indisponivel') return throwError(() => erro);
        if (resultado === 'expirou') return expirar(erro);
        return enviar().pipe(
          catchError((e2: HttpErrorResponse) =>
            e2.status === 401 ? expirar(e2) : throwError(() => e2),
          ),
        );
      }),
    );
  };

  return enviar().pipe(
    catchError((e: HttpErrorResponse) => {
      if (e.status === 401 && !semSessao && !req.context.get(SEM_RENOVAR)) {
        return renovarERepetir(e);
      }
      // Senha provisoria (item 62): o /eu desatualizado deixou passar; atualiza e leva para a troca.
      if (e.status === 403 && e.error?.message === 'Troca de senha obrigatoria') {
        void sessao.carregar();
        void router.navigateByUrl('/trocar-senha');
      }
      return throwError(() => e);
    }),
  );
};
