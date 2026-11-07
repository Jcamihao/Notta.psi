# Notta.psi — handoff (passagem de bastão, estado em 2026-11-06)

Este documento é para um agente de código (Codex ou outro Claude) que vai continuar o projeto. Leia inteiro antes de mexer em qualquer coisa. O dono do produto é João (`johnmarcus3210@gmail.com`); ele fala português, prefere respostas curtas, objetivas e honestas, acompanha muitas vezes pelo celular e usa um fechamento fixo (seção 10).

## 0. Primeiros passos (faça nesta ordem)

1. `git status` e `git log --oneline | head -15` (a árvore deve estar limpa; o último trabalho foi o item 25, backup e rotação da chave mestra).
2. Leia `docs/FEATURES.md` (ordem e estado), `docs/ACESSO.md` (regras de acesso e padrões de banco) e, se existir, `.superpowers/sdd/fase-1/contrato.md` (contratos e decisões do dono, item por item).
3. Suba o banco (seção 3), rode `npx prisma migrate deploy` e os gates do back e do front (seção 3) para confirmar que tudo está verde ANTES de mexer.
4. Leia a seção 5 (onde parou) e siga a seção 6, um item por vez, parando para perguntar nas decisões da seção 7.

## 1. O que é o produto

Notta.psi é um SaaS multi-clínica para psicólogos. O psicólogo escreve a nota bruta de uma sessão, a IA (via SelahIA) rascunha uma evolução ou anamnese, e o psicólogo sempre revisa e aprova. A maior objeção dos 12 psicólogos que responderam o Google Forms foi confidencialidade (8 de 12). Por isso o sigilo pesa mais que qualquer outra regra: na dúvida, guarde menos dado, cifre mais, registre quem acessou e nunca mande texto clínico para log, URL, storage do navegador ou serviço de terceiros.

Repositório: `/home/caminhao/codeStage/Notta.psi` (git local, branch `master`, sem remoto). Dois projetos independentes: `backend/` (NestJS 11, Prisma 6, Postgres) e `frontend/` (Angular 20, standalone, Signals, zoneless).

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
- Plano A, Docker: na pasta do repo `docker compose up -d` (Postgres 16; superuser `postgres`, senha de desenvolvimento `postgres-dev`; acesso `docker exec -i nottapsi-postgres-1 psql -U postgres -d notta_psi`). O script `docker/initdb` cria os papéis `notta_owner` (dono das tabelas, roda migrations) e `notta_app` (runtime, sem superuser, sujeito a RLS) só no primeiro start do volume. O Docker costuma cair no WSL (`docker: command not found`); se cair, use o plano B.
- Plano B, Postgres embutido 18 em `~/.cache/notta-pgtool` (leia o `README.txt`; superuser `postgres`/`pgtool-throwaway`; SQL de superuser: `node ~/.cache/notta-pgtool/q.mjs postgres pgtool-throwaway '<sql>'`). `./restart.sh` apaga e recria o banco descartável com papéis, o REVOKE de `lo_create` e TODAS as migrations. Se a pasta `data/` ficar velha sem processo vivo, mova-a para `data.old.<n>` antes. Pare por PID gravado (`ps -o args= -p $(cat pg.pid)` deve mostrar `node start.mjs`). Estado hoje: o embutido está de pé, e o container Docker está parado.
- Para trocar de plano: pare o que está de pé por PID, suba o outro, rode `npx prisma migrate deploy` e o `backend/prisma/bootstrap/endurecer-banco.sql` (como superuser, uma vez por banco novo; o teste de privilégios falha de propósito sem ele).

**Variáveis em `backend/`** (só em variáveis de shell, nunca no repo):
```
export DATABASE_URL=postgresql://notta_app:notta_app@localhost:5436/notta_psi
export DATABASE_URL_OWNER=postgresql://notta_owner:notta_owner@localhost:5436/notta_psi
npx prisma migrate deploy
```
Para subir o app à mão: gere `NOTTA_MASTER_KEY` (`npm run -s chave:gerar`) e `NOTTA_JWT_SECRET` (`openssl rand -base64 48`), use `NODE_ENV=development` e leia `backend/README.md` e `backend/.env.example`. Outras variáveis que o boot conhece: `NOTTA_MASTER_KEYS` + `NOTTA_MASTER_KEY_ATUAL` (várias chaves mestras, item 25), `NOTTA_APP_URL` e `NOTTA_TERMO_REVISADO` (link do termo, produção exige `=1`), `NOTTA_CORS_ORIGIN`, `NOTTA_API_PREFIXO`, `NOTTA_TRUST_PROXY`, `NOTTA_IA_HABILITADA`, `SELAHIA_URL`, `SELAHIA_API_KEY`, `NOTTA_IA_LIMITE_DIARIO`, `NOTTA_BACKUP_SENHA`.

**Verificação** (últimos números verdes em 2026-11-06, no Postgres 18 embutido):
- `backend/`: `npm run build`, `npm run lint`, `npm run format:check`, `npm test` (693 unit), `npm run test:e2e` (485 em paralelo + 91 em série, dois grupos em sequência), `npm run scan:segredos`.
- `frontend/`: `npm run lint`, `npm run format:check`, `npm run build`, `npm test` (598; precisa de `CHROME_BIN`, em `~/.cache/puppeteer/chrome/*/chrome-linux64/chrome`), `npm run verificar:csp` e `npm run test:csp`.
- Integração real no navegador: back e front de verdade com `puppeteer-core` (em `/home/caminhao/codeStage/PraiseApp/node_modules/puppeteer-core`). Use portas próprias (back 3150, front 4350 com `ng serve --proxy-config <arquivo apontando para 3150>`); outras portas (3000, 3010, 3100) podem ser de outros projetos. Para apagar clínica de teste: copie um script temporário para `backend/` que importe `apagarClinicas` de `./test/acesso-owner` e rode com `npx ts-node --transpile-only`; apague o arquivo depois.
- O grafo de código está em `graphify-out/` (`graphify query "<pergunta>"` antes de caçar arquivo; `graphify update .` depois de mudar código; nunca dois em paralelo).

**SelahIA local** (para testar a IA de verdade, só com dado FICTÍCIO enquanto o Gemini estiver no plano grátis): repositório `/home/caminhao/codeStage/SelahIA`. Para subir: `npm run build` lá e `SELAH_APP_KEYS="NottaPsiBack:<chave de 40+ caracteres gerada na hora>" PORT=3010 node dist/main` (o `.env` dele já tem a chave do Gemini). No Notta.psi use `NOTTA_IA_HABILITADA=1`, `SELAHIA_URL=http://127.0.0.1:3010`, `SELAHIA_API_KEY=<a mesma chave>`. Hoje ele está parado.

## 4. O que já está pronto e verificado

Itens de `docs/FEATURES.md` feitos e verificados (`[x]`): 1 a 22, 25, 41, 42, 44, 45, 46, 49, 51, 57 a 64 e a Fase 1.6. Os itens 23 e 24 estão abertos. Resumo do que existe:

- **Isolamento:** todo dado de clínica tem `clinicaId` e RLS ENABLE + FORCE. Cada psicólogo lê só os próprios pacientes e documentos (padrão `psicologo_proprio`, `docs/ACESSO.md`); o ADMIN gerencia a equipe e atende os próprios pacientes, mas não lê prontuário de colega. FKs filhas incluem `psicologoId`, porque checagem de FK ignora RLS.
- **Criptografia:** AES-256-GCM, chave por clínica derivada por HKDF de uma chave mestra, formato `v1.<kid>.<iv>.<tag>.<ct>`, AAD obrigatório (`aadDe(tabela, coluna, id, psicologoId)`), chaveiro com várias chaves (`k1`, `k2`...) e `kid` lido do próprio valor (sem fallback). Paciente (nome, nascimento, telefone, e-mail) e conteúdo de documento ficam cifrados.
- **Auth e sessão (itens 6, 45, 46, 49, 57, 62):** cookies `httpOnly` (`notta_acesso` de 15 min, `notta_refresh` com renovação rotativa e detecção de reuso, `notta_csrf` para double-submit); sessão máxima de 7 dias e 30 minutos parado; tabela `Sessao` revogável; "Sair" e "Sair de todos os aparelhos"; CSRF por cabeçalho mais `Origin`; o login só devolve token no corpo com o cabeçalho `x-notta-cliente: api` (clientes que não são navegador e os testes; o front nunca manda). Senha com mínimo de 10 caracteres, lista local de 10 mil senhas comuns e regras pessoais (a política vale ao definir ou trocar senha, não no login). Senha provisória do colega com troca obrigatória. Bcrypt nativo com teto de concorrência e limites de tentativa. O front não guarda token (verificado: nada em `sessionStorage`/`localStorage`); a renovação é serializada entre abas com Web Locks.
- **Tabelas somente-acrescentar e imutáveis:** `Auditoria`, `Consentimento`, `Documento` aprovado (trigger, até para o dono, exceto o desvio de limpeza de teste e a exceção de recifragem do item 25), `GeracaoIa` com máquina de estados no banco, `ConviteConsentimento`, `Sessao`.
- **Documento clínico:** nota bruta, evolução e anamnese; rascunho editável, aprovação irreversível, correção vira novo documento ligado ao anterior; prontuário (aprovados) e rascunhos separados; aviso local de dado que identifica na digitação.
- **Consentimento:** registro manual do psicólogo e termo por link de uso único (7 dias, token de 256 bits, só o hash no banco, página pública `/termo/:token` sem login, aceitar ou recusar). **O texto do termo é RASCUNHO NÃO REVISADO** (`backend/src/consentimento/termo-consentimento.ts`, versão `v1-rascunho`); em produção o boot só passa com `NOTTA_TERMO_REVISADO=1`, que o dono só liga depois de revisão jurídica.
- **IA (itens 17 a 21, 42, 51):** anonimizador determinístico com códigos entre colchetes (junta partes do nome do paciente num código só) e reidentificação, cliente do SelahIA (timeout, erros tipados, https obrigatório em produção, sem log de texto), saneamento da saída, prévia obrigatória (o servidor guarda o texto anonimizado e o mapa cifrados; a confirmação nunca reenvia texto), geração em processo fora de transação, retentativa sem limite que não duplica documento, limite diário de gerações bem-sucedidas (padrão 20, dia em `America/Sao_Paulo`), mapa e texto zerados no banco quando a geração fica PRONTA (CHECK no banco). Testado de ponta a ponta contra o SelahIA e o Gemini REAIS com dado fictício (2 gerações). Contrato do SelahIA (v2.7.9): `POST /v1/adapters/psicologia/rascunho/gerar` com `x-selah-api-key`, corpo `{tipoDocumento: 'evolucao'|'anamnese', abordagem, textoAnonimizado ≤ 8000}`.
- **Equipe:** adicionar colega com senha provisória, listar, desativar (o desativado perde acesso na hora; dados ficam guardados; não há reativação nem transferência de pacientes).
- **Front:** design system "intelly" (`docs/DESIGN-SYSTEM.md`: DM Sans auto-hospedada, ícones Lucide por npm, nada de CDN); login, cadastro, equipe, pacientes, consentimento e termo por link, documentos, geração por IA (prévia, acompanhar, tentar de novo, pedidos), troca de senha, sair de todos os aparelhos. Funciona em desktop e mobile web (não existe app nativo). O build de produção passa em `npm run verificar:csp` (CSP estrita com nonce; receita em `docs/SEGURANCA-HEADERS.md` e `deploy/nginx-notta.conf.example`, testada com um servidor Node equivalente, NÃO com o nginx real).

Os contratos de cada item e os relatórios dos agentes estão em `.superpowers/sdd/fase-1/` (pasta ignorada pelo git, só existe nesta máquina: `contrato.md`, `task-*-brief.md`, `task-*-report.md` explicam decisões e COMO USAR de cada etapa).

## 5. Onde parou

Nada está pela metade. O último item fechado foi o **25, backup e rotação da chave mestra** (`[x]`), com desenvolvimento feito por dois agentes Haiku e revisão e correção por um Sonnet (commits `772c080` a `a6e4a75`). O que existe:
- Chaveiro com várias chaves mestras (`NOTTA_MASTER_KEYS` e `NOTTA_MASTER_KEY_ATUAL`), `npm run -s chave:gerar`, comando `npm run recifrar -- [--clinica <id>] [--lote N] [--dry-run]` (só como `notta_owner`; migration `20261109120000_recifrar_dono`), scripts `backend/scripts/backup.sh` e `verificar-backup.sh` e o guia `docs/BACKUP-E-CHAVES.md`.
- O revisor rodou todos os mutantes do contrato (todos derrubam teste; lacunas viraram testes), achou e fechou lacunas, corrigiu `umask`, `set --` e documentação, e achou a causa do teste instável `documentos-rls` (`TRUNCATE` pede lock exclusivo antes do trigger barrar): as 3 suites com `TRUNCATE` do dono foram para o grupo serial.
- O ciclo real de backup e restauração foi provado com um Postgres 16.2 descartável (backup, verificação, byte corrompido, chave errada e senha errada: todos FALHAM). Exige `pg_dump` da MESMA versão do servidor (o guia explica).

**Sem prova ainda:** recifragem multi-clínica com dados reais; dois processos `recifrar` ao mesmo tempo; restauração num cluster sem os papéis `notta_owner` e `notta_app`; backup agendado (é o item 56).

**Estado do ambiente em 2026-11-07:** árvore do git limpa; Postgres embutido 18 de pé na porta 5436 (o Docker estava fora do ar; o container do Notta.psi está parado); o SelahIA local está parado; nenhum servidor de teste rodando. Gates verdes no Postgres 18: 693 unit, 485 e2e em paralelo, 91 em série; o front tinha 598 testes verdes (rodar de novo antes de mexer).

## 6. O que falta (ordem recomendada)

1. **Fase 4 sem dependência externa:** 23 página de transparência de segurança (front, com o que já existe), 26 exportar e excluir dados (LGPD; precisa de decisão do dono), 52 retenção e descarte (inclui retenção das tabelas `Sessao` e do que ficou `RESTRICT`), 54 plano de incidente (processo, escrever um documento).
2. **Depende do dono comprar o domínio** (o provedor de e-mail escolhido é o **Resend**, que exige domínio verificado): 24 recuperar senha e confirmar e-mail, 65 convite por e-mail de uso único (fecha o risco I-1), 47 MFA por código de e-mail, 48 bloqueio de conta e aviso de novo login. O domínio também serve para `NOTTA_APP_URL` e o deploy.
3. **Antes de abrir para clínicas:** 66 ajustar o texto do painel de sigilo e a mensagem de 503 do login ao que o código realmente garante, 67 transferir pacientes de psicólogo desativado.
4. **Fase 5 (uso diário):** 27 linha do tempo, 28 busca (o texto é cifrado; a lista de pacientes hoje carrega no máximo 500 e ordena no app, precisa de paginação aqui), 29 ajuste de linguagem técnica, 30 exportar PDF ou Word.
5. **Fase 6 (comercial):** 31 landing page (use a skill de design de landing, não o design system do app), 32 lista de early access, 33 planos e cobrança, 53 monitoramento e alertas.
6. **Fase 8 (pedidos de uma psicóloga, itens 34 a 36 e 68 a 78):** acompanhamento entre sessões por link (o que ela chamou de diferencial), resumo semanal, alerta de risco com revisão humana, estilo de escrita do psicólogo, comparar registros, resumo pré-sessão, agenda, vídeo, financeiro, recibos, indicadores, repasse e os 3 planos. **Decisão do dono já tomada:** agenda e vídeo por **Google Agenda e Google Meet** (espelho de mão única do Notta.psi para o Google, evento com título genérico e o paciente FORA do evento, link do Meet enviado ao paciente pelo próprio Notta.psi); vídeo próprio é opção futura. A proposta dos planos (Individual, Plus, Premium) está no fim de `docs/FEATURES.md` como rascunho.
7. **Antes do deploy:** 56 hardening de infraestrutura (TLS no banco, banco em rede privada, firewall, backups cifrados com restauração testada, a credencial `notta_owner` fora do app, testar a receita de CSP no nginx real), 43 CI (o dono pediu deixar por último: testes, lint, `npm audit` e testes de RLS obrigatórios antes de merge), 55 teste de invasão externo e checklist OWASP ASVS.
8. **Fase 7 (áudio, documentos formais, bucket externo, mais de um provedor de IA):** fora do escopo atual.

## 7. Decisões abertas do dono (pergunte, não decida)

- **Revisão jurídica do texto do termo** (e da versão, que deve mudar quando revisado) antes de ligar `NOTTA_TERMO_REVISADO=1`.
- **Compra do domínio** (destrava 24, 47, 48, 65 e o deploy).
- **MFA (item 47):** a preferência registrada é código por e-mail.
- **Plano pago do Gemini:** obrigatório antes de qualquer dado real passar pela IA.
- **Texto digitado e ainda não salvo no celular (item 21):** salvar automaticamente no servidor a cada poucos segundos, sem nada no navegador (recomendado, preserva o sigilo), ou guardar cópia local (não perde texto, mas deixa dado clínico em claro no aparelho). Ainda não decidido.
- **Exclusão LGPD (item 26):** psicólogo com trilha, paciente com consentimento ou documento e documento com correção têm FK `RESTRICT`, e trilha e consentimento são somente-acrescentar. Excluir de verdade exige decidir o que acontece com a trilha e como anonimizar ou apagar.
- **Item 67:** quem autoriza a transferência de pacientes e como fica o registro.
- **Registro manual de consentimento pelo psicólogo:** manter ou remover, agora que existe o termo por link.
- **Limite de 5 cadastros por hora por IP** conta também as tentativas recusadas por senha fraca: manter ou não contar.
- **Planos (item 77):** preços, limite diário de IA por plano, se "multidisciplinar" significa outras profissões (muda o produto, hoje é só psicologia), recibo no plano Individual, acompanhamento entre sessões no Plus ou em todos. O Google Agenda e Meet exigem verificação do app no Google (escopo OAuth sensível), que leva semanas; vale começar cedo.
- **Reativação de psicólogo desativado** e liberação do e-mail dele (hoje o e-mail continua ocupado).

## 8. Como implementar sem quebrar o que existe

- **Tabela nova com dado de paciente:** siga `docs/ACESSO.md` (colunas `clinicaId` e `psicologoId`, FK composta incluindo o dono, RLS ENABLE + FORCE com policies para o próprio psicólogo, grants mínimos por coluna, sem DELETE se não precisar). Se for histórico, copie o padrão append-only (policies separadas, trigger que barra UPDATE e DELETE, desvio `app.limpeza_de_teste` só para o dono e só DELETE) e acrescente a limpeza dela em `backend/test/acesso-owner.ts` (`apagarClinicas`). Acesso sem login (token no link) usa policy por hash e `TenantPrismaService` (único lugar com `set_config`, com a exceção documentada da ferramenta de recifragem).
- **Dado cifrado:** gere o `id` no app antes do INSERT, cifre com `aadDe(...)`, nunca devolva coluna `*Cifrado`. Teste que copiar o cifrado de uma linha para outra faz a leitura falhar.
- **Rotas:** `runComoUsuario` para dado do psicólogo; auditoria na MESMA transação; 404 idêntico para recurso alheio e inexistente; nunca I/O de rede dentro de `runComoUsuario`; rota nova com senha provisória fica bloqueada até ganhar `@PermiteSenhaProvisoria()` (nunca em rota de dado clínico); mudanças de estado com UPDATE condicional (`WHERE estado = ...`) para não duplicar em concorrência.
- **Limites do app:** teto de 5 requisições simultâneas e 300 por minuto por psicólogo (429). Tela nova não pode disparar mais de 5 chamadas ao mesmo tempo (prefira sequência).
- **Migrations:** sempre como `notta_owner`; `prisma migrate diff` limpo; confira o checksum das migrations aplicadas contra os arquivos. Não faça commit de migration sem rodar os testes de banco.
- **Testes:** teste primeiro; teste de RLS precisa provar leitura SEM contexto igual a ZERO linhas; em auth, RLS, criptografia e sessão faça mutação (remova a proteção e veja um teste cair) antes de dizer pronto. Suites que fazem `TRUNCATE` ou DDL ficam no grupo serial (`backend/test/jest-e2e-serial.json`).
- **Front:** componentes de `frontend/src/app/ui`, tokens do design system, textos em português com acentos e caixa de frase, sem emoji, acessível (label em todo campo, erro ligado ao campo, foco no primeiro erro, status com texto), `spellcheck="false"` e `autocomplete="off"` em campo de texto clínico, nada de `innerHTML`, e nada de dado de paciente em console, URL, `localStorage`, `sessionStorage`, `history.state` ou router state (só ids). Requisições na mesma origem pelo proxy `/api`, o front nunca guarda token.

## 9. Riscos e limites conhecidos (não esconda)

- Um anonimizador por regras tem falsos negativos (nome de terceiro, endereço sem número, data por extenso, CPF inválido sem pontuação). A prévia obrigatória do psicólogo é a rede de segurança. Ao reidentificar, o nome do paciente volta na forma cadastrada.
- Quem tem a credencial `notta_owner` consegue contornar triggers de imutabilidade e agora também recifrar. Só o item 56 fecha (credencial fora do app).
- O risco I-1 (o ADMIN define a senha provisória do colega e pode ativar a conta antes dele) foi aceito pelo dono; o item 65 o fecha. O e-mail de uma conta existente ainda pode ser descoberto no cadastro (409), inclusive entre clínicas; só 24 e 65 fecham.
- A receita de CSP foi verificada num Chrome real com servidor Node, não com o nginx real. Os cabeçalhos (`Referrer-Policy: no-referrer` e `X-Robots-Tag: noindex` em `/termo/*`, CSP com nonce trocado por resposta) têm que ser mandados pelo servidor web de produção.
- O cliente do SelahIA foi exercitado de ponta a ponta só com texto curto e fictício (2 gerações). A qualidade de um rascunho de sessão real não foi avaliada.
- Os JWT antigos (sem `sid`) viram 401 na primeira publicação com sessão segura: todo mundo precisa logar de novo.
- Duas abas renovando juntas derrubariam a sessão sem a trava de Web Locks do front; a trava está testada.
- O backup cifra por senha com `openssl` e só tem soma de verificação; não detecta adulteração. Em produção, prefira `age` ou o KMS do provedor (item 56). Não há backup agendado ainda.
- O teste de carga `carga-clinicas` é sensível à máquina e roda no grupo serial. Nunca foi validado com leitor de tela, nem com IPv6 e proxy reverso de produção.
- Ações já bloqueadas pelo ambiente antes: apagar volume do Docker, mexer nos papéis do cluster, `pkill -f`. Não tente contornar.

## 10. Como se comunicar com o dono

Português, direto, curto. Ele tem TDAH: passos pequenos, uma coisa por vez, explique o porquê, dê uma recomendação clara em vez de só opções. Em respostas do Claude Code vale o modo "caveman" (frases curtas, sem cerimônia, substância técnica intacta); tudo que for persistido (código, commits, docs) fica em prosa normal. Toda resposta termina com três blocos nesta ordem: **Lista** (as funcionalidades planejadas que ainda faltam, numeradas, uma linha cada), **Recomendação** (com o porquê em uma frase) e **Próximo passo** (um só). Separe sempre o que você VERIFICOU do que apenas presumiu. Quando gerar prints, mande-os de forma que ele veja no celular (`SendUserFile` no Claude Code).
