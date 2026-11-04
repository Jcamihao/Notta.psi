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
                                # das demais (DDL entra na fila do lock e atrasa o resto; carga mede latencia)
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
Ver `.env.example` (PORT, DATABASE_URL, DATABASE_URL_OWNER, NOTTA_TRUST_PROXY, NOTTA_MASTER_KEY, NOTTA_JWT_SECRET, NOTTA_CORS_ORIGIN).
Obrigatorias no boot hoje: `DATABASE_URL`, `NOTTA_MASTER_KEY` e `NOTTA_JWT_SECRET`. `NOTTA_TRUST_PROXY` tambem e obrigatoria (`0` = sem proxy), EXCETO quando `NODE_ENV` (aparado, sem caixa) e `development` ou `test`: `Production`, ` production `, `staging` ou `NODE_ENV` ausente (comum em imagem Docker) exigem a variavel. No dev local use `NODE_ENV=development`. Cada modulo novo valida a propria env.
- O `.env.example` traz `NOTTA_JWT_SECRET` e `NOTTA_MASTER_KEY` VAZIOS: gere os seus (comandos no arquivo).
- `NOTTA_JWT_SECRET`: o boot recusa (apara e ignora caixa) menos de 32 caracteres, menos de 16 caracteres distintos, e qualquer valor que CONTENHA um segredo conhecido (o antigo exemplo do repo, `0123456789abcdef...`, `my-super-secret-jwt-key-for-production` e os segredos das suites de teste, com prefixo ou sufixo). Lista em `src/comum/segredos-conhecidos.ts`. As suites de teste usam os segredos de teste so porque `test/permite-segredo-de-teste.ts` define `NOTTA_PERMITE_SEGREDO_DE_TESTE=1`; nunca defina essa variavel fora de teste.
- Papel do banco: no boot o backend confere que o papel de `DATABASE_URL` NAO e superuser, NAO tem BYPASSRLS e NAO e dono (nem membro do dono) de `Clinica`/`Psicologo`. Se for, o boot falha com `DATABASE_URL insegura: ...` (sem mostrar a URL). Use `notta_app`.

## Cadastro, login e /eu
Contrato completo: `.superpowers/sdd/fase-1/contrato.md`.
- `POST /clinicas` (publico): cria a clinica e o primeiro psicologo com papel `ADMIN`, numa transacao so. E-mail normalizado (trim + lowercase), unico global (409). Senha 8..72 bytes, bcrypt custo 12.
- `POST /auth/login` (publico): `{ token }` JWT HS256, 8 h, claims `sub` (psicologoId), `clinicaId` e `tv` (versao do token = `Psicologo.tokenVersao`). 401 identico para e-mail inexistente e senha errada (hash falso: mesmo tempo).
- `GET /eu` (Bearer): dados do psicologo e da clinica, com `senhaProvisoria` (true = criado pelo ADMIN e ainda nao trocou).
- `POST /auth/trocar-senha` (Bearer): `{ senhaAtual, novaSenha }` (novaSenha 8..72 bytes, diferente da atual) -> 200 `{ token }` novo. Senha atual errada = 422 `Senha atual incorreta` (nao 401: o front desloga em todo 401). Incrementa `tokenVersao`: TODOS os tokens anteriores da conta viram 401. Limite 10/h por psicologo; `@TetoHash()`.
- Senha provisoria (item 62): o guard responde 403 `{"statusCode":403,"message":"Troca de senha obrigatoria","error":"Forbidden"}` em toda rota autenticada, salvo as marcadas com `@PermiteSenhaProvisoria()` (hoje `GET /eu` e `POST /auth/trocar-senha`). Rota nova nasce bloqueada (falha fechada).
- `JwtAuthGuard` e GLOBAL: toda rota nova exige token. Rota publica precisa de `@Publico()` (hoje: `/saude`, `POST /clinicas`, `POST /auth/login`). O guard confere no banco que o psicologo ainda existe, que o `tv` do token e igual ao `tokenVersao` (diferente ou ausente = 401) e le papel e `senhaProvisoria` frescos; use `@UsuarioAtual()` para pegar `{ psicologoId, clinicaId, papel, senhaProvisoria }`.
- 401 SO para token invalido/expirado ou psicologo inexistente. Banco/pool fora responde 503 `{"statusCode":503,"message":"Servico indisponivel"}` com `Retry-After: 2` (o front so desloga no 401). Pool/transacao esgotados DENTRO da rota (Prisma `P2024`/`P2028`) tambem: filtro global `BancoIndisponivelFilter`, mesmo corpo e `Retry-After: 2`, sem log nem detalhe.
- Senhas: `bcrypt` NATIVO (roda no threadpool, nao trava o event loop), custo 12. Rota que calcula hash (login, cadastro de clinica, criacao de psicologo, troca de senha) leva `@TetoHash()`: no maximo 8 hashes ao mesmo tempo no processo E no maximo 2 por tracker de IP (o /64 inteiro no IPv6), para um IP so nao segurar todas as vagas; acima disso, 503 com `Retry-After: 1`. Limite conhecido: uma botnet distribuida (muitos IPs, 2 vagas cada) ainda ocupa as 8 vagas e derruba o login de todos; isso se resolve na borda (WAF ou limite por conexao no proxy), nao no app.

## Equipe da clinica (so ADMIN)
- `POST /psicologos` (Bearer, ADMIN): `{ nome, email, senha, abordagemPadrao }` -> 201 `{ psicologoId }`. Mesmas regras do cadastro (e-mail normalizado e unico global = 409, senha 8..72 bytes, bcrypt 12). A clinica vem SO do token; o novo nasce `PSICOLOGO` com `senhaProvisoria = true` (troca obrigatoria no 1o acesso: o ADMIN nao fica com acesso a conta do colega). Campo extra (`clinicaId`, `papel`) = 400.
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
- Login: 5/min por IP + e-mail e 20/min por IP. Cadastro de clinica: 5/h por IP. `POST /psicologos`: 20/h por psicologo do token (nao por IP). `POST /auth/trocar-senha`: 10/h por psicologo do token. Conta sucesso e falha (e requisicao invalida). 429 com `Retry-After` em segundos.
- Toda rota autenticada: 300/min por psicologo, somado entre todas as rotas (throttler `api`), mais no maximo 5 requisicoes SIMULTANEAS por psicologo. Os dois sao contados no `JwtAuthGuard`, depois da assinatura do token e ANTES de qualquer acesso ao banco: requisicao barrada nao gasta conexao do pool, entao um usuario nao degrada as outras clinicas. A resposta 429 desses dois casos so sai depois de 1 s (tarpit, `RECUSA_ATRASO_MS`): recusar na hora faz o atacante repetir o pedido sem parar e saturar o event loop (medido: 500 conexoes em laco deixavam a vitima com 1 a 3 s por requisicao mesmo com 429 barato). Rotas `@Publico()` ficam de fora.
- IPv6: todo limite por IP conta o /64 inteiro como um IP (IPv4 nao muda).
- Armazenamento EM MEMORIA: vale para UMA instancia. Com mais instancias, trocar por Redis. Reiniciar o backend zera os contadores.
- Atras de proxy/load balancer: `NOTTA_TRUST_PROXY=<saltos>` para o IP real vir do `X-Forwarded-For`. Sem ela, o header e ignorado (todo mundo atras do proxy dividiria o mesmo limite). Ela e obrigatoria (o boot falha sem ela) salvo `NODE_ENV=development` ou `test`; sem proxy, use `NOTTA_TRUST_PROXY=0`.
- Throttler novo: basta somar em `THROTTLERS` (`src/limite-tentativas/limite-tentativas.module.ts`); as rotas que nao o usam o pulam sozinhas (lista derivada em `limite()`).

## Seguranca HTTP
- `helmet()` com os padroes (nosniff, HSTS, CSP, frame SAMEORIGIN...). `x-powered-by` desligado.
- CORS desligado por padrao. `NOTTA_CORS_ORIGIN` liga para UMA origem exata (outras origens nao recebem `Access-Control-Allow-Origin`).
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

## Consentimento do paciente (item 10)
Tabela `Consentimento` (migration `20261101140000_consentimento`), modulo `src/consentimento/`: cada evento (`CONCEDIDO`, `REVOGADO`) e uma linha nova por paciente, nada e sobrescrito; estado = evento da maior `seq`. Rotas `GET`/`POST /pacientes/:id/consentimento` (POST body `{evento}`); `GET /pacientes` e `GET /pacientes/:id` ganham `consentimento`. Termo provisorio no codigo (`src/consentimento/termo.ts`, placeholder ate o item 22). Somente-acrescentar como a trilha (notta_app so SELECT/INSERT, RLS FORCE, trigger barra UPDATE/DELETE/TRUNCATE ate para o dono, desvio `app.limpeza_de_teste` so para a limpeza de teste). `ConsentimentoService.exigirConcedido(tx, user, pacienteId)` = 403 se nao concedido (o item 12 usa). Detalhes: `docs/ACESSO.md`. Ver as linhas: `docker exec -i nottapsi-postgres-1 psql -U postgres -d notta_psi -c 'SELECT "pacienteId", seq, evento, "termoVersao", "criadoEm" FROM "Consentimento" ORDER BY "pacienteId", seq'`.

## Documento clinico (item 12)
Tabela `Documento` (migration `20261103120000_documento`), modulo `src/documentos/`: nota bruta, evolucao ou anamnese de um paciente, texto cifrado (AES-256-GCM por clinica, AAD com o `id`), nasce `RASCUNHO`. Rotas em `/pacientes/:pacienteId/documentos`: `POST` body `{tipo: 'NOTA_BRUTA'|'EVOLUCAO'|'ANAMNESE', dataSessao?: 'YYYY-MM-DD', conteudo: 1..20000 caracteres}` (so com consentimento CONCEDIDO; senao 403), `GET` (so metadados) e `GET /:id` (com o conteudo decifrado). Sem PATCH nem DELETE. `notta_app` so SELECT/INSERT; RLS FORCE `psicologo_proprio` com `status = 'RASCUNHO'` no WITH CHECK. Detalhes: `docs/ACESSO.md`. Provar que o banco nao tem texto puro: `docker exec -i nottapsi-postgres-1 psql -U postgres -d notta_psi -c 'SELECT id, tipo, "dataSessao", status, left("conteudoCifrado", 40) FROM "Documento" ORDER BY "criadoEm" DESC LIMIT 3'` (a coluna comeca com `v1.k1.`).

### Editar, aprovar e corrigir documento (itens 14, 15 e 44)
Migration `20261104120000_documento_editar_aprovar_imutavel`. Rotas novas em `/pacientes/:pacienteId/documentos`: `PATCH /:id` body parcial `{conteudo?: 1..20000, dataSessao?: 'YYYY-MM-DD'|null}` (corpo vazio, `tipo` e campo extra = 400; aprovado = 409 `Documento aprovado nao pode ser editado`; funciona com consentimento revogado) e `POST /:id/aprovar` sem corpo (200 com `status: 'APROVADO'` e `aprovadoEm`; de novo = 409 `Documento ja aprovado`). **Aprovar e irreversivel**: aprovado nao edita nem apaga (trigger do banco, ate para o dono). Correcao = novo documento: `POST` com `substituiId` (uuid de um APROVADO do mesmo paciente; rascunho = 409 `So documento aprovado pode ser corrigido`; alheio ou inexistente = 404; exige consentimento CONCEDIDO). `GET` lista aceita `?status=RASCUNHO|APROVADO` (outro valor = 400) e as respostas trazem `aprovadoEm` e `substituiId`. Auditoria: `EDITOU` e `APROVOU`. Detalhes e regra de correcao: `docs/ACESSO.md`.
