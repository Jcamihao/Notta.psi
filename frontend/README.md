# Notta.psi — frontend

Angular 20 (standalone, Signals, zoneless) + SCSS. Projeto independente do `backend/`.

## Pre-requisitos

- Node 20+ e npm 10+
- Chrome/Chromium para `npm test` (defina `CHROME_BIN` com o caminho do executavel)

## Comandos

```bash
npm install
npm start          # ng serve em http://localhost:4200 (com proxy /api)
npm test           # Karma + Chrome headless (--no-sandbox), execucao unica
npm run build      # saida em dist/frontend
npm run lint       # angular-eslint (sem --fix)
npm run format:check
npm run format     # prettier --write
```

## Como o `/api` funciona

O front sempre chama `/api/...`. Em dev, `proxy.conf.json` encaminha `/api` para
`http://localhost:3000` removendo o prefixo (`/api/auth/login` vira `/auth/login` no backend).
Em producao, um proxy reverso faz o mesmo.

## Sessao

`SessaoStore` guarda o JWT em `sessionStorage` (chave `notta.token`): some ao fechar a aba.
Cookie httpOnly fica como decisao futura. O `authInterceptor` anexa `Authorization: Bearer`
so em URLs `/api/` e, em 401 (exceto `POST /api/auth/login`), limpa a sessao e vai para `/login`.

## Estrutura

```
src/
  app/
    core/      sessao.store, auth.interceptor, auth.guard, visitante.guard
    layout/    shell.component (cabecalho + <router-outlet>)
    pages/     paginas (hoje placeholders: login, inicio)
    app.routes.ts   rotas com lazy loading (loadComponent)
  styles/tokens.scss   tokens de design (CSS custom properties)
  styles.scss          estilos globais
```
