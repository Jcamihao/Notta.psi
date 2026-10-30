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

## Ver as telas sem o backend (servidor falso)

Com o backend real rodando na porta 3000, `npm start` ja basta (o proxy aponta para ele).
Sem o backend, rode um servidor falso que segue `contrato.md`. Ele fica FORA do repo, por
exemplo em `/tmp/notta-falso/falso.mjs` (so Node, sem dependencia):

```js
import http from 'node:http';
const contas = new Map([
  ['ana@clinica.com', { senha: 'senha-forte-1', nome: 'Ana Souza', clinica: 'Clinica Horizonte' }],
]);
const tokens = new Map();
const responder = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
};
http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const b = raw ? JSON.parse(raw) : {};
      const email = String(b.email ?? '')
        .trim()
        .toLowerCase();
      const rota = `${req.method} ${req.url}`;
      if (email.startsWith('limite@'))
        return responder(
          res,
          429,
          { statusCode: 429, message: 'Too Many Requests' },
          { 'Retry-After': '30' },
        );
      if (rota === 'POST /clinicas') {
        if (contas.has(email))
          return responder(res, 409, { statusCode: 409, message: 'E-mail ja cadastrado' });
        contas.set(email, { senha: b.senha, nome: b.nomePsicologo, clinica: b.nomeClinica });
        return responder(res, 201, { clinicaId: 'c1', psicologoId: 'p1' });
      }
      if (rota === 'POST /auth/login') {
        if (contas.get(email)?.senha !== b.senha)
          return responder(res, 401, { statusCode: 401, message: 'Credenciais invalidas' });
        const t = 'falso.' + Math.random().toString(36).slice(2);
        tokens.set(t, email);
        return responder(res, 200, { token: t });
      }
      const dono = tokens.get(String(req.headers.authorization).replace('Bearer ', ''));
      if (rota === 'GET /eu' && dono) {
        const c = contas.get(dono);
        return responder(res, 200, {
          psicologoId: 'p1',
          nome: c.nome,
          email: dono,
          papel: 'ADMIN',
          abordagemPadrao: 'TCC',
          clinica: { id: 'c1', nome: c.clinica },
        });
      }
      responder(res, 401, { statusCode: 401, message: 'Unauthorized' });
    });
  })
  .listen(3000, () => console.log('servidor falso na porta 3000'));
```

```bash
node /tmp/notta-falso/falso.mjs   # terminal 1
npm start                         # terminal 2, abra http://localhost:4200/cadastro
```

Conta pronta: `ana@clinica.com` / `senha-forte-1` (cadastrar com ela da 409). Qualquer e-mail
comecando com `limite@` responde 429 com `Retry-After: 30`. Senha errada da 401.

## Sessao

`SessaoStore` guarda o JWT em `sessionStorage` (chave `notta.token`): some ao fechar a aba.
Cookie httpOnly fica como decisao futura. O `authInterceptor` anexa `Authorization: Bearer`
so em URLs `/api/` e, em 401 (exceto `POST /api/auth/login`), limpa a sessao e vai para `/login`.
`UsuarioStore` segue o token: ao entrar ou ao restaurar a sessao busca `GET /api/eu` (nome,
papel, clinica) para o cabecalho; ao sair, limpa.

## Estrutura

```
src/
  app/
    core/      sessao.store, usuario.store, auth.interceptor, guards, formulario (validacao e erros)
    layout/    shell.component (cabecalho + <router-outlet>), acesso.component (moldura de login/cadastro)
    pages/     login, cadastro, inicio (placeholder)
    app.routes.ts   rotas com lazy loading (loadComponent)
  styles/tokens.scss   tokens de design (CSS custom properties)
  styles.scss          estilos globais
```
