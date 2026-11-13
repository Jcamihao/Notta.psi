# praxis.psi — handoff (passagem de bastão, estado em 2026-11-13)

Este documento é para um agente de código (Codex ou outro Claude) que vai continuar o projeto. Leia inteiro antes de mexer em qualquer coisa. O dono do produto é João (`johnmarcus3210@gmail.com`); ele fala português, prefere respostas curtas, objetivas e honestas, acompanha muitas vezes pelo celular e usa um fechamento fixo (seção 10).

## 0. Primeiros passos (faça nesta ordem)

1. `git status` e `git log --oneline | head -15` (a árvore deve estar limpa; o último trabalho foi a marca praxis: logo com ponto azul, paleta híbrida e fonte Red Hat).
2. Leia `docs/FEATURES.md` (ordem e estado), `docs/ACESSO.md` (regras de acesso e padrões de banco) e, se existir, `.superpowers/sdd/fase-1/contrato.md` (contratos e decisões do dono, item por item).
3. Suba o banco (seção 3), rode `npx prisma migrate deploy` e os gates do back e do front (seção 3) para confirmar que tudo está verde ANTES de mexer.
4. Leia a seção 0.1 logo abaixo (o que precisa ser feito), depois a seção 5 (onde parou) e siga a seção 6, um item por vez, parando para perguntar nas decisões da seção 7.

## 0.1 O que precisa ser feito (checklist, atualizado em 2026-11-13)

**A. Ações do dono (o agente não consegue fazer):**
- [ ] Renomear o repositório no GitHub para `praxis.psi` (Settings do repositório). Depois: `git remote set-url origin <nova url>`. O endereço antigo redireciona.
- [ ] Renomear a pasta local para `praxis.psi`. O Docker Compose cria outro volume de banco ao mudar o nome da pasta; o antigo fica órfão.
- [ ] Recriar o banco de desenvolvimento: as migrations já aplicadas foram editadas para os papéis `praxis_*`, então o banco antigo não aceita as novas. `docker compose down -v` SÓ quando o dono decidir; depois `docker compose up -d`, `npx prisma migrate deploy` e `backend/prisma/bootstrap/endurecer-banco.sql`. Atualizar as variáveis de shell e `.env` locais (`PRAXIS_*`, URLs com `praxis_app`, `praxis_owner` e `praxis_psi`) e renomear `~/.cache/notta-pgtool` para `~/.cache/praxis-pgtool` se existir (os docs já usam o nome novo). **Dado cifrado antes de 2026-11-13 fica ilegível** (o rótulo de criptografia mudou, ver 0.1 E); recriar o banco resolve.
- [ ] Decidir o logo e o ícone (favicon e ícone de app). O que existe é um wordmark provisório: "praxis" + ponto azul + "psi" em Red Hat Display Black (`frontend/src/app/ui/wordmark.component.ts`). O manual de marca da Praxis (PDF que o dono enviou) não define lockup de produto.
- [ ] Comprar o domínio (o manual cita `praxis.com.br` só como exemplo: confirmar) e verificar no Resend. Destrava os itens 24, 47, 48, 65 e o deploy.
- [ ] Definir o controlador dos dados (razão social e CNPJ da Praxis), o encarregado e o papel (controlador ou operador). Entra no termo de consentimento, na página `/seguranca` e no plano de incidente (item 54).
- [ ] Revisão jurídica do texto do termo (`v1-rascunho`) e do plano de incidente (`docs/PLANO-DE-INCIDENTE.md`); depois ligar `PRAXIS_TERMO_REVISADO=1` em produção. Fazer um simulado de incidente.
- [ ] Contratar o plano pago do Gemini antes de qualquer dado real passar pela IA.
- [ ] Renomear `NottaPsiBack` (identificador do app para o SelahIA) para o nome novo: tarefa pronta para o Claude Code na seção 0.2 logo abaixo (precisa mexer nos DOIS lados juntos).

**B. Decisões de produto abertas:** ver a seção 7 (item 67, salvar rascunho no celular, registro manual de consentimento, planos, canal do paciente, reativação de psicólogo, entre outras).

**C. Próximos itens de código, em ordem (nenhum depende de decisão externa, exceto onde indicado):**
1. 27 linha do tempo do paciente.
2. 28 busca e filtros (o texto é cifrado: exige decifrar no app só os documentos do próprio psicólogo e paginação da lista, que hoje carrega no máximo 500).
3. 29 ajuste de linguagem técnica e 30 exportar em PDF ou Word.
4. 67 transferir pacientes de psicólogo desativado (PRECISA de decisão do dono: quem autoriza e como fica o registro).
5. Fase 6: 31 landing page (seguir o modelo de site do manual da Praxis: preto de base, azul só no que pede ação; usar a skill de design de landing, não o design system do app), 32 early access, 33 planos e cobrança, 53 monitoramento e alertas.
6. Fase 8: 34 a 36 e 68 a 78 (ver seção 6).
7. Bloqueados pelo domínio: 24, 47, 48, 65.
8. Antes do deploy: 56 (inclui AGENDAR `npm run descartar` e `npm run podar-backups`, hoje manuais; credencial `praxis_owner` fora do app; TLS no banco; testar a receita de CSP no nginx real), 43 CI e 55 teste de invasão.
9. Revisar o item 50 (cifrar identificadores): nome, nascimento, telefone e e-mail do paciente já são cifrados; conferir se sobra algo (CPF e endereço não existem como campos hoje) e fechar ou ajustar o item.

**D. Pendências técnicas pequenas (achadas pelos revisores, sem item próprio):**
- As telas de IA (`ia-gerar.page.ts`, `ia.service.ts`) mostram "IA desligada neste ambiente" para qualquer 503, inclusive o do banco ocupado.
- Card de rascunhos pendentes na Início: exige rota nova no back (hoje rascunho só se lista por paciente).
- Retenção das tabelas `Sessao` e do que ficou `RESTRICT`: não tratada.
- `docs/` não passa no `prettier --check` (não é parte do gate); `shellcheck` não está instalado, então os scripts bash (`backup.sh`, `podar-backups.sh`...) nunca passaram por ele.
- O e2e do 413 da exportação (2000 linhas por lista) só tem teste unitário com mock.

**E. Cuidados que já custaram caro (não repita):**
- Nunca `prisma migrate diff --shadow-database-url`, `migrate reset` nem `db push --force-reset` apontando para o banco de desenvolvimento: já recriou o schema uma vez.
- Nunca `docker compose down -v` sem o dono pedir. Nunca `pkill -f` (já matou o próprio shell): mate por PID.
- O rótulo HKDF é `praxis-psi|clinica|<id>` (`backend/src/criptografia/criptografia.service.ts`). Foi trocado UMA vez, de `notta-psi`, em 2026-11-13, antes de existir dado real; revisor conferiu os vetores com Python independente e 7 mutantes caíram. Daqui em diante é CONGELADO: mudar qualquer caractere torna ilegível todo dado e backup já cifrado, e só com uma migração que recifre tudo.
- Texto sobre o azul da marca é SEMPRE preto (branco dá 2,3:1 e reprova); os testes de `frontend/src/app/ui/*.spec.ts` fixam as cores em valor literal.
- `git push` pode dar 503 do lado do GitHub: tente de novo com espera (2, 4, 8, 16 s) e confira com `git fetch` que subiu de verdade.
- Ferramentas desta sessão de nuvem que não existem aqui: `graphify` e a pasta `.superpowers`.

## 0.2 Tarefa pendente para o Claude Code: renomear `NottaPsiBack`

**O que é:** `NottaPsiBack` é o nome com que este app se identifica ao SelahIA (cabeçalho `x-source-app`). O SelahIA associa esse nome à chave do app em `SELAH_APP_KEYS="<nome>:<chave>"`. Os dois lados precisam usar o MESMO nome; por isso não foi trocado junto com o resto da renomeação para praxis. Nome novo sugerido: `PraxisPsiBack` (confirmar com o dono).

**Passos (um commit pequeno por repositório):**
1. Neste repositório, trocar `NottaPsiBack` em: `backend/src/ia/selahia.client.ts` (cabeçalho `'x-source-app'`, perto da linha 159), `backend/src/ia/ia.config.ts` (mensagem de erro, perto da linha 67), `backend/src/ia/selahia.client.spec.ts` (perto da linha 125), `backend/test/geracao-ia.e2e-spec.ts` (o SelahIA falso registra a fonte, perto da linha 558), `backend/.env.example` (comentários, perto das linhas 52 e 54), `docs/HANDOFF.md` (seção 3, SelahIA local) e `docs/superpowers/plans/2026-09-27-nucleo-clinico-plan.md`. Para achar tudo: `grep -rn "NottaPsiBack" --exclude-dir=node_modules --exclude-dir=.git .`.
2. No repositório do SelahIA (`/home/caminhao/codeStage/SelahIA`, na máquina do dono, FORA deste repositório): trocar o nome em `SELAH_APP_KEYS` (no `.env` e em qualquer script ou doc), mantendo a mesma chave. Conferir no código dele (`grep -rn "NottaPsiBack"`) se o nome também aparece em alguma lista de apps permitidos. Não confirmado: como o SelahIA valida o nome; leia o código dele antes.
3. Subir os dois juntos. Hoje só existe ambiente de desenvolvimento; se algum dia estiver em produção, aceitar os dois nomes por um tempo no SelahIA.
4. Verificar: `cd backend && npm test` e `npx jest --config test/jest-e2e.json geracao-ia` (SelahIA falso); depois uma geração real contra o SelahIA local com dado FICTÍCIO (comandos na seção 3) e confirmar que não volta 401 nem 403.
5. Atualizar este Handoff: marcar a tarefa como feita e tirar `NottaPsiBack` da seção 0.1 A, da seção 3, da seção 7 e da seção 9.

**Risco:** se só um dos lados for trocado, a geração por IA para de funcionar (o SelahIA recusa o app); o resto do praxis.psi não é afetado.

## 1. O que é o produto

praxis.psi é um SaaS multi-clínica para psicólogos. O psicólogo escreve a nota bruta de uma sessão, a IA (via SelahIA) rascunha uma evolução ou anamnese, e o psicólogo sempre revisa e aprova. A maior objeção dos 12 psicólogos que responderam o Google Forms foi confidencialidade (8 de 12). Por isso o sigilo pesa mais que qualquer outra regra: na dúvida, guarde menos dado, cifre mais, registre quem acessou e nunca mande texto clínico para log, URL, storage do navegador ou serviço de terceiros.

Repositório: `/home/caminhao/codeStage/praxis.psi` (git local, branch `master`, sem remoto). Dois projetos independentes: `backend/` (NestJS 11, Prisma 6, Postgres) e `frontend/` (Angular 20, standalone, Signals, zoneless).

## 2. Regras do dono (não negocie)

- Nunca faça push, merge ou deploy por conta própria. Commit só quando fizer parte do trabalho pedido, um por etapa, em português, com caminhos explícitos (`git add <caminho>`, nunca `git add -A`), sem `--amend`, `reset` ou `rebase`.
- Decisões de produto são do dono. Quando faltar uma, pare e pergunte com uma recomendação sua (seção 7). Não invente regra de negócio.
- Nunca copie segredo em chat, relatório ou commit. Nunca registre texto clínico, senha, token ou chave em log.
- Não rode `docker compose down -v` sem o dono pedir (apaga o volume do banco de desenvolvimento). Não use `pkill -f` (já matou o próprio shell).
- Antes de dizer "pronto", rode build, lint, format e testes e diga o que rodou de verdade. Separe "verifiquei" de "presumi".
- Ao terminar cada funcionalidade, ensine o dono a usar: o que foi adicionado, como funciona, como ver funcionando (só comandos que você rodou).
- A fonte única da ordem de trabalho é `docs/FEATURES.md` (checkboxes: `[ ]` a fazer, `[~]` em andamento, `[x]` feito e verificado). Marque `[x]` só depois de verificar.
- Modelos dos subagentes (regra global do dono, 2026-11-05): quem DESENVOLVE usa Haiku; quem REVISA E CORRIGE usa Sonnet; Opus só se o dono pedir; um subagente por vez (limite de 5 horas); em item de segurança o revisor é obrigatório e faz os mutantes. Se você não tem subagentes, siga o mesmo fluxo em duas passadas: primeiro implemente, depois revise o próprio diff como um revisor exigente, rodando os mutantes do contrato.

## 3. Como rodar

**Banco de desenvolvimento e testes** (porta `127.0.0.1:5436`, só UM por vez):
- Plano A, Docker: na pasta do repo `docker compose up -d` (Postgres 16; superuser `postgres`, senha de desenvolvimento `postgres-dev`; acesso `docker exec -i praxispsi-postgres-1 psql -U postgres -d praxis_psi`). O script `docker/initdb` cria os papéis `praxis_owner` (dono das tabelas, roda migrations) e `praxis_app` (runtime, sem superuser, sujeito a RLS) só no primeiro start do volume. O Docker costuma cair no WSL (`docker: command not found`); se cair, use o plano B.
- Plano B, Postgres embutido 18 em `~/.cache/praxis-pgtool` (leia o `README.txt`; superuser `postgres`/`pgtool-throwaway`; SQL de superuser: `node ~/.cache/praxis-pgtool/q.mjs postgres pgtool-throwaway '<sql>'`). `./restart.sh` apaga e recria o banco descartável com papéis, o REVOKE de `lo_create` e TODAS as migrations. Se a pasta `data/` ficar velha sem processo vivo, mova-a para `data.old.<n>` antes. Pare por PID gravado (`ps -o args= -p $(cat pg.pid)` deve mostrar `node start.mjs`). Estado hoje: o embutido está de pé, e o container Docker está parado.
- Para trocar de plano: pare o que está de pé por PID, suba o outro, rode `npx prisma migrate deploy` e o `backend/prisma/bootstrap/endurecer-banco.sql` (como superuser, uma vez por banco novo; o teste de privilégios falha de propósito sem ele).

**Variáveis em `backend/`** (só em variáveis de shell, nunca no repo):
```
export DATABASE_URL=postgresql://praxis_app:praxis_app@localhost:5436/praxis_psi
export DATABASE_URL_OWNER=postgresql://praxis_owner:praxis_owner@localhost:5436/praxis_psi
npx prisma migrate deploy
```
Para subir o app à mão: gere `PRAXIS_MASTER_KEY` (`npm run -s chave:gerar`) e `PRAXIS_JWT_SECRET` (`openssl rand -base64 48`), use `NODE_ENV=development` e leia `backend/README.md` e `backend/.env.example`. Outras variáveis que o boot conhece: `PRAXIS_MASTER_KEYS` + `PRAXIS_MASTER_KEY_ATUAL` (várias chaves mestras, item 25), `PRAXIS_APP_URL` e `PRAXIS_TERMO_REVISADO` (link do termo, produção exige `=1`), `PRAXIS_CORS_ORIGIN`, `PRAXIS_API_PREFIXO`, `PRAXIS_TRUST_PROXY`, `PRAXIS_IA_HABILITADA`, `SELAHIA_URL`, `SELAHIA_API_KEY`, `PRAXIS_IA_LIMITE_DIARIO`, `PRAXIS_BACKUP_SENHA`.

**Verificação** (últimos números verdes em 2026-11-13, no Postgres 16 do sistema, porta 5432, ambiente de nuvem):
- `backend/`: `npm run build`, `npm run lint`, `npm run format:check`, `npm test` (796 unit), `npm run test:e2e` (551 em paralelo + 91 em série, dois grupos em sequência), `npm run scan:segredos`.
- `frontend/`: `npm run lint`, `npm run format:check`, `npm run build`, `npm test` (724; precisa de `CHROME_BIN`, em `~/.cache/puppeteer/chrome/*/chrome-linux64/chrome`), `npm run verificar:csp` e `npm run test:csp`.
- Integração real no navegador: back e front de verdade com `puppeteer-core` (em `/home/caminhao/codeStage/PraiseApp/node_modules/puppeteer-core`). Use portas próprias (back 3150, front 4350 com `ng serve --proxy-config <arquivo apontando para 3150>`); outras portas (3000, 3010, 3100) podem ser de outros projetos. Para apagar clínica de teste: copie um script temporário para `backend/` que importe `apagarClinicas` de `./test/acesso-owner` e rode com `npx ts-node --transpile-only`; apague o arquivo depois.
- O grafo de código está em `graphify-out/` (`graphify query "<pergunta>"` antes de caçar arquivo; `graphify update .` depois de mudar código; nunca dois em paralelo).

**SelahIA local** (para testar a IA de verdade, só com dado FICTÍCIO enquanto o Gemini estiver no plano grátis): repositório `/home/caminhao/codeStage/SelahIA`. Para subir: `npm run build` lá e `SELAH_APP_KEYS="NottaPsiBack:<chave de 40+ caracteres gerada na hora>" PORT=3010 node dist/main` (o `.env` dele já tem a chave do Gemini). No praxis.psi use `PRAXIS_IA_HABILITADA=1`, `SELAHIA_URL=http://127.0.0.1:3010`, `SELAHIA_API_KEY=<a mesma chave>`. Hoje ele está parado.

## 4. O que já está pronto e verificado

Itens de `docs/FEATURES.md` feitos e verificados (`[x]`): 1 a 23, 25, 26, 41, 42, 44, 45, 46, 49, 51, 52, 57 a 64 e a Fase 1.6. O item 24 está aberto (espera o domínio) e o 54 está `[~]` (rascunho de `docs/PLANO-DE-INCIDENTE.md` entregue; falta revisão de advogado e um simulado). Resumo do que existe:

- **Isolamento:** todo dado de clínica tem `clinicaId` e RLS ENABLE + FORCE. Cada psicólogo lê só os próprios pacientes e documentos (padrão `psicologo_proprio`, `docs/ACESSO.md`); o ADMIN gerencia a equipe e atende os próprios pacientes, mas não lê prontuário de colega. FKs filhas incluem `psicologoId`, porque checagem de FK ignora RLS.
- **Criptografia:** AES-256-GCM, chave por clínica derivada por HKDF de uma chave mestra, formato `v1.<kid>.<iv>.<tag>.<ct>`, AAD obrigatório (`aadDe(tabela, coluna, id, psicologoId)`), chaveiro com várias chaves (`k1`, `k2`...) e `kid` lido do próprio valor (sem fallback). Paciente (nome, nascimento, telefone, e-mail) e conteúdo de documento ficam cifrados.
- **Auth e sessão (itens 6, 45, 46, 49, 57, 62):** cookies `httpOnly` (`praxis_acesso` de 15 min, `praxis_refresh` com renovação rotativa e detecção de reuso, `praxis_csrf` para double-submit); sessão máxima de 7 dias e 30 minutos parado; tabela `Sessao` revogável; "Sair" e "Sair de todos os aparelhos"; CSRF por cabeçalho mais `Origin`; o login só devolve token no corpo com o cabeçalho `x-praxis-cliente: api` (clientes que não são navegador e os testes; o front nunca manda). Senha com mínimo de 10 caracteres, lista local de 10 mil senhas comuns e regras pessoais (a política vale ao definir ou trocar senha, não no login). Senha provisória do colega com troca obrigatória. Bcrypt nativo com teto de concorrência e limites de tentativa. O front não guarda token (verificado: nada em `sessionStorage`/`localStorage`); a renovação é serializada entre abas com Web Locks.
- **Tabelas somente-acrescentar e imutáveis:** `Auditoria`, `Consentimento`, `Documento` aprovado (trigger, até para o dono, exceto o desvio de limpeza de teste e a exceção de recifragem do item 25), `GeracaoIa` com máquina de estados no banco, `ConviteConsentimento`, `Sessao`.
- **Documento clínico:** nota bruta, evolução e anamnese; rascunho editável, aprovação irreversível, correção vira novo documento ligado ao anterior; prontuário (aprovados) e rascunhos separados; aviso local de dado que identifica na digitação.
- **Consentimento:** registro manual do psicólogo e termo por link de uso único (7 dias, token de 256 bits, só o hash no banco, página pública `/termo/:token` sem login, aceitar ou recusar). **O texto do termo é RASCUNHO NÃO REVISADO** (`backend/src/consentimento/termo-consentimento.ts`, versão `v1-rascunho`); em produção o boot só passa com `PRAXIS_TERMO_REVISADO=1`, que o dono só liga depois de revisão jurídica.
- **IA (itens 17 a 21, 42, 51):** anonimizador determinístico com códigos entre colchetes (junta partes do nome do paciente num código só) e reidentificação, cliente do SelahIA (timeout, erros tipados, https obrigatório em produção, sem log de texto), saneamento da saída, prévia obrigatória (o servidor guarda o texto anonimizado e o mapa cifrados; a confirmação nunca reenvia texto), geração em processo fora de transação, retentativa sem limite que não duplica documento, limite diário de gerações bem-sucedidas (padrão 20, dia em `America/Sao_Paulo`), mapa e texto zerados no banco quando a geração fica PRONTA (CHECK no banco). Testado de ponta a ponta contra o SelahIA e o Gemini REAIS com dado fictício (2 gerações). Contrato do SelahIA (v2.7.9): `POST /v1/adapters/psicologia/rascunho/gerar` com `x-selah-api-key`, corpo `{tipoDocumento: 'evolucao'|'anamnese', abordagem, textoAnonimizado ≤ 8000}`.
- **Equipe:** adicionar colega com senha provisória, listar, desativar (o desativado perde acesso na hora; dados ficam guardados; não há reativação nem transferência de pacientes).
- **Front:** design system "intelly" (`docs/DESIGN-SYSTEM.md`: Red Hat Text e Red Hat Display auto-hospedadas (a DM Sans saiu em 2026-11-13), ícones Lucide por npm, nada de CDN); login, cadastro, equipe, pacientes, consentimento e termo por link, documentos, geração por IA (prévia, acompanhar, tentar de novo, pedidos), troca de senha, sair de todos os aparelhos. Funciona em desktop e mobile web (não existe app nativo). Desde 2026-11-13 o visual segue a marca praxis: fonte Red Hat Text e Red Hat Display, paleta híbrida (neutros claros, menu preto #0B0B0C, azul #38B6FF só em ação) e wordmark com ponto azul (`app-wordmark`). A escala tipográfica segue o manual (título Display Black 56, subtítulo Display Bold 28, corpo 18, legenda 14; ver `docs/DESIGN-SYSTEM.md`). Também existem: tela de Início, exclusão e exportação de paciente, aviso de descarte do rascunho. O build de produção passa em `npm run verificar:csp` (CSP estrita com nonce; receita em `docs/SEGURANCA-HEADERS.md` e `deploy/nginx-praxis.conf.example`, testada com um servidor Node equivalente, NÃO com o nginx real).

Os contratos de cada item e os relatórios dos agentes estão em `.superpowers/sdd/fase-1/` (pasta ignorada pelo git, só existe nesta máquina: `contrato.md`, `task-*-brief.md`, `task-*-report.md` explicam decisões e COMO USAR de cada etapa).

## 5. Onde parou

### Estado em 2026-11-13
Nada está pela metade e a árvore fica limpa. Entregas desde 2026-11-06, todas verificadas e publicadas na branch `claude/awesome-brown-ee1acu`:
- **Itens fechados:** 26 (exportar e excluir dados, LGPD), 52 (retenção e descarte, como comandos que AINDA NÃO rodam sozinhos), 66 (painel de sigilo fiel ao código e mensagem 503) e 79 (tela de Início, item criado nesta fase).
- **Marca praxis:** o produto passou a se chamar **praxis.psi** (empresa Praxis) em todo o repositório, inclusive nomes técnicos (ver exceções na seção 0.1 E); fonte Red Hat; paleta híbrida escolhida pelo dono; logo provisório com o ponto azul.
- **Fluxo usado:** dev em Haiku, revisão e correção em Sonnet (mutantes obrigatórios em segurança), conferência por amostra pelo orquestrador, um agente por vez.
- **Números verdes:** back 796 unit e e2e 551 em paralelo + 91 em série; front 724 testes, build, lint, CSP.

### Histórico por entrega (mais recente primeiro, texto original preservado)
**Atualização de 2026-11-13: o produto agora se chama praxis.psi (empresa Praxis).** Troca feita em todo o repositório (telas, docs, README, CLAUDE.md, título da aba) e também nos nomes técnicos: papéis do banco `praxis_app`/`praxis_owner`, banco `praxis_psi`, variáveis `PRAXIS_*`, cookies `praxis_acesso`/`praxis_refresh`/`praxis_csrf`, cabeçalho `x-praxis-cliente`, `deploy/nginx-praxis.conf.example`. **Exceções (atualizado em 2026-11-13):** o rótulo do HKDF foi trocado de `notta-psi` para `praxis-psi|clinica|<id>` e agora está congelado (ver 0.1 E); o `x-source-app: NottaPsiBack` do cliente do SelahIA ainda NÃO foi renomeado, porque exige trocar os dois lados juntos (tarefa pronta na seção 0.2). As migrations já aplicadas foram editadas (papéis `praxis_*`): bancos antigos precisam ser recriados (`docker compose down -v` só com o dono pedindo). Neste ambiente o Postgres 16 do sistema usa a porta 5432 e os novos papéis foram criados ao lado dos antigos (que ainda existem). O repositório do GitHub e a pasta local são renomeados pelo dono (o remote antigo redireciona). **Marca:** o manual da Praxis está no PDF que o dono enviou; fonte da empresa Red Hat Display e Red Hat Text; cores do app ainda em decisão (a comparação visual A/B/C ficou só como simulação). Logo e ícone em decisão.

**Atualização de 2026-11-11 (4):** a **tela de Início** foi feita (item 79 em `docs/FEATURES.md`, `frontend/src/app/pages/inicio.page.*`): só consome `GET /pacientes`. Ideia futura, não feita: card de rascunhos pendentes (exige rota nova no back, porque hoje rascunho só se lista por paciente).

**Atualização de 2026-11-11 (3):** o item **66 foi fechado** (`[x]`): painel de sigilo das telas públicas reescrito para dizer só o que o código garante (sempre conferir contra `frontend/src/app/seguranca/seguranca.conteudo.ts`) e erro 503 com "muita demanda" em `mensagemHttp`. Pendência pequena: `ia-gerar.page.ts` e `ia.service.ts` tratam qualquer 503 como "IA desligada neste ambiente", o que erra quando o 503 vem do banco ocupado.

**Atualização de 2026-11-11 (2):** o item **52 (retenção e descarte) foi fechado como comandos**. `npm run descartar -- [--dry-run] [--clinica <id>] [--lote N]` (como `praxis_owner`; função SQL `descartar_rascunhos_vencidos`; apaga rascunho sem edição há `PRAXIS_RETENCAO_RASCUNHO_DIAS` dias, padrão 7; apaga junto as gerações de IA ligadas; pula geração PENDENTE; auditoria `DESCARTOU`) e `npm run podar-backups -- <pasta> [--dias N] [--dry-run]` (padrão 30 dias, `PRAXIS_BACKUP_RETENCAO_DIAS`; nunca apaga o backup mais recente). A API devolve `descarteEm` nos rascunhos e a ficha avisa. **Nenhum dos dois roda sozinho: o agendamento é do item 56** (receita de cron marcada como não instalada em `docs/BACKUP-E-CHAVES.md`). Risco registrado pelo revisor: as policies antigas `documento_dono_delete` e `geracaoia_dono_delete` deixam o dono do banco apagar rascunho e geração sem trigger; a proteção real é a credencial `praxis_owner` fora do app (item 56). Cuidado de ambiente: nunca rodar `prisma migrate diff --shadow-database-url` nem reset apontando para `praxis_psi` (já recriou o banco de dev uma vez).

**Atualização de 2026-11-11:** o item **26 (exportar e excluir dados, LGPD) foi fechado** (`[x]`). Exclusão por anonimização (`DELETE /pacientes/:id`, função SQL `anonimizar_paciente`, tombstones cifrados calculados no app, 404 idêntico, auditoria `EXCLUIU`) e exportação em JSON não cifrado (`GET /pacientes/:id/exportar`, auditoria `EXPORTOU`, 10 por hora, teto de 2000 linhas por lista), com tela na ficha do paciente (confirmação digitando o nome para excluir; confirmação inline para baixar). Texto e evidência em `docs/SEGURANCA-AFIRMACOES.md` (`direitos-dados`); o item de retenção virou `retencao` (item 52, aberto). Ambiente desta sessão: Postgres 16 do sistema na porta 5432 (não 5436), `graphify` e a pasta `.superpowers` não existiam. Backups antigos ainda guardam o dado anterior à exclusão: tratar no 52. O texto abaixo é de 2026-11-07 e vale para o restante.

Nada está pela metade. O último item fechado foi o **25, backup e rotação da chave mestra** (`[x]`), com desenvolvimento feito por dois agentes Haiku e revisão e correção por um Sonnet (commits `772c080` a `a6e4a75`). O que existe:
- Chaveiro com várias chaves mestras (`PRAXIS_MASTER_KEYS` e `PRAXIS_MASTER_KEY_ATUAL`), `npm run -s chave:gerar`, comando `npm run recifrar -- [--clinica <id>] [--lote N] [--dry-run]` (só como `praxis_owner`; migration `20261109120000_recifrar_dono`), scripts `backend/scripts/backup.sh` e `verificar-backup.sh` e o guia `docs/BACKUP-E-CHAVES.md`.
- O revisor rodou todos os mutantes do contrato (todos derrubam teste; lacunas viraram testes), achou e fechou lacunas, corrigiu `umask`, `set --` e documentação, e achou a causa do teste instável `documentos-rls` (`TRUNCATE` pede lock exclusivo antes do trigger barrar): as 3 suites com `TRUNCATE` do dono foram para o grupo serial.
- O ciclo real de backup e restauração foi provado com um Postgres 16.2 descartável (backup, verificação, byte corrompido, chave errada e senha errada: todos FALHAM). Exige `pg_dump` da MESMA versão do servidor (o guia explica).

**Sem prova ainda:** recifragem multi-clínica com dados reais; dois processos `recifrar` ao mesmo tempo; restauração num cluster sem os papéis `praxis_owner` e `praxis_app`; backup agendado (é o item 56).

**Estado do ambiente em 2026-11-07:** árvore do git limpa; Postgres embutido 18 de pé na porta 5436 (o Docker estava fora do ar; o container do praxis.psi está parado); o SelahIA local está parado; nenhum servidor de teste rodando. Gates verdes no Postgres 18: 693 unit, 485 e2e em paralelo, 91 em série; o front tem 620 testes verdes (rodar de novo antes de mexer); e2e do back 486 em paralelo e 91 em série.

Item 23 (página pública `/seguranca`): feito por Haiku e revisado por Sonnet, que corrigiu exageros e omissões (IA envia texto a terceiro, o que é e o que não é cifrado, imutabilidade vale contra o aplicativo e não contra o administrador do banco). **Manutenção obrigatória:** a página (`frontend/src/app/seguranca/seguranca.conteudo.ts`) e a tabela de evidências (`docs/SEGURANCA-AFIRMACOES.md`) precisam ser atualizadas sempre que uma proteção mudar (por exemplo, ao entregar MFA, backup agendado ou exclusão LGPD, mover o item de "Ainda não" para "Já existe" com evidência); um teste falha se as duas listas divergirem, mas não confere o texto.

## 6. O que falta (ordem recomendada)

1. **Fase 5 (uso diário), sem dependência externa:** 27 linha do tempo; 28 busca (o texto é cifrado; a lista de pacientes hoje carrega no máximo 500 e ordena no app, precisa de paginação aqui); 29 ajuste de linguagem técnica; 30 exportar PDF ou Word.
2. **Antes de abrir para clínicas:** 67 transferir pacientes de psicólogo desativado (precisa de decisão do dono). O 54 (plano de incidente) tem rascunho em `docs/PLANO-DE-INCIDENTE.md`: faltam encarregado, qualificação jurídica (controlador ou operador, agora com a razão social da Praxis), revisão de advogado e um simulado.
3. **Depende do dono comprar o domínio** (o provedor de e-mail escolhido é o **Resend**, que exige domínio verificado): 24 recuperar senha e confirmar e-mail, 65 convite por e-mail de uso único (fecha o risco I-1), 47 MFA por código de e-mail, 48 bloqueio de conta e aviso de novo login. O domínio também serve para `PRAXIS_APP_URL` e o deploy.
4. **Fase 6 (comercial):** 31 landing page (seguir o modelo de site do manual da Praxis; usar a skill de design de landing, não o design system do app), 32 lista de early access, 33 planos e cobrança, 53 monitoramento e alertas.
5. **Fase 8 (pedidos de uma psicóloga, itens 34 a 36 e 68 a 78):** acompanhamento entre sessões por link (o que ela chamou de diferencial), resumo semanal, alerta de risco com revisão humana, estilo de escrita do psicólogo, comparar registros, resumo pré-sessão, agenda, vídeo, financeiro, recibos, indicadores, repasse e os 3 planos. **Decisão do dono já tomada:** agenda e vídeo por **Google Agenda e Google Meet** (espelho de mão única do praxis.psi para o Google, evento com título genérico e o paciente FORA do evento, link do Meet enviado ao paciente pelo próprio praxis.psi); vídeo próprio é opção futura. A proposta dos planos (Individual, Plus, Premium) está no fim de `docs/FEATURES.md` como rascunho.
6. **Antes do deploy:** 56 hardening de infraestrutura (TLS no banco, banco em rede privada, firewall, backups cifrados com restauração testada, a credencial `praxis_owner` fora do app, testar a receita de CSP no nginx real, e AGENDAR `npm run descartar` e `npm run podar-backups`), 43 CI (o dono pediu deixar por último: testes, lint, `npm audit` e testes de RLS obrigatórios antes de merge), 55 teste de invasão externo e checklist OWASP ASVS.
7. **Fase 7 (áudio, documentos formais, bucket externo, mais de um provedor de IA):** fora do escopo atual.
8. **Revisar o item 50** (cifrar identificadores do paciente em repouso): provavelmente já resolvido para nome, nascimento, telefone e e-mail; conferir e fechar.

## 7. Decisões abertas do dono (pergunte, não decida)

Decisões tomadas em 2026-11-11 e 2026-11-13 (não reabra): rascunho é apagado após 7 dias sem edição e backup é guardado 30 dias; exclusão de paciente é por anonimização; exportação é JSON não cifrado; nome do produto praxis.psi com renomeação completa; fonte Red Hat; paleta híbrida.

- **Logo e ícone** do produto (e favicon). Hoje há só o wordmark provisório.
- **Controlador dos dados:** razão social e CNPJ da Praxis, encarregado e papel (controlador ou operador).
- **Domínio:** confirmar se `praxis.com.br` é o real. Destrava 24, 47, 48, 65 e o deploy.
- **Revisão jurídica do texto do termo** (e da versão, que deve mudar quando revisado) antes de ligar `PRAXIS_TERMO_REVISADO=1`.
- **MFA (item 47):** a preferência registrada é código por e-mail.
- **Plano pago do Gemini:** obrigatório antes de qualquer dado real passar pela IA.
- **Texto digitado e ainda não salvo no celular (item 21):** salvar automaticamente no servidor a cada poucos segundos, sem nada no navegador (recomendado, preserva o sigilo), ou guardar cópia local (não perde texto, mas deixa dado clínico em claro no aparelho). Ainda não decidido.
- **Item 67:** quem autoriza a transferência de pacientes e como fica o registro.
- **Canal do paciente para pedidos LGPD:** hoje só o psicólogo exporta e exclui; o paciente não tem canal próprio.
- **Registro manual de consentimento pelo psicólogo:** manter ou remover, agora que existe o termo por link.
- **Limite de 5 cadastros por hora por IP** conta também as tentativas recusadas por senha fraca: manter ou não contar.
- **Planos (item 77):** preços, limite diário de IA por plano, se "multidisciplinar" significa outras profissões (muda o produto, hoje é só psicologia), recibo no plano Individual, acompanhamento entre sessões no Plus ou em todos. O Google Agenda e Meet exigem verificação do app no Google (escopo OAuth sensível), que leva semanas; vale começar cedo.
- **Reativação de psicólogo desativado** e liberação do e-mail dele (hoje o e-mail continua ocupado).
- **Nome novo do identificador `NottaPsiBack`** no SelahIA: confirmar `PraxisPsiBack` (tarefa na seção 0.2).

## 8. Como implementar sem quebrar o que existe

- **Tabela nova com dado de paciente:** siga `docs/ACESSO.md` (colunas `clinicaId` e `psicologoId`, FK composta incluindo o dono, RLS ENABLE + FORCE com policies para o próprio psicólogo, grants mínimos por coluna, sem DELETE se não precisar). Se for histórico, copie o padrão append-only (policies separadas, trigger que barra UPDATE e DELETE, desvio `app.limpeza_de_teste` só para o dono e só DELETE) e acrescente a limpeza dela em `backend/test/acesso-owner.ts` (`apagarClinicas`). Acesso sem login (token no link) usa policy por hash e `TenantPrismaService` (único lugar com `set_config`, com a exceção documentada da ferramenta de recifragem).
- **Dado cifrado:** gere o `id` no app antes do INSERT, cifre com `aadDe(...)`, nunca devolva coluna `*Cifrado`. Teste que copiar o cifrado de uma linha para outra faz a leitura falhar.
- **Rotas:** `runComoUsuario` para dado do psicólogo; auditoria na MESMA transação; 404 idêntico para recurso alheio e inexistente; nunca I/O de rede dentro de `runComoUsuario`; rota nova com senha provisória fica bloqueada até ganhar `@PermiteSenhaProvisoria()` (nunca em rota de dado clínico); mudanças de estado com UPDATE condicional (`WHERE estado = ...`) para não duplicar em concorrência.
- **Limites do app:** teto de 5 requisições simultâneas e 300 por minuto por psicólogo (429). Tela nova não pode disparar mais de 5 chamadas ao mesmo tempo (prefira sequência).
- **Migrations:** sempre como `praxis_owner`; `prisma migrate diff` limpo; confira o checksum das migrations aplicadas contra os arquivos. Não faça commit de migration sem rodar os testes de banco.
- **Testes:** teste primeiro; teste de RLS precisa provar leitura SEM contexto igual a ZERO linhas; em auth, RLS, criptografia e sessão faça mutação (remova a proteção e veja um teste cair) antes de dizer pronto. Suites que fazem `TRUNCATE` ou DDL ficam no grupo serial (`backend/test/jest-e2e-serial.json`).
- **Front:** componentes de `frontend/src/app/ui`, tokens do design system, textos em português com acentos e caixa de frase, sem emoji, acessível (label em todo campo, erro ligado ao campo, foco no primeiro erro, status com texto), `spellcheck="false"` e `autocomplete="off"` em campo de texto clínico, nada de `innerHTML`, e nada de dado de paciente em console, URL, `localStorage`, `sessionStorage`, `history.state` ou router state (só ids). Requisições na mesma origem pelo proxy `/api`, o front nunca guarda token.

## 9. Riscos e limites conhecidos (não esconda)

- Um anonimizador por regras tem falsos negativos (nome de terceiro, endereço sem número, data por extenso, CPF inválido sem pontuação). A prévia obrigatória do psicólogo é a rede de segurança. Ao reidentificar, o nome do paciente volta na forma cadastrada.
- Quem tem a credencial `praxis_owner` consegue contornar triggers de imutabilidade e agora também recifrar. Só o item 56 fecha (credencial fora do app).
- O risco I-1 (o ADMIN define a senha provisória do colega e pode ativar a conta antes dele) foi aceito pelo dono; o item 65 o fecha. O e-mail de uma conta existente ainda pode ser descoberto no cadastro (409), inclusive entre clínicas; só 24 e 65 fecham.
- A receita de CSP foi verificada num Chrome real com servidor Node, não com o nginx real. Os cabeçalhos (`Referrer-Policy: no-referrer` e `X-Robots-Tag: noindex` em `/termo/*`, CSP com nonce trocado por resposta) têm que ser mandados pelo servidor web de produção.
- O cliente do SelahIA foi exercitado de ponta a ponta só com texto curto e fictício (2 gerações). A qualidade de um rascunho de sessão real não foi avaliada.
- Os JWT antigos (sem `sid`) viram 401 na primeira publicação com sessão segura: todo mundo precisa logar de novo.
- Duas abas renovando juntas derrubariam a sessão sem a trava de Web Locks do front; a trava está testada.
- O backup cifra por senha com `openssl` e só tem soma de verificação; não detecta adulteração. Em produção, prefira `age` ou o KMS do provedor (item 56). Não há backup agendado ainda.
- O teste de carga `carga-clinicas` é sensível à máquina e roda no grupo serial. Nunca foi validado com leitor de tela, nem com IPv6 e proxy reverso de produção.
- Ações já bloqueadas pelo ambiente antes: apagar volume do Docker, mexer nos papéis do cluster, `pkill -f`. Não tente contornar.
- (2026-11-13) Retenção e descarte existem como comandos que NÃO rodam sozinhos: até o item 56 agendar, nada é apagado automaticamente (a página `/seguranca` diz isso). Dado excluído no aplicativo pode ficar até 30 dias nos backups; não há arquivamento de WAL (se ligarem, o WAL precisa do mesmo prazo).
- (2026-11-13) As policies antigas `documento_dono_delete` e `geracaoia_dono_delete` deixam o dono do banco apagar rascunho e geração sem trigger, e a policy `clinica_descartar_select` abre todas as colunas de `Clinica` ao dono com a flag ligada. A proteção real é a credencial `praxis_owner` fora do app (item 56).
- (2026-11-13) A exportação do paciente é um JSON NÃO cifrado, com dado clínico em claro; a guarda é do psicólogo. O limite de 10 exportações por hora também conta 400, 404 e 413, de propósito.
- (2026-11-13) A exclusão por anonimização não apaga linhas: preserva consentimento e trilha sem identificar o paciente. O texto já enviado ao serviço de IA de terceiros não é apagado por nós. Uma chamada de IA já em voo quando a exclusão commita termina, mas o banco barra o documento novo e o pedido vira FALHOU.
- (2026-11-13) Renomeação: o rótulo HKDF virou `praxis-psi|clinica|<id>` (congelado daqui em diante; dado cifrado antes dessa data é ilegível) e o `x-source-app: NottaPsiBack` ainda não foi renomeado (seção 0.2); trocar só um dos lados derruba a IA.

## 10. Como se comunicar com o dono

Português, direto, curto. Ele tem TDAH: passos pequenos, uma coisa por vez, explique o porquê, dê uma recomendação clara em vez de só opções. Em respostas do Claude Code vale o modo "caveman" (frases curtas, sem cerimônia, substância técnica intacta); tudo que for persistido (código, commits, docs) fica em prosa normal. Toda resposta termina com três blocos nesta ordem: **Lista** (as funcionalidades planejadas que ainda faltam, numeradas, uma linha cada), **Recomendação** (com o porquê em uma frase) e **Próximo passo** (um só). Separe sempre o que você VERIFICOU do que apenas presumiu. Quando gerar prints, mande-os de forma que ele veja no celular (`SendUserFile` no Claude Code).
