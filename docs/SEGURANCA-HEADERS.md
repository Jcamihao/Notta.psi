# Cabecalhos de seguranca do FRONT (item 49)

O back ja usa `helmet` na API (JSON). Os cabecalhos abaixo sao do **servidor web que entrega o front** (nginx, na VPS): o back nao os manda para o HTML/JS. Exemplo pronto: `deploy/nginx-notta.conf.example`.

Por que importa: a sessao agora e cookie `httpOnly` (o JS nao le o JWT), mas um script injetado (XSS) ainda poderia CHAMAR a API como o usuario. A CSP estrita fecha a entrada do XSS; os outros cabecalhos fecham vazamentos laterais.

## O que o servidor do front precisa mandar

| Cabecalho | Valor | Por que |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-<NONCE>'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | Sem `'unsafe-inline'` e sem `'unsafe-eval'`: script injetado nao roda. `connect-src 'self'`: a API e `/api` na mesma origem. `style-src` leva um nonce por resposta (ver abaixo). `base-uri 'self'` (e NAO `'none'`): o `index.html` tem `<base href="/">` e o navegador bloqueia com `'none'`. |
| `frame-ancestors 'none'` (dentro da CSP) | `none` | Ninguem embute o app em iframe (clickjacking). |
| `Referrer-Policy` | `no-referrer` | O link do termo (`/termo/<token>`) e uma credencial na URL: nao pode vazar por Referer. |
| `X-Content-Type-Options` | `nosniff` | O navegador nao adivinha tipo de arquivo. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | So https. Ligue so depois de confirmar o https em todos os subdominios. |
| `X-Robots-Tag` | `noindex` em `/termo/*` | A pagina do termo nao entra em buscador. |
| `Cache-Control` | `no-store` no HTML do app | Pagina autenticada nao fica em cache compartilhado nem no botao "voltar". Os arquivos com hash no nome (`*.js`, `*.css`) podem ter cache longo. |

## Como o Angular entra nessa CSP (verificado no build real, item 46/49 front)

Verificado em 2026-11-05 com o build de producao servido com esta CSP e aberto no Chrome (violacoes pelo evento `securitypolicyviolation` e pelo console): `/login`, `/cadastro` e `/termo/abc` com **0 violacoes**. Duas coisas SAIRAM DIFERENTES do que se supunha e estao resolvidas:

1. **Estilo dos componentes.** O Angular injeta o CSS de cada componente como `<style>` em tempo de execucao. Com `style-src 'self'` puro o navegador bloqueia todos (tela sem o estilo dos componentes). Solucao adotada: `ngCspNonce="NOTTA_CSP_NONCE"` no `<app-root>` do `src/index.html` (o Angular poe esse nonce nos `<style>` que injeta) e o servidor, a cada resposta de HTML, **troca `NOTTA_CSP_NONCE` por um valor novo** e manda o mesmo valor em `style-src 'nonce-...'`. No nginx: `sub_filter 'NOTTA_CSP_NONCE' $request_id;` + `'nonce-$request_id'` no header (ver `deploy/nginx-notta.conf.example`; o `$request_id` do nginx tem 128 bits aleatorios). A receita do nginx NAO foi rodada (sem nginx no ambiente de desenvolvimento): o comportamento do navegador foi provado com um servidor Node que faz a mesma troca. Teste na VPS antes de ligar. Em `ng serve` (sem CSP) o texto `NOTTA_CSP_NONCE` fica como valor do atributo e nao faz nada.
2. **`<base href="/">`** exige `base-uri 'self'`; com `'none'` o navegador recusa a base e quebra as rotas.

O que ja estava certo: `optimization.styles.inlineCritical: false` no `angular.json` (build de producao) deixa o `index.html` sem CSS inline e sem o `onload` do CSS critico; o build nao tem `<script>` inline, `eval(`, `new Function(`, handler inline nem `style=""`. `[style.x]` do Angular usa o CSSOM e passa; `style="..."` literal em template viraria atributo e seria bloqueado (o verificador pega no HTML, e a CSP pegaria no navegador).

Teste automatico (item 49): em `frontend/`, depois do build de producao, `npm run verificar:csp` le o `dist` e FALHA (codigo 1) se achar `eval(`, `new Function(`, `setTimeout`/`setInterval` com texto, handler inline (`onclick=` e afins), `javascript:` em URL, `<script>` inline sem hash esperado (lista `HASHES_PERMITIDOS` em `frontend/scripts/csp.mjs`, vazia), `<style>` ou `style=""` no HTML, ou `index.html` sem o `ngCspNonce="NOTTA_CSP_NONCE"`. `npm run test:csp` prova que a verificacao falha de verdade (build falso com cada violacao).

## Cookies e proxy (como o back espera)

- O front e a API ficam na MESMA origem: `https://app.exemplo.com/` (front) e `https://app.exemplo.com/api/` (proxy para o back, TIRANDO o `/api`). O cookie de refresh e restrito a `/api/auth` (`NOTTA_API_PREFIXO`, padrao `/api`).
- `NOTTA_APP_URL=https://app.exemplo.com` (origem aceita na checagem de Origin do CSRF) e `NOTTA_TRUST_PROXY=1`.
- O nginx precisa repassar `X-Forwarded-For` e `X-Forwarded-Proto $scheme`: sem o segundo, o back nao sabe que e https e nao marca os cookies como `Secure` quando `NODE_ENV` for development (em producao `Secure` e sempre ligado).
- Nao hospedar nada de terceiros em subdominios do dominio do app (cookies sem prefixo `__Host-`: cookie tossing).
- A API tambem manda `Cache-Control: no-store` nas respostas que definem cookies.
