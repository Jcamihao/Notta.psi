# Notta.psi backend

NestJS 11 + Prisma 6 + Postgres.

## Pre-requisitos
- Node 20, npm 10
- Postgres 16 com os papeis `notta_owner` e `notta_app` (senhas SO de desenvolvimento)

## Banco local
- Docker: `docker compose up -d` na raiz do repo (porta 5436, roda `docker/initdb/01-roles.sql` no 1o start).
- Sem Docker: Postgres embutido em `~/.cache/notta-pgtool` (`./restart.sh`, ver `README.txt` la).

## Rodar
```bash
cd backend
npm install
cp .env.example .env            # e exporte as variaveis (o backend nao le .env sozinho)
export DATABASE_URL=postgresql://notta_app:notta_app@localhost:5436/notta_psi
export DATABASE_URL_OWNER=postgresql://notta_owner:notta_owner@localhost:5436/notta_psi
export NOTTA_MASTER_KEY=<64 hex, ver "Chave mestra" abaixo>
export NOTTA_JWT_SECRET=$(openssl rand -base64 48)   # >= 32 caracteres
npm run db:generate
npm run db:migrate              # prisma migrate deploy, roda como notta_owner (DATABASE_URL_OWNER)
npm run start:dev
curl localhost:3000/saude       # {"status":"ok"}
```

## Testes
```bash
npm test                        # unitarios (sem banco)
npm run test:e2e                # exige DATABASE_URL e DATABASE_URL_OWNER, falha alto sem elas
npm run lint && npm run format:check && npm run build
```

## Isolamento por clinica (RLS)
- Dois papeis: `notta_app` (runtime, `DATABASE_URL`, so SELECT/INSERT/UPDATE/DELETE, nao e dono) e `notta_owner` (dono das tabelas, `DATABASE_URL_OWNER`, so migrations).
- Toda tabela de dado de clinica tem RLS ENABLE + FORCE e policy `tenant_isolation` por `app.current_clinica_id`. Sem contexto = zero linhas.
- Acesso a dado de clinica so via `TenantPrismaService.run(clinicaId, tx => ...)` (unico lugar com `set_config`). Login usa `runLogin(email, tx => ...)` (policy `login_lookup`, so SELECT em Psicologo). Dentro de `fn`: sem I/O de rede e sem `run` aninhado.
- Migration nova: escreva a mao (`npx prisma migrate diff --from-url "$DATABASE_URL_OWNER" --to-schema-datamodel prisma/schema.prisma --script`) e acrescente ENABLE/FORCE/policy. Migration de DADOS com FORCE precisa de laco por clinica com `set_config`.
- Sem drift: `npx prisma migrate diff --from-url "$DATABASE_URL_OWNER" --to-schema-datamodel prisma/schema.prisma --exit-code` -> "No difference detected."

## Variaveis
Ver `.env.example` (PORT, DATABASE_URL, DATABASE_URL_OWNER, NOTTA_TRUST_PROXY, NOTTA_MASTER_KEY, NOTTA_JWT_SECRET, NOTTA_CORS_ORIGIN).
Obrigatorias no boot hoje: `DATABASE_URL`, `NOTTA_MASTER_KEY` e `NOTTA_JWT_SECRET`. Em producao (`NODE_ENV=production`) tambem `NOTTA_TRUST_PROXY` (`0` = sem proxy). Cada modulo novo valida a propria env.
- O `.env.example` traz `NOTTA_JWT_SECRET` e `NOTTA_MASTER_KEY` VAZIOS: gere os seus (comandos no arquivo).
- `NOTTA_JWT_SECRET`: o boot recusa menos de 32 caracteres, menos de 10 caracteres distintos e o antigo valor de exemplo.
- Papel do banco: no boot o backend confere que o papel de `DATABASE_URL` NAO e superuser, NAO tem BYPASSRLS e NAO e dono (nem membro do dono) de `Clinica`/`Psicologo`. Se for, o boot falha com `DATABASE_URL insegura: ...` (sem mostrar a URL). Use `notta_app`.

## Cadastro, login e /eu
Contrato completo: `.superpowers/sdd/fase-1/contrato.md`.
- `POST /clinicas` (publico): cria a clinica e o primeiro psicologo com papel `ADMIN`, numa transacao so. E-mail normalizado (trim + lowercase), unico global (409). Senha 8..72 bytes, bcrypt custo 12.
- `POST /auth/login` (publico): `{ token }` JWT HS256, 8 h, claims `sub` (psicologoId) e `clinicaId`. 401 identico para e-mail inexistente e senha errada (hash falso: mesmo tempo).
- `GET /eu` (Bearer): dados do psicologo e da clinica.
- `JwtAuthGuard` e GLOBAL: toda rota nova exige token. Rota publica precisa de `@Publico()` (hoje: `/saude`, `POST /clinicas`, `POST /auth/login`). O guard confere no banco que o psicologo ainda existe e le o papel fresco; use `@UsuarioAtual()` para pegar `{ psicologoId, clinicaId, papel }`.
- 401 SO para token invalido/expirado ou psicologo inexistente. Banco/pool fora responde 503 `{"statusCode":503,"message":"Servico indisponivel"}` com `Retry-After: 2` (o front so desloga no 401).
- Senhas: `bcrypt` NATIVO (roda no threadpool, nao trava o event loop), custo 12. Rota que calcula hash (login, cadastro de clinica, criacao de psicologo; a futura troca de senha tambem) leva `@TetoHash()`: no maximo 8 hashes ao mesmo tempo no processo; acima disso, 503 com `Retry-After: 1`.

## Equipe da clinica (so ADMIN)
- `POST /psicologos` (Bearer, ADMIN): `{ nome, email, senha, abordagemPadrao }` -> 201 `{ psicologoId }`. Mesmas regras do cadastro (e-mail normalizado e unico global = 409, senha 8..72 bytes, bcrypt 12). A clinica vem SO do token; o novo nasce `PSICOLOGO`. Campo extra (`clinicaId`, `papel`) = 400.
- `GET /psicologos` (Bearer, ADMIN): equipe da clinica do token, por `criadoEm` crescente, sem `senhaHash`.
- PSICOLOGO = 403 generico. Regra de acesso completa: `docs/ACESSO.md`.

## Limite de tentativas
- Login: 5/min por IP + e-mail e 20/min por IP. Cadastro de clinica: 5/h por IP. `POST /psicologos`: 20/h por psicologo do token (nao por IP). Conta sucesso e falha (e requisicao invalida). 429 com `Retry-After` em segundos.
- Toda rota autenticada: 300/min por psicologo, somado entre todas as rotas (throttler `api`, guard global `LimiteApiGuard` depois do JWT). Rotas `@Publico()` ficam de fora.
- IPv6: todo limite por IP conta o /64 inteiro como um IP (IPv4 nao muda).
- Armazenamento EM MEMORIA: vale para UMA instancia. Com mais instancias, trocar por Redis. Reiniciar o backend zera os contadores.
- Atras de proxy/load balancer: `NOTTA_TRUST_PROXY=<saltos>` para o IP real vir do `X-Forwarded-For`. Sem ela, o header e ignorado (todo mundo atras do proxy dividiria o mesmo limite). Em producao ela e obrigatoria (o boot falha sem ela); sem proxy, use `NOTTA_TRUST_PROXY=0`.
- Throttler novo: basta somar em `THROTTLERS` (`src/limite-tentativas/limite-tentativas.module.ts`); as rotas que nao o usam o pulam sozinhas (lista derivada em `limite()`).

## Seguranca HTTP
- `helmet()` com os padroes (nosniff, HSTS, CSP, frame SAMEORIGIN...). `x-powered-by` desligado.
- CORS desligado por padrao. `NOTTA_CORS_ORIGIN` liga para UMA origem exata (outras origens nao recebem `Access-Control-Allow-Origin`).
- A API e so JSON: o app sobe com `OPCOES_APP` (`bodyParser: false`) e so o parser JSON e registrado. Todo teste que cria o app passa `OPCOES_APP`. Corpo que nao e JSON (form etc.) = 415.
- Corpo JSON ate 256 kb (acima = 413 `Corpo muito grande`) e ate 32 niveis de `[`/`{` (acima = 400 `JSON invalido`).
- Erro do parser (JSON malformado, descompressao, charset, tamanho) responde corpo fixo, sem log e sem stack.

## Chave mestra (NOTTA_MASTER_KEY)
- Gere com `openssl rand -hex 32` (64 caracteres hex) e exporte antes de subir o backend.
- O conteudo clinico e cifrado com AES-256-GCM usando uma chave por clinica derivada dela (HKDF-SHA256).
- **Perder a chave = todo conteudo cifrado ilegivel para sempre.** Guarde backup fora do banco (cofre de senhas/secret manager), nunca no repo.
- Trocar a chave sem rotacao (feature futura) tambem deixa o conteudo antigo ilegivel.
- O boot recusa chave com todos os bytes iguais (inclui os 64 zeros do exemplo antigo).
- AAD obrigatorio: `cifrar(clinicaId, texto, aad)` e `decifrar(clinicaId, valor, aad)` com `aad = aadDe(tabela, coluna, id, psicologoId)` (`tabela|coluna|id|psicologoId`). O GCM autentica `v1.k1|<aad>`: cifrado copiado para outra linha, coluna ou dono falha com `falha ao decifrar`. Gravar com o id final da linha (gere o uuid antes do INSERT).
- Vetores independentes (Python) no `criptografia.service.spec.ts`: HKDF (chave por clinica) e um cifrado AES-GCM com AAD.
