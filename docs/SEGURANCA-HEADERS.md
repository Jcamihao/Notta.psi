# Cabecalhos de seguranca do FRONT (item 49)

O back ja usa `helmet` na API (JSON). Os cabecalhos abaixo sao do **servidor web que entrega o front** (nginx, na VPS): o back nao os manda para o HTML/JS. Exemplo pronto: `deploy/nginx-notta.conf.example`.

Por que importa: a sessao agora e cookie `httpOnly` (o JS nao le o JWT), mas um script injetado (XSS) ainda poderia CHAMAR a API como o usuario. A CSP estrita fecha a entrada do XSS; os outros cabecalhos fecham vazamentos laterais.

## O que o servidor do front precisa mandar

| Cabecalho | Valor | Por que |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` | Sem `'unsafe-inline'` e sem `'unsafe-eval'`: script injetado nao roda. `connect-src 'self'`: a API e `/api` na mesma origem. |
| `frame-ancestors 'none'` (dentro da CSP) | `none` | Ninguem embute o app em iframe (clickjacking). |
| `Referrer-Policy` | `no-referrer` | O link do termo (`/termo/<token>`) e uma credencial na URL: nao pode vazar por Referer. |
| `X-Content-Type-Options` | `nosniff` | O navegador nao adivinha tipo de arquivo. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | So https. Ligue so depois de confirmar o https em todos os subdominios. |
| `X-Robots-Tag` | `noindex` em `/termo/*` | A pagina do termo nao entra em buscador. |
| `Cache-Control` | `no-store` no HTML do app | Pagina autenticada nao fica em cache compartilhado nem no botao "voltar". Os arquivos com hash no nome (`*.js`, `*.css`) podem ter cache longo. |

## Como o Angular entra nessa CSP (sem `unsafe-inline`)

As opcoes abaixo sao a receita conhecida; NAO foram verificadas contra o build real nesta task (o front so muda na etapa seguinte, que roda o teste automatico e confirma).

- Build de producao com `"optimization": { "styles": { "inlineCritical": false } }` no `angular.json`: o Angular, por padrao, injeta CSS critico inline e troca o `<link>` por um `onload="this.media='all'"` (handler inline, bloqueado pela CSP). Desligue o `inlineCritical`.
- Fontes e icones auto-hospedados (decisao ja tomada: DM Sans e Lucide por npm, nada de CDN). Sem `style-src` externo.
- Se o build gerar `<script>` inline (ex.: `ngsw`/registro do service worker), use nonce por resposta (`ngCspNonce` no `<app-root>`, injetado pelo nginx com `sub_filter`) ou hash. Preferir remover o script inline.
- Estilos dinamicos do Angular (`[style.x]`) usam o CSSOM e passam; `style="..."` literal no template vira atributo e e bloqueado: se aparecer violacao, mover para classe.
- Teste automatico (script do front, rodado no fim da etapa do front): le o build de producao e FALHA se achar `eval(`, `new Function(`, handler inline (`onclick=` e afins) ou `<script>` inline sem nonce/hash. Isso e do front; esta task so entrega o contrato.

## Cookies e proxy (como o back espera)

- O front e a API ficam na MESMA origem: `https://app.exemplo.com/` (front) e `https://app.exemplo.com/api/` (proxy para o back, TIRANDO o `/api`). O cookie de refresh e restrito a `/api/auth` (`NOTTA_API_PREFIXO`, padrao `/api`).
- `NOTTA_APP_URL=https://app.exemplo.com` (origem aceita na checagem de Origin do CSRF) e `NOTTA_TRUST_PROXY=1`.
- O nginx precisa repassar `X-Forwarded-For` e `X-Forwarded-Proto $scheme`: sem o segundo, o back nao sabe que e https e nao marca os cookies como `Secure` quando `NODE_ENV` for development (em producao `Secure` e sempre ligado).
- Nao hospedar nada de terceiros em subdominios do dominio do app (cookies sem prefixo `__Host-`: cookie tossing).
- A API tambem manda `Cache-Control: no-store` nas respostas que definem cookies.
