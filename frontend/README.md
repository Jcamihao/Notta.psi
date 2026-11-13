# praxis.psi — frontend

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
Sem o backend, rode um servidor falso que segue `contrato.md` (ATENCAO: este exemplo e anterior a
sessao por cookie; o login dele devolve `token` e o front agora nao o le. Ajuste-o para cookies
ou use o back real). Ele fica FORA do repo, por
exemplo em `/tmp/praxis-falso/falso.mjs` (so Node, sem dependencia):

```js
import http from 'node:http';
const conta = (nome, papel, criadoEm) => ({
  senha: 'senha-forte-1',
  nome,
  papel,
  abordagemPadrao: 'TCC',
  clinica: 'Clinica Horizonte',
  criadoEm,
  provisoria: false,
});
const contas = new Map([
  ['ana@clinica.com', conta('Ana Souza', 'ADMIN', '2026-03-12T14:00:00.000Z')],
  ['bruno@clinica.com', conta('Bruno Lima', 'PSICOLOGO', '2026-10-01T14:00:00.000Z')],
  [
    'carla@clinica.com',
    { ...conta('Carla Dias', 'PSICOLOGO', '2026-10-20T14:00:00.000Z'), provisoria: true },
  ],
]);
const tokens = new Map();
const responder = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
};
const proibido = { statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' };
const trocaObrigatoria = {
  statusCode: 403,
  message: 'Troca de senha obrigatoria',
  error: 'Forbidden',
};
const novoToken = (email) => {
  const t = 'falso.' + Math.random().toString(36).slice(2);
  tokens.set(t, email);
  return t;
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
          { statusCode: 429, message: 'Muitas tentativas. Tente mais tarde.' },
          { 'Retry-After': '30' },
        );
      if (rota === 'POST /clinicas') {
        if (contas.has(email))
          return responder(res, 409, { statusCode: 409, message: 'E-mail ja cadastrado' });
        contas.set(email, {
          ...conta(b.nomePsicologo, 'ADMIN', new Date().toISOString()),
          senha: b.senha,
          clinica: b.nomeClinica,
        });
        return responder(res, 201, { clinicaId: 'c1', psicologoId: 'p1' });
      }
      if (rota === 'POST /auth/login') {
        if (contas.get(email)?.senha !== b.senha)
          return responder(res, 401, { statusCode: 401, message: 'Credenciais invalidas' });
        return responder(res, 200, { token: novoToken(email) });
      }
      const dono = tokens.get(String(req.headers.authorization).replace('Bearer ', ''));
      const eu = contas.get(dono);
      if (!eu) return responder(res, 401, { statusCode: 401, message: 'Unauthorized' });
      if (eu.provisoria && rota !== 'GET /eu' && rota !== 'POST /auth/trocar-senha')
        return responder(res, 403, trocaObrigatoria);
      if (rota === 'GET /eu')
        return responder(res, 200, {
          psicologoId: dono,
          nome: eu.nome,
          email: dono,
          papel: eu.papel,
          abordagemPadrao: eu.abordagemPadrao,
          clinica: { id: 'c1', nome: eu.clinica },
          senhaProvisoria: eu.provisoria,
        });
      if (rota === 'POST /auth/trocar-senha') {
        const nova = String(b.novaSenha ?? '');
        if (nova.startsWith('limite'))
          return responder(
            res,
            429,
            { statusCode: 429, message: 'Muitas tentativas. Tente mais tarde.' },
            { 'Retry-After': '30' },
          );
        if (b.senhaAtual !== eu.senha)
          return responder(res, 422, { statusCode: 422, message: 'Senha atual incorreta' });
        const bytes = Buffer.byteLength(nova);
        if (bytes < 8 || bytes > 72 || nova === b.senhaAtual)
          return responder(res, 400, { statusCode: 400, message: ['novaSenha invalida'] });
        eu.senha = nova;
        eu.provisoria = false;
        for (const [t, e] of tokens) if (e === dono) tokens.delete(t); // derruba os tokens antigos
        return responder(res, 200, { token: novoToken(dono) });
      }
      if (req.url === '/psicologos' && eu.papel !== 'ADMIN') return responder(res, 403, proibido);
      if (rota === 'GET /psicologos')
        return responder(
          res,
          200,
          [...contas]
            .filter(([, c]) => c.clinica === eu.clinica)
            .map(([e, c]) => ({
              psicologoId: e,
              nome: c.nome,
              email: e,
              papel: c.papel,
              abordagemPadrao: c.abordagemPadrao,
              criadoEm: c.criadoEm,
            })),
        );
      if (rota === 'POST /psicologos') {
        if (email.startsWith('proibido@')) return responder(res, 403, proibido);
        if (contas.has(email))
          return responder(res, 409, { statusCode: 409, message: 'E-mail ja cadastrado' });
        contas.set(email, {
          ...conta(b.nome.trim(), 'PSICOLOGO', new Date().toISOString()),
          senha: b.senha,
          abordagemPadrao: b.abordagemPadrao,
          clinica: eu.clinica,
          provisoria: true,
        });
        return responder(res, 201, { psicologoId: email });
      }
      responder(res, 404, { statusCode: 404, message: 'Not Found' });
    });
  })
  .listen(3000, () => console.log('servidor falso na porta 3000'));
```

```bash
node /tmp/praxis-falso/falso.mjs   # terminal 1
npm start                         # terminal 2, abra http://localhost:4200/cadastro
```

Contas prontas (senha `senha-forte-1`): `ana@clinica.com` (ADMIN), `bruno@clinica.com`
(PSICOLOGO) e `carla@clinica.com` (PSICOLOGO com senha provisoria). Cadastrar com elas da 409. Qualquer e-mail comecando com `limite@` responde 429
com `Retry-After: 30`. Senha errada da 401.

### Tela de equipe (`/equipe`, so ADMIN)

1. Entre como `ana@clinica.com`: o menu lateral mostra o link **Equipe**.
2. A tabela lista Ana (Administrador) e Bruno (Psicologo).
3. Adicione alguem com e-mail novo: a pessoa aparece na lista e uma confirmacao lembra de
   combinar a senha inicial por canal seguro. O campo senha fica vazio.
4. E-mail ja usado (ex.: `bruno@clinica.com`): erro no campo e-mail.
5. E-mail comecando com `limite@`: "Muitas tentativas. Tente de novo em 30 segundos."
6. E-mail comecando com `proibido@`: o servidor falso responde 403 e a tela volta para `/`.
7. Saia e entre como `bruno@clinica.com`: sem link Equipe; abrir `/equipe` na mao volta para `/`.

### Troca de senha (`/trocar-senha`)

Obrigatoria (senha provisoria):

1. Entre como `carla@clinica.com`: qualquer rota cai em `/trocar-senha`, com o aviso "Defina uma
   senha só sua para continuar." O menu lateral mostra so o nome e o botao **Sair** (sem links).
2. Senha atual errada: "Senha atual incorreta…" no campo senha atual; os tres campos ficam vazios.
3. Nova senha comecando com `limite`: "Muitas tentativas. Tente de novo em 30 segundos."
4. Confirmacao diferente, nova igual a atual ou mais de 72 bytes: o erro aparece no campo, sem
   chamar o servidor.
5. Atual `senha-forte-1` e uma nova valida: volta para `/` com "Senha alterada…"; o menu
   lateral volta ao normal. A nova senha passa a valer no login.

Voluntaria: entre como `ana@` ou `bruno@` e use o link **Trocar senha** do menu lateral.

Contas criadas em `/equipe` nascem com senha provisoria (como no back real).

## Visual

Fonte do visual: `docs/DESIGN-SYSTEM.md` (design system "intelly"). Tokens em
`src/styles/tokens.scss`, componentes em `src/app/ui/`. A fonte da marca (Red Hat Text e Red Hat Display) vem dos pacotes
`@fontsource/red-hat-text` (400/500/600/700) e `@fontsource/red-hat-display` (700/900), subset latin, entram pelo `styles` do `angular.json` e os
icones do `lucide-angular` (importados um a um): nenhuma requisicao sai de localhost.

## Sessao

A sessao vive em cookies `httpOnly` (acesso de 15 min, refresh de ate 7 dias, parado ate 30 min);
o JS nao le o token e nada de sessao fica em `sessionStorage`/`localStorage` (itens 46 e 49). O
front so le o cookie `praxis_csrf` (nao httpOnly de proposito) e nunca manda `Authorization` nem
`x-praxis-cliente`. Back e front ficam na mesma origem (proxy `/api`); em dev o back precisa de
`PRAXIS_APP_URL=http://localhost:4200` (Origin do CSRF) e `PRAXIS_CORS_ORIGIN` igual.

- `SessaoStore` e o estado da sessao: o que `GET /api/eu` diz (`usuario`, `ehAdmin()`,
  `senhaProvisoria()`, `autenticado()`). `garantir()` consulta o `/eu` UMA vez (o primeiro guard
  que rodar); 401 = visitante, sem erro. O login devolve `{usuario}` e `entrar(usuario)` o guarda.
  Rota publica (`/termo/:token`) nao tem guard, entao nao consulta o `/eu`.
- Guards (`auth`, `visitante`, `admin`, `senhaProvisoria`) esperam `garantir()` e decidem pelo
  estado. `adminGuard`: ADMIN entra, outro papel vai para `/`, sem sessao vai para `/login`. O
  servidor continua sendo a autoridade (403).
- `authInterceptor` (so `/api/`, nunca `/api/publico/`): anexa `X-CSRF-Token` em POST/PUT/PATCH/
  DELETE (menos `login`, `clinicas` e `renovar`, que ainda nao tem sessao). Em 401 de rota
  autenticada chama `POST /api/auth/renovar` UMA vez e repete a chamada; chamadas concorrentes
  dividem a mesma renovacao e abas diferentes se serializam por Web Locks (dentro da trava, um
  `GET /eu` confere se outra aba ja renovou). Renovacao negada (401) ou repeticao com 401: limpa o
  estado e vai ao login com "Sua sessao expirou, entre de novo." (so se havia sessao: visitante
  abrindo o app nao ve aviso). 503, 429, rede e 403 nao derrubam a sessao. Sem renovar em 401 de
  login/cadastro/renovar nem no "sair".
- Senha provisoria (itens 62 e 57): o `senhaProvisoriaGuard` manda qualquer rota do shell para
  `/trocar-senha`. 403 `"Troca de senha obrigatoria"` em qualquer chamada: o interceptor refaz o
  `/eu` e vai para `/trocar-senha`. Trocar a senha mantem a sessao (o servidor so reemite o cookie
  de acesso): `sessao.senhaTrocada()` tira a marca provisoria.
- "Sair" chama `POST /api/auth/sair` e vai ao login (limpa o estado mesmo se o servidor falhar).
  "Sair de todos os aparelhos" (menu da conta, com confirmacao inline) chama
  `POST /api/auth/sair-de-todos`.

## Senha forte (item 45)

Cadastro, "Criar colega" (Equipe) e "Trocar senha" usam `<app-senha-dica>` (`src/app/ui/senha-dica.component.ts`, regras em `src/app/core/senha-regras.ts`): lista de regras que atualiza enquanto a pessoa digita (10+ caracteres, nao e so repeticao/sequencia, nao contem o nome nem o e-mail), com o estado de cada regra em TEXTO ("Atende" / "Nao atende" para leitor de tela, icone de forma diferente) e um resumo em `aria-live="polite"`. So orienta: a senha nunca sai do navegador pela dica. O cliente so BLOQUEIA o que e certo no navegador (menos de 10 caracteres, mais de 72 bytes). "Senha comum" (lista do servidor, que nao vai ao navegador), "contem seu nome/e-mail" e "sequencia" voltam como 422 com `motivo` (`CURTA`, `COMUM`, `PESSOAL`, `REPETIDA`) e aparecem no campo da senha em linguagem simples (`erroDeSenhaFraca` em `core/formulario.ts`). Em Trocar senha, 422 COM `motivo` vai no campo da nova senha; 422 SEM `motivo` continua sendo "Senha atual incorreta". Os campos de nova senha usam `autocomplete="new-password"`.

## CSP do build (item 49)

Depois do build de producao: `npm run build && npm run verificar:csp` (falha se o `dist` tiver
`eval(`, `new Function(`, handler inline, `<script>`/`<style>` inline sem hash ou o `<app-root>` sem
`ngCspNonce`); `npm run test:csp` prova que a verificacao falha de verdade. Cabecalhos que o
servidor precisa mandar: `docs/SEGURANCA-HEADERS.md`.

## Estrutura

```
src/
  app/
    core/      sessao.store, usuario.store, auth.interceptor, guards, formulario (validacao e erros)
    layout/    shell.component (menu lateral escuro; abaixo de 832px vira barra superior com botao Menu),
               acesso.component (moldura de login/cadastro com o painel de sigilo)
    ui/        componentes do design system: button, icon-button, pill, nav-item, avatar
    pages/     login, cadastro, equipe (so ADMIN), trocar-senha, inicio (placeholder)
    app.routes.ts   rotas com lazy loading (loadComponent)
  styles/tokens.scss   tokens do design system intelly (docs/DESIGN-SYSTEM.md), CSS custom properties
  styles.scss          estilos globais
```
