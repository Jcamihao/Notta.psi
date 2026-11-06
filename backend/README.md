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
export NOTTA_JWT_SECRET=$(openssl rand -base64 48)   # >= 32 caracteres, 16+ distintos
export NODE_ENV=development     # sem isto o boot exige NOTTA_TRUST_PROXY (0 = sem proxy)
npm run db:generate
npm run db:migrate              # prisma migrate deploy, roda como notta_owner (DATABASE_URL_OWNER)
# uma vez por banco, como SUPERUSER (lo_create nao se revoga em migration):
psql -U postgres -d notta_psi -f prisma/bootstrap/endurecer-banco.sql   # docker: ja roda no 1o start (02-endurecer-banco.sh)
npm run start:dev
curl localhost:3000/saude       # {"status":"ok"}
```

## Testes
```bash
npm test                        # unitarios (sem banco)
npm run test:e2e                # exige DATABASE_URL e DATABASE_URL_OWNER, falha alto sem elas. Roda 2 grupos em sequencia:
                                # (1) paralelo (jest-e2e.json) e (2) EM SERIE (jest-e2e-serial.json): as suites que
                                # fazem DDL com FK para Psicologo (acesso*) e a de carga (carga-clinicas), isoladas
                                # das demais (DDL entra na fila do lock e atrasa o resto; carga mede latencia),
                                # e as 3 que fazem TRUNCATE como dono (documentos-rls, auditoria-rls,
                                # consentimento-rls): TRUNCATE pede lock exclusivo e, em paralelo com outra suite
                                # mexendo na mesma tabela, da deadlock ou lock_timeout (flake corrigido no item 25)
npm run lint && npm run format:check && npm run build
```

## Isolamento por clinica (RLS)
- Dois papeis: `notta_app` (runtime, `DATABASE_URL`, so SELECT/INSERT/UPDATE/DELETE, nao e dono) e `notta_owner` (dono das tabelas, `DATABASE_URL_OWNER`, so migrations).
- Toda tabela de dado de clinica tem RLS ENABLE + FORCE e policy `tenant_isolation` por `app.current_clinica_id`. Sem contexto = zero linhas.
- Acesso a dado de clinica so via `TenantPrismaService.run(clinicaId, tx => ...)` (unico lugar com `set_config`). Login usa `runLogin(email, tx => ...)` (policy `login_lookup`, so SELECT em Psicologo). Dentro de `fn`: sem I/O de rede e sem `run` aninhado.
- Migration nova: escreva a mao (`npx prisma migrate diff --from-url "$DATABASE_URL_OWNER" --to-schema-datamodel prisma/schema.prisma --script`) e acrescente ENABLE/FORCE/policy. Migration de DADOS com FORCE precisa de laco por clinica com `set_config`.
- Sem drift: `npx prisma migrate diff --from-url "$DATABASE_URL_OWNER" --to-schema-datamodel prisma/schema.prisma --exit-code` -> "No difference detected."

## Barreiras no banco (Psicologo e Clinica)
Migration `20261031210000_barreiras_psicologo_clinica` (detalhes em `docs/ACESSO.md`): INSERT em `Psicologo` so de colega provisorio ou do 1o ADMIN da clinica; sem DELETE em `Psicologo` e sem UPDATE/DELETE em `Clinica` para o `notta_app`; trigger `psicologo_barreira_update` (senha provisoria, `tokenVersao` e, desde o item 58, `ativo`: desativar nunca volta atras). Codigo novo que escreva em `Psicologo` tem de caber nessas regras. Teste de banco: `test/acesso-psicologo.e2e-spec.ts`. `lo_create` fica de fora da migration (o owner nao consegue revogar): `prisma/bootstrap/endurecer-banco.sql`, como superuser, uma vez por banco; o teste confere.

## Trilha de auditoria (item 11)
Tabela `Auditoria` (migration `20261101120000_auditoria`), modulo `src/auditoria/`: quem fez o que em que recurso e quando, sem conteudo, nome nem IP. `AuditoriaService.registrar(tx, user, acao, recurso, recursoId?)` grava na MESMA transacao da acao (as 4 rotas de `/pacientes` ja chamam). Somente-acrescentar: `notta_app` so SELECT/INSERT, RLS FORCE por psicologo, trigger barra UPDATE/DELETE/TRUNCATE ate para o dono. Limpeza de teste: `apagarClinicas` liga `app.limpeza_de_teste` (so o dono apaga). Detalhes e o que NAO registra: `docs/ACESSO.md`. Ver as linhas: `docker exec -i nottapsi-postgres-1 psql -U postgres -d notta_psi -c 'SELECT acao, recurso, "recursoId", "criadoEm" FROM "Auditoria" ORDER BY "criadoEm" DESC LIMIT 10'` (superuser ignora o RLS).

## Variaveis
Ver `.env.example` (PORT, DATABASE_URL, DATABASE_URL_OWNER, NOTTA_TRUST_PROXY, NOTTA_MASTER_KEY, NOTTA_JWT_SECRET, NOTTA_CORS_ORIGIN, NOTTA_API_PREFIXO, NOTTA_IA_HABILITADA, SELAHIA_URL, SELAHIA_API_KEY, NOTTA_IA_LIMITE_DIARIO, NOTTA_APP_URL, NOTTA_TERMO_REVISADO).
Obrigatorias no boot hoje: `DATABASE_URL`, `NOTTA_MASTER_KEY` e `NOTTA_JWT_SECRET`. `NOTTA_TRUST_PROXY` tambem e obrigatoria (`0` = sem proxy), EXCETO quando `NODE_ENV` (aparado, sem caixa) e `development` ou `test`: `Production`, ` production `, `staging` ou `NODE_ENV` ausente (comum em imagem Docker) exigem a variavel. No dev local use `NODE_ENV=development`. Cada modulo novo valida a propria env.
- O `.env.example` traz `NOTTA_JWT_SECRET` e `NOTTA_MASTER_KEY` VAZIOS: gere os seus (comandos no arquivo).
- `NOTTA_JWT_SECRET`: o boot recusa (apara e ignora caixa) menos de 32 caracteres, menos de 16 caracteres distintos, e qualquer valor que CONTENHA um segredo conhecido (o antigo exemplo do repo, `0123456789abcdef...`, `my-super-secret-jwt-key-for-production` e os segredos das suites de teste, com prefixo ou sufixo). Lista em `src/comum/segredos-conhecidos.ts`. As suites de teste usam os segredos de teste so porque `test/permite-segredo-de-teste.ts` define `NOTTA_PERMITE_SEGREDO_DE_TESTE=1`; nunca defina essa variavel fora de teste.
- Papel do banco: no boot o backend confere que o papel de `DATABASE_URL` NAO e superuser, NAO tem BYPASSRLS e NAO e dono (nem membro do dono) de `Clinica`/`Psicologo`. Se for, o boot falha com `DATABASE_URL insegura: ...` (sem mostrar a URL). Use `notta_app`.

## Cadastro, login e /eu
Contrato completo: `.superpowers/sdd/fase-1/contrato.md`.
- `POST /clinicas` (publico): cria a clinica e o primeiro psicologo com papel `ADMIN`, numa transacao so. E-mail normalizado (trim + lowercase), unico global (409). Senha forte (item 45): ate 72 bytes (400 se passar) e a politica abaixo (422 com `motivo`); bcrypt custo 12.
- `POST /auth/login` (publico, exige `Origin`): 200 `{ usuario }` (os mesmos dados do `GET /eu`) e 3 cookies (ver "Sessao segura"). Com o cabecalho `x-notta-cliente: api` (so clientes que NAO sao navegador; o front nunca manda) o corpo traz tambem `token` (JWT de acesso, 15 min, para `Authorization: Bearer`). JWT HS256, claims `sub` (psicologoId), `clinicaId`, `tv` (versao do token = `Psicologo.tokenVersao`) e `sid` (id da sessao). 401 identico para e-mail inexistente e senha errada (hash falso: mesmo tempo).
- `GET /eu` (cookie ou Bearer): dados do psicologo e da clinica, com `senhaProvisoria` (true = criado pelo ADMIN e ainda nao trocou).
- `POST /auth/trocar-senha` (cookie ou Bearer): `{ senhaAtual, novaSenha }` (novaSenha ate 72 bytes e senha forte, ver "Politica de senha"; diferente da atual = 400) -> 200 `{ ok: true }` (com `x-notta-cliente: api`, tambem `token`) e cookie de acesso novo (mesma sessao, `tv` novo). Senha atual errada = 422 `Senha atual incorreta` (nao 401: o front desloga em todo 401). Incrementa `tokenVersao`: os acessos anteriores da conta viram 401, e as OUTRAS sessoes (outros aparelhos) sao revogadas (`SENHA_TROCADA`). Limite 10/h por psicologo; `@TetoHash()`.
- Senha provisoria (item 62): o guard responde 403 `{"statusCode":403,"message":"Troca de senha obrigatoria","error":"Forbidden"}` em toda rota autenticada, salvo as marcadas com `@PermiteSenhaProvisoria()` (hoje `GET /eu` e `POST /auth/trocar-senha`). Rota nova nasce bloqueada (falha fechada).
- `JwtAuthGuard` e GLOBAL: toda rota nova exige token. Rota publica precisa de `@Publico()` (hoje: `/saude`, `POST /clinicas`, `POST /auth/login`, `POST /auth/renovar` e o termo). O guard confere no banco que o psicologo ainda existe, que o `tv` do token e igual ao `tokenVersao` (diferente ou ausente = 401), que a SESSAO (`sid`) existe, nao foi revogada e esta dentro dos 7 dias, e le papel e `senhaProvisoria` frescos; use `@UsuarioAtual()` para pegar `{ psicologoId, clinicaId, papel, senhaProvisoria }` e `@SessaoAtual()` para `{ id, familia }`.
- 401 SO para token invalido/expirado ou psicologo inexistente. Banco/pool fora responde 503 `{"statusCode":503,"message":"Servico indisponivel"}` com `Retry-After: 2` (o front so desloga no 401). Pool/transacao esgotados DENTRO da rota (Prisma `P2024`/`P2028`) tambem: filtro global `BancoIndisponivelFilter`, mesmo corpo e `Retry-After: 2`, sem log nem detalhe.
- **Politica de senha (item 45):** vale ao definir ou trocar senha (`POST /clinicas`, `POST /psicologos`, `POST /auth/trocar-senha`), NAO no login. 422 `{ statusCode, message: 'Senha fraca: ...', motivo }` com `motivo` = `CURTA` (menos de 10 caracteres), `REPETIDA` (um caractere ou unidade curta repetida, ou sequencia como `1234567890`, `abcdefghij`, `qwertyuiop`), `PESSOAL` (igual ao e-mail ou contem a parte local do e-mail ou uma palavra do nome com 3+ letras) ou `COMUM` (na lista local `src/auth/senhas-comuns.txt`, sem caixa/acento, com leetspeak e fim cortado: `Senha1234!` cai). A lista fica so no servidor (nunca no corpo do erro) e e carregada uma vez no boot; o build copia o `.txt` para `dist/` (`nest-cli.json`, `assets`). Codigo: `src/auth/politica-senha.ts`. Regras completas, limite e o residual de enumeracao de e-mail (409 do cadastro e da equipe): `docs/ACESSO.md`. Origem e licenca da lista: `docs/LICENCAS.md`.
- Senhas: `bcrypt` NATIVO (roda no threadpool, nao trava o event loop), custo 12. Rota que calcula hash (login, cadastro de clinica, criacao de psicologo, troca de senha) leva `@TetoHash()`: no maximo 8 hashes ao mesmo tempo no processo E no maximo 2 por tracker de IP (o /64 inteiro no IPv6), para um IP so nao segurar todas as vagas; acima disso, 503 com `Retry-After: 1`. Limite conhecido: uma botnet distribuida (muitos IPs, 2 vagas cada) ainda ocupa as 8 vagas e derruba o login de todos; isso se resolve na borda (WAF ou limite por conexao no proxy), nao no app.

## Sessao segura (itens 46 e 49, back)
Decisao do dono (2026-11-05): acesso de 15 min que se renova sozinho, sessao maxima de 7 dias, queda apos 30 min parado, "sair de todos os aparelhos". Modelo, tabela e RLS: `docs/ACESSO.md` (secao "Sessao segura").
- **Cookies** (nomes fixos, sem prefixo `__Host-`: o front le o CSRF pelo nome, o refresh precisa de `Path` proprio e `__Host-` exige Path=/): `notta_acesso` (JWT 15 min, `HttpOnly`, `SameSite=Lax`, `Path=<prefixo>`), `notta_refresh` (32 bytes aleatorios, `HttpOnly`, `SameSite=Strict`, `Path=<prefixo>/auth`, dura ate o limite de 7 dias) e `notta_csrf` (legivel por JS, `SameSite=Lax`, `Path=/`). `Secure` quando a requisicao e https (com `NOTTA_TRUST_PROXY`, vale o `X-Forwarded-Proto`) ou `NODE_ENV` nao e development/test. Sem `Domain`.
- `<prefixo>` = `NOTTA_API_PREFIXO` (padrao `/api`, como o navegador ve a API atras do proxy; vazio = API na raiz; invalido derruba o boot).
- `POST /auth/renovar` (publica, sem corpo, exige `Origin`, 30/min por IP /64): rotaciona o refresh (o antigo vira `usadoEm`, nasce linha nova da mesma familia) e emite acesso novo. Refresh ja usado = REUSO: revoga a familia inteira, grava auditoria `REFRESH_REUSADO`, 401. Parado mais de 30 min ou acima de 7 dias = 401 (familia `EXPIROU`). Psicologo desativado = 401. Qualquer falha = o MESMO 401 `{"statusCode":401,"message":"Unauthorized"}` e os 3 cookies sao limpos. Com `x-notta-cliente: api`, o corpo traz `token`.
- `POST /auth/sair` (revoga a familia da sessao atual), `POST /auth/sair-de-todos` (revoga TODAS as do psicologo, auditoria `SAIU_DE_TODOS` na mesma transacao): 200 `{ ok: true }`, cookies limpos, valem na HORA (nao esperam os 15 min do JWT). Nao ficam presos a senha provisoria.
- **CSRF** (`CsrfGuard`, global, antes do JWT): requisicao autenticada por COOKIE com metodo POST/PUT/PATCH/DELETE exige `X-CSRF-Token` igual ao cookie `notta_csrf` E `Origin` (ou `Referer`) igual a `NOTTA_APP_URL`/`NOTTA_CORS_ORIGIN` (em dev/test, sem elas, `http://localhost:4200`); senao 403 `Requisicao recusada`. `login`, `POST /clinicas` e `renovar` (marcadas `@OrigemApenas()`) exigem so a Origin. `Authorization: Bearer` e as rotas `@Publico()` do termo ficam fora. Cliente que nao e navegador usa Bearer; no login/cadastro/renovar ele precisa mandar `Origin` igual a `NOTTA_APP_URL`.
- Env nova: `NOTTA_API_PREFIXO` (opcional). `NOTTA_APP_URL` agora tambem define a origem do CSRF (ja era obrigatoria fora de dev/test).
- Cabecalhos/CSP do FRONT (servidor web, nao este back): `docs/SEGURANCA-HEADERS.md` e `deploy/nginx-notta.conf.example`.
- Limites conhecidos: duas abas que renovam no MESMO instante (o refresh cai no reuso da 2a e derruba a familia): o front precisa serializar a renovacao entre abas (Web Locks). O JWT de acesso so existe para o navegador no cookie; sem `x-notta-cliente: api` o login nao devolve token.

## Equipe da clinica (so ADMIN)
- `POST /psicologos` (Bearer, ADMIN): `{ nome, email, senha, abordagemPadrao }` -> 201 `{ psicologoId }`. Mesmas regras do cadastro (e-mail normalizado e unico global = 409, senha forte com 422, bcrypt 12). A clinica vem SO do token; o novo nasce `PSICOLOGO` com `senhaProvisoria = true` (troca obrigatoria no 1o acesso: o ADMIN nao fica com acesso a conta do colega). Campo extra (`clinicaId`, `papel`) = 400.
- `GET /psicologos` (Bearer, ADMIN): equipe da clinica do token, por `criadoEm` crescente, sem `senhaHash`. Cada item traz `ativo` e `desativadoEm` (o 201 do `POST` tambem).
- `POST /psicologos/:id/desativar` (Bearer, ADMIN, sem corpo, item 58): 200 `{ id, nome, email, papel, abordagemPadrao, ativo: false, desativadoEm }`. O colega perde o acesso na hora (guard e login: 401 igual ao de usuario inexistente); pacientes, documentos e trilha ficam guardados e ninguem le. 409 `Psicologo ja desativado` ou `Nao e possivel desativar este usuario` (a si mesmo ou outro ADMIN); 404 para outra clinica ou id inexistente; 403 para PSICOLOGO. Nao ha reativacao e o e-mail do desativado continua ocupado (409 ao recriar). Audita `DESATIVOU` (recurso `Psicologo`) na mesma transacao. Banco: policy `psicologo_desativar_colega` + trigger `psicologo_barreira_update` (teste `test/psicologo-desativar-rls.e2e-spec.ts`; HTTP em `test/equipe-desativar.e2e-spec.ts`). Detalhes em `docs/ACESSO.md`.
- PSICOLOGO = 403 generico. Regra de acesso completa: `docs/ACESSO.md`.

## Pacientes (qualquer usuario autenticado)
Tabela `Paciente`, RLS `psicologo_proprio` (cada psicologo ve so os proprios, ADMIN tambem), nome, nascimento, telefone e e-mail CIFRADOS (AES-256-GCM, AAD com tabela, coluna, id e psicologo). Detalhes em `docs/ACESSO.md`. Resposta nunca traz colunas `*Cifrado`; nome/telefone/e-mail/nascimento nunca vao para log.
- `POST /pacientes` `{ nome (1..120), nascimento? 'YYYY-MM-DD' (real, >= 1900-01-01, nao futura), telefone? (8..20, so digitos, espaco, +, -, parenteses), email? (<= 254) }` -> 201 `{ id, nome, nascimento|null, telefone|null, email|null, criadoEm }`.
- `GET /pacientes` -> 200 array dos PROPRIOS, ordenado por nome (pt-BR, sem caixa/acento), teto de 500.
- `GET /pacientes/:id` -> 200 igual ao POST. Inexistente, de colega ou de outra clinica = o MESMO 404 `Paciente nao encontrado`. `:id` que nao e uuid = 400.
- `PATCH /pacientes/:id` corpo parcial dos mesmos campos; `null` limpa nascimento/telefone/e-mail; `nome` nao aceita null; corpo vazio = 400; 404 igual ao GET.
- Campo extra (`clinicaId`, `psicologoId`, `id`) = 400; sem token = 401; senha provisoria = 403 `Troca de senha obrigatoria`. Sem DELETE (item 26).

## Limite de tentativas
- Login: 5/min por IP + e-mail e 20/min por IP. `POST /auth/renovar`: 30/min por IP. Cadastro de clinica: 5/h por IP. `POST /psicologos`: 20/h por psicologo do token (nao por IP). `POST /auth/trocar-senha`: 10/h por psicologo do token. Conta sucesso e falha (e requisicao invalida). 429 com `Retry-After` em segundos.
- Toda rota autenticada: 300/min por psicologo, somado entre todas as rotas (throttler `api`), mais no maximo 5 requisicoes SIMULTANEAS por psicologo. Os dois sao contados no `JwtAuthGuard`, depois da assinatura do token e ANTES de qualquer acesso ao banco: requisicao barrada nao gasta conexao do pool, entao um usuario nao degrada as outras clinicas. A resposta 429 desses dois casos so sai depois de 1 s (tarpit, `RECUSA_ATRASO_MS`): recusar na hora faz o atacante repetir o pedido sem parar e saturar o event loop (medido: 500 conexoes em laco deixavam a vitima com 1 a 3 s por requisicao mesmo com 429 barato). Rotas `@Publico()` ficam de fora.
- IPv6: todo limite por IP conta o /64 inteiro como um IP (IPv4 nao muda).
- Armazenamento EM MEMORIA: vale para UMA instancia. Com mais instancias, trocar por Redis. Reiniciar o backend zera os contadores.
- Atras de proxy/load balancer: `NOTTA_TRUST_PROXY=<saltos>` para o IP real vir do `X-Forwarded-For`. Sem ela, o header e ignorado (todo mundo atras do proxy dividiria o mesmo limite). Ela e obrigatoria (o boot falha sem ela) salvo `NODE_ENV=development` ou `test`; sem proxy, use `NOTTA_TRUST_PROXY=0`.
- Throttler novo: basta somar em `THROTTLERS` (`src/limite-tentativas/limite-tentativas.module.ts`); as rotas que nao o usam o pulam sozinhas (lista derivada em `limite()`).

## Seguranca HTTP
- `helmet()` com os padroes (nosniff, HSTS, CSP, frame SAMEORIGIN...). `x-powered-by` desligado.
- CORS desligado por padrao. `NOTTA_CORS_ORIGIN` liga para UMA origem exata (outras origens nao recebem `Access-Control-Allow-Origin`). O modo suportado com cookies e MESMA ORIGEM atras de proxy (`/api`); CORS nao libera credenciais.
- A API e so JSON: o app sobe com `OPCOES_APP` (`bodyParser: false`) e so o parser JSON e registrado. Todo teste que cria o app passa `OPCOES_APP`. Corpo que nao e JSON (form etc.) = 415.
- Corpo JSON ate 256 kb (acima = 413 `Corpo muito grande`), ate 32 niveis de `[`/`{` (acima = 400 `JSON invalido`) e charset utf-8 apenas (ausente vale; `utf-16*`, `latin1`, `utf8` etc. = 415 com corpo fixo, antes de contar profundidade).
- Erro do parser (JSON malformado, descompressao, charset, tamanho) responde corpo fixo, sem log e sem stack.

## Chave mestra (NOTTA_MASTER_KEY)
- Gere com `openssl rand -hex 32` (64 caracteres hex) e exporte antes de subir o backend.
- O conteudo clinico e cifrado com AES-256-GCM usando uma chave por clinica derivada dela (HKDF-SHA256).
- **Perder a chave = todo conteudo cifrado ilegivel para sempre.** Guarde backup fora do banco (cofre de senhas/secret manager), nunca no repo.
- Trocar a chave sem rotacao (feature futura) tambem deixa o conteudo antigo ilegivel.
- O boot recusa chave com menos de 16 bytes distintos (inclui os 64 zeros do exemplo antigo e `00..01`) e as chaves das suites de teste (estas so passam com `NOTTA_PERMITE_SEGREDO_DE_TESTE=1`, definida apenas pelos helpers de teste).
- AAD obrigatorio: `cifrar(clinicaId, texto, aad)` e `decifrar(clinicaId, valor, aad)` com `aad = aadDe(tabela, coluna, id, psicologoId)` (`tabela|coluna|id|psicologoId`). O GCM autentica `v1.k1|<aad>`: cifrado copiado para outra linha, coluna ou dono falha com `falha ao decifrar`. Gravar com o id final da linha (gere o uuid antes do INSERT).
- Vetores independentes (Python) no `criptografia.service.spec.ts`: HKDF (chave por clinica) e um cifrado AES-GCM com AAD.

### Varias chaves (rotacao, item 25, parte A)
- `NOTTA_MASTER_KEYS=k1:<hex>,k2:<hex>` e `NOTTA_MASTER_KEY_ATUAL=k2`. `cifrar` usa a ATUAL (grava o kid no valor). `decifrar` le o kid do proprio valor; kid fora da lista = `falha ao decifrar`, nunca cai para a atual.
- Sem `NOTTA_MASTER_KEYS`, vale o de sempre: `NOTTA_MASTER_KEY` vira `k1` e e a atual. Valores `v1.k1.*` antigos continuam legiveis.
- Boot falha (sem ecoar chave): as duas formas juntas; `NOTTA_MASTER_KEYS` sem `NOTTA_MASTER_KEY_ATUAL`; atual fora da lista; kid fora de `k<numero>` ou repetido; chave que nao passa nas mesmas validacoes da unica.
- `recifrarValor(clinicaId, valor, aad)`: decifra com o kid do valor e cifra com a atual; ja na atual devolve igual. Quem usa em lote e `npm run recifrar`.
- Gerador: `npm run -s chave:gerar` imprime UMA chave nova (64 hex) e nada mais. Use `-s`: sem ele o npm imprime o cabecalho junto. Nunca em log nem no repo.
- Comando de recifragem: `npm run recifrar -- [--clinica <id>] [--lote 200] [--dry-run]` (precisa de `npm run build` antes e de `DATABASE_URL_OWNER`; ver `docs/ACESSO.md` e `docs/BACKUP-E-CHAVES.md`). Depois de aposentar a `k1`, continue usando `NOTTA_MASTER_KEYS` (`k2:<hex>`) com `NOTTA_MASTER_KEY_ATUAL=k2`: `NOTTA_MASTER_KEY` sozinha sempre vale como `k1`.

## Consentimento do paciente (item 10)
Tabela `Consentimento` (migration `20261101140000_consentimento`), modulo `src/consentimento/`: cada evento (`CONCEDIDO`, `REVOGADO`) e uma linha nova por paciente, nada e sobrescrito; estado = evento da maior `seq`. Rotas `GET`/`POST /pacientes/:id/consentimento` (POST body `{evento}`); `GET /pacientes` e `GET /pacientes/:id` ganham `consentimento`. Termo vigente no codigo (`src/consentimento/termo-consentimento.ts`, `TERMO_VIGENTE`, RASCUNHO nao revisado; ver "Termo de consentimento por link" abaixo). Somente-acrescentar como a trilha (notta_app so SELECT/INSERT, RLS FORCE, trigger barra UPDATE/DELETE/TRUNCATE ate para o dono, desvio `app.limpeza_de_teste` so para a limpeza de teste). `ConsentimentoService.exigirConcedido(tx, user, pacienteId)` = 403 se nao concedido (o item 12 usa). Detalhes: `docs/ACESSO.md`. Ver as linhas: `docker exec -i nottapsi-postgres-1 psql -U postgres -d notta_psi -c 'SELECT "pacienteId", seq, evento, "termoVersao", "criadoEm" FROM "Consentimento" ORDER BY "pacienteId", seq'`.

## Termo de consentimento por link (item 22, so back)
Migration `20261107120000_convite_consentimento`, modulo `src/convite-consentimento/`. O psicologo gera um **link de uso unico e com prazo de 7 dias**; o paciente le o termo e aceita ou recusa **sem criar conta**. Aceitar grava um evento `CONCEDIDO` em `Consentimento` com `origem = 'PACIENTE'` e o `conviteId` (o registro manual do psicologo continua, com `origem = 'PSICOLOGO'`). O historico de `GET /pacientes/:id/consentimento` ganha `origem` em cada item.
- **Psicologo** (autenticado, nao `@PermiteSenhaProvisoria`): `POST /pacientes/:pacienteId/convites-consentimento` -> 201 `{id, link, expiraEm}` (o `link` = `{NOTTA_APP_URL}/termo/{token}` aparece SO nesta resposta; so com estado `NENHUM` ou `REVOGADO`, senao 409 `Consentimento ja concedido`; um convite `PENDENTE` anterior e cancelado e substituido); `GET` mesma rota -> ate 20 `{id, estado, expirado, criadoEm, expiraEm, usadoEm, termoVersao}` (sem token nem link); `POST .../:id/cancelar` -> 200 `{id, estado: 'CANCELADO'}` (so `PENDENTE`, senao 409 `Convite nao esta pendente`; inexistente ou alheio 404).
- **Publicas** (sem login; `Cache-Control: no-store` e `Referrer-Policy: no-referrer` em toda resposta; throttler `consentimento-publico` 20/min por IP, /64 no IPv6, contado por rota): `GET /publico/consentimento/:token` -> 200 `{clinica, psicologo, termo: {versao, texto}, expiraEm}` (nunca dado do paciente); `POST .../:token/aceitar` body `{aceito: true}` (campo extra, `false` ou corpo vazio = 400) -> 200 `{ok: true}`; `POST .../:token/recusar` (sem corpo) -> 200 `{ok: true}`. Token desconhecido, de formato errado, expirado, cancelado, ja usado, feito com outra versao do termo ou de psicologo desativado = o MESMO 404 `Link invalido ou expirado` (sem oraculo). Clique duplo e aceites simultaneos = exatamente UM evento (o UPDATE condicional `PENDENTE` do convite decide). Nao grava IP, user-agent nem nome digitado.
- **Env** (falha fechada no boot): `NOTTA_APP_URL` (base do link; https, sem usuario/senha, sem query; em development/test, sem ela, vale `http://localhost:4200`) e `NOTTA_TERMO_REVISADO`: fora de development/test o boot FALHA se nao for exatamente `1`. So o dono liga, DEPOIS da revisao juridica do texto (`TERMO_VIGENTE` e um RASCUNHO escrito pelo agente). Ao trocar o texto, mude a `versao`: convites feitos com a versao antiga deixam de valer.
- Auditoria (mesma transacao): `CRIOU_CONVITE`, `CANCELOU_CONVITE` (tambem ao substituir), `LISTOU` (recurso `ConviteConsentimento`), `PACIENTE_ACEITOU_TERMO` e `PACIENTE_RECUSOU_TERMO` (recurso `Consentimento`, recursoId = paciente, psicologo = dono do paciente). Detalhes de banco e RLS: `docs/ACESSO.md`.
- Ver no banco (superuser): `docker exec -i nottapsi-postgres-1 psql -U postgres -d notta_psi -c 'SELECT id, estado, "expiraEm", "usadoEm", left("tokenHash", 12) FROM "ConviteConsentimento" ORDER BY "criadoEm" DESC LIMIT 5'`.

## Documento clinico (item 12)
Tabela `Documento` (migration `20261103120000_documento`), modulo `src/documentos/`: nota bruta, evolucao ou anamnese de um paciente, texto cifrado (AES-256-GCM por clinica, AAD com o `id`), nasce `RASCUNHO`. Rotas em `/pacientes/:pacienteId/documentos`: `POST` body `{tipo: 'NOTA_BRUTA'|'EVOLUCAO'|'ANAMNESE', dataSessao?: 'YYYY-MM-DD', conteudo: 1..20000 caracteres}` (so com consentimento CONCEDIDO; senao 403), `GET` (so metadados) e `GET /:id` (com o conteudo decifrado). Sem PATCH nem DELETE. `notta_app` so SELECT/INSERT; RLS FORCE `psicologo_proprio` com `status = 'RASCUNHO'` no WITH CHECK. Detalhes: `docs/ACESSO.md`. Provar que o banco nao tem texto puro: `docker exec -i nottapsi-postgres-1 psql -U postgres -d notta_psi -c 'SELECT id, tipo, "dataSessao", status, left("conteudoCifrado", 40) FROM "Documento" ORDER BY "criadoEm" DESC LIMIT 3'` (a coluna comeca com `v1.k1.`).

### Editar, aprovar e corrigir documento (itens 14, 15 e 44)
Migration `20261104120000_documento_editar_aprovar_imutavel`. Rotas novas em `/pacientes/:pacienteId/documentos`: `PATCH /:id` body parcial `{conteudo?: 1..20000, dataSessao?: 'YYYY-MM-DD'|null}` (corpo vazio, `tipo` e campo extra = 400; aprovado = 409 `Documento aprovado nao pode ser editado`; funciona com consentimento revogado) e `POST /:id/aprovar` sem corpo (200 com `status: 'APROVADO'` e `aprovadoEm`; de novo = 409 `Documento ja aprovado`). **Aprovar e irreversivel**: aprovado nao edita nem apaga (trigger do banco, ate para o dono). Correcao = novo documento: `POST` com `substituiId` (uuid de um APROVADO do mesmo paciente; rascunho = 409 `So documento aprovado pode ser corrigido`; alheio ou inexistente = 404; exige consentimento CONCEDIDO). `GET` lista aceita `?status=RASCUNHO|APROVADO` (outro valor = 400) e as respostas trazem `aprovadoEm` e `substituiId`. Auditoria: `EDITOU` e `APROVOU`. Detalhes e regra de correcao: `docs/ACESSO.md`.

## IA: anonimizador, cliente do SelahIA e saida (Fase 3, Onda A, sem rota)
Contrato: `.superpowers/sdd/fase-1/contrato.md` (secoes "Fase 3 - IA" e "Onda A"). Tudo em `src/ia/`; `IaModule` exporta `SelahIaClient` (sem controller) e esta no `AppModule` para validar a config no boot.
- `anonimizador.ts`: `anonimizar(texto, { nomesPaciente, termosExtras })` -> `{ textoAnonimizado, mapa }`; `reidentificar(texto, mapa)`; `validarTamanho` (1..8000). Troca nome do paciente (completo e partes de 3+ letras, palavra inteira, sem caixa nem acento) por `[PACIENTE]`, CPF, telefone, e-mail, CEP/endereco (`[ENDERECO]`), datas completas e termos extras (`[TERMO_n]`). Dois dados diferentes do mesmo tipo viram `[CPF]`, `[CPF_2]`... (a reidentificacao precisa distinguir). `[PACIENTE]` sempre entra no mapa (restaura o nome completo). Colchetes do texto de entrada viram parenteses.
- Limites conhecidos (falso negativo): endereco sem numero, data por extenso ("10 de maio"), telefone fixo sem DDD e sem hifen de celular, nome de terceiro fora dos termos extras. Falsos positivos conhecidos: "rua de casa 3" (palavra "rua" + palavras + numero) e nome do paciente igual a palavra comum. A previa obrigatoria (itens 20 e 21) existe por causa disso.
- `selahia.client.ts`: `gerarRascunho({ tipoDocumento, abordagem, textoAnonimizado })`, sem retry. Erros: `IaDesabilitadaError`; `IaIndisponivelError` (retentavel: rede, timeout 50 s, 429, 5xx, 502, resposta invalida); `IaRecusadaError` (nao retentavel: 400/422, 401/403, outros 4xx). So `motivo` de lista fechada, nunca texto do corpo. Nao segue redirecionamento. Log so com status, motivo, ms e inputChars.
- `ia.config.ts`: `NOTTA_IA_HABILITADA=1` liga (so esse valor). Ligada, o boot falha sem URL valida, sem https (http so em development/test para localhost/127.0.0.1), com usuario:senha na URL, ou sem chave (ou chave de exemplo). **Producao so liga depois do plano pago do Gemini.**
- `saida-ia.ts`: `sanearSaida(rascunho, mapa, textoEnviado)` -> `{ texto, avisos }` (tira controle e invisiveis, normaliza quebras, recusa acima de 20000 com `SaidaIaInvalidaError`; avisos `DADO_NOVO` e `CODIGO_DESCONHECIDO`). Nao reidentifica: chame `reidentificar` depois e `validarTamanhoSaida` no resultado (o nome volta maior que o codigo).

## Gerar documento por IA: previa, confirmar, retentativa e limite (Fase 3, Onda B, itens 19, 20, 21 e 51)
Contrato: `.superpowers/sdd/fase-1/contrato.md` (secao "Onda B"). Modulo `src/geracao-ia/`, tabela `GeracaoIa` (migration `20261106120000_geracao_ia`; detalhes e estados em `docs/ACESSO.md`). Fluxo: o psicologo escolhe uma NOTA_BRUTA, ve a PREVIA (o texto anonimizado exato que sairia), confirma, e um executor em processo chama o SelahIA; o resultado vira um NOVO documento EVOLUCAO ou ANAMNESE em `RASCUNHO` com `geradoPorIa = true` (continua exigindo aprovacao humana). Todas as rotas: qualquer autenticado, senha provisoria = 403, 404 igual para alheio e inexistente.
- `POST /pacientes/:pacienteId/documentos/:origemId/previa-ia` body `{tipoDocumento: 'EVOLUCAO'|'ANAMNESE', termosExtras?: string[] (ate 20, 1..60 chars)}` -> 201 `{id, estado: 'PREVIA', tipoDocumento, textoAnonimizado, expiraEm}` (30 min). Erros: 503 `IA indisponivel` (flag desligada), 404, 403 `Consentimento nao concedido`, 409 origem que nao e nota bruta, 422 nota longa demais (> 8000 caracteres apos anonimizar). Cada previa e uma linha nova.
- `POST /geracoes-ia/:id/confirmar` sem corpo (o texto que sai e sempre o da previa; corpo enviado e ignorado) -> 202 `{id, estado: 'PENDENTE'}`; ja PENDENTE = 202 igual sem nova chamada; PRONTO = 200 com o estado; previa expirada = 409; FALHOU nao retentavel = 409; limite diario = 429 `{mensagem, limite, usadas, renovaEm}` + `Retry-After`; ja ha outra PENDENTE do mesmo psicologo = 429 `Ja ha uma geracao em andamento`. **Retentativa sem limite**: FALHOU retentavel volta a PENDENTE com o mesmo texto, e nao gasta o limite.
- `GET /geracoes-ia/:id` (sem texto: `{id, estado, tipoDocumento, origemId, documentoId, motivo, retentavel, avisos, criadoEm, finalizadoEm}`; PENDENTE com mais de 120 s vira FALHOU `TEMPO_ESGOTADO`), `GET /pacientes/:pacienteId/geracoes-ia` (20 mais recentes), `GET /geracoes-ia/:id/previa` (so enquanto PREVIA e no prazo), `GET /ia/uso` -> `{habilitada, limite, usadas, renovaEm}`.
- `NOTTA_IA_LIMITE_DIARIO` (padrao 20, inteiro >= 1; invalido derruba o boot com a IA ligada): conta geracoes PRONTO do psicologo no dia corrente de `America/Sao_Paulo`; `renovaEm` = proxima meia-noite desse fuso.
- Motivos de falha (lista fechada, nunca texto da IA): `TIMEOUT`, `REDE`, `LIMITE`, `ERRO_DA_IA`, `RESPOSTA_INVALIDA`, `CHAVE_INVALIDA`, `PEDIDO_INVALIDO`, `CONFIG`, `SAIDA_INVALIDA`, `TEMPO_ESGOTADO`, `ERRO_INTERNO`. Avisos no PRONTO: `DADO_NOVO`, `CODIGO_DESCONHECIDO`.
- Auditoria (mesma transacao): `PREVIA_IA` (criar previa), `ENVIOU_IA` (a cada envio, inclusive cada retentativa: e quando dado sai do sistema), `LEU` na previa, `CRIOU` no documento gerado. Consulta e lista nao auditam (o app consulta a cada poucos segundos).
- Ver no banco (como superuser, que nao sofre a RLS) que o texto do pedido e cifrado e o mapa e zerado no PRONTO: `SELECT estado, left("textoCifrado", 12), "mapaCifrado" IS NULL AS mapa_zerado FROM "GeracaoIa"`.
- Testes: `test/geracao-ia-rls.e2e-spec.ts` (banco e trigger), `test/geracao-ia.e2e-spec.ts` (HTTP com SelahIA falso em `test/selahia-falso.ts`), `src/geracao-ia/*.spec.ts`.

## Varredura de segredos (item 42)
`npm run scan:segredos` (`scripts/scan-segredos.mjs`): le `git ls-files` e procura `x-selah-api-key` com valor, `NOTTA_*`/`SELAHIA_API_KEY` com 32+ caracteres, chave privada PEM e 64 hex em atribuicao. Sai com 1 e imprime so `arquivo:linha:tipo`, nunca o valor. Allowlist curta no topo do script (testes e `.env.example`, so para `NOTTA_*` e hex64). Arquivo novo so entra depois de `git add`. Tornar obrigatorio no CI e o item 43.
