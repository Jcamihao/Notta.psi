# Notta.psi — passagem de bastão (estado em 2026-11-04)

Este documento foi escrito para um agente de código (Codex) que vai continuar o projeto no lugar do Claude. Leia ele inteiro antes de mexer em qualquer coisa. O dono do produto é João (`johnmarcus3210@gmail.com`); ele fala português e prefere respostas curtas, objetivas e honestas, com um fechamento fixo (veja "Como se comunicar").

## 1. O que é o produto

Notta.psi é um SaaS multi-clínica para psicólogos. O psicólogo escreve a nota bruta de uma sessão, a IA (via SelahIA) rascunha uma evolução ou anamnese, e o psicólogo sempre revisa e aprova. A maior objeção dos 12 psicólogos que responderam o Google Forms foi confidencialidade (8 de 12). Por isso o sigilo é a regra que mais pesa em qualquer decisão: na dúvida, guarde menos dado, cifre mais, registre quem acessou e nunca mande texto clínico para log, URL, storage do navegador ou serviço de terceiros.

Repositório: `/home/caminhao/codeStage/Notta.psi` (git local, branch `master`, sem remoto). Dois projetos independentes: `backend/` (NestJS 11, Prisma 6, Postgres) e `frontend/` (Angular 20, standalone, Signals, zoneless).

## 2. Regras do dono (não negocie)

- Nunca faça commit, push, merge ou deploy por conta própria fora do que o dono pediu. Se ele pediu "faça o item X", um commit por etapa em português, com caminhos explícitos (`git add <caminho>`, nunca `git add -A`), sem `--amend`, `reset` ou `rebase`.
- Decisões de produto são do dono. Quando faltar uma, pare e pergunte com uma recomendação sua (veja a seção 7 com as que estão abertas). Não invente regra de negócio.
- Nunca copie segredo em chat, relatório ou commit. Nunca registre texto clínico, senha, token ou chave em log.
- Não rode `docker compose down -v` sem o dono pedir (apaga o volume do banco de desenvolvimento).
- Antes de dizer "pronto", rode build, lint, format e testes e diga o que rodou de verdade. Separe "verifiquei" de "presumi".
- Ao terminar cada funcionalidade, ensine o dono a usar: o que foi adicionado, como funciona e como ver funcionando (passos curtos, só comandos que você rodou).
- A fonte única da ordem de trabalho é `docs/FEATURES.md` (checkboxes). Marque `[x]` só depois de verificar.

## 3. Como rodar

Banco de desenvolvimento e testes: Postgres 16 no Docker. Na pasta do repo, `docker compose up -d` (porta `127.0.0.1:5436`, superuser `postgres` com a senha de desenvolvimento `postgres-dev`, acesso por `docker exec -i nottapsi-postgres-1 psql -U postgres -d notta_psi`). O script `docker/initdb` cria os papéis `notta_owner` (dono das tabelas, roda migrations) e `notta_app` (runtime, sem superuser, sujeito a RLS) apenas no primeiro start do volume. Plano B se o Docker estiver fora: Postgres embutido em `~/.cache/notta-pgtool` (leia o `README.txt` de lá; `restart.sh` apaga e recria o banco descartável; ele usa a mesma porta, então nunca rode os dois juntos).

Todo banco novo precisa do script de endurecimento, uma vez, como superuser: `backend/prisma/bootstrap/endurecer-banco.sql` (revoga `lo_create`). O teste de privilégios falha de propósito sem ele.

Variáveis para trabalhar em `backend/` (valores só em variáveis de shell, nunca no repo):

```
export DATABASE_URL=postgresql://notta_app:notta_app@localhost:5436/notta_psi
export DATABASE_URL_OWNER=postgresql://notta_owner:notta_owner@localhost:5436/notta_psi
npx prisma migrate deploy
```

Para subir o app à mão: gere `NOTTA_MASTER_KEY` (`openssl rand -hex 32`) e `NOTTA_JWT_SECRET` (`openssl rand -base64 48`), use `NODE_ENV=development` (sem isso o boot exige `NOTTA_TRUST_PROXY`) e leia `backend/README.md` e `backend/.env.example`. A IA só liga com `NOTTA_IA_HABILITADA=1`, `SELAHIA_URL` e `SELAHIA_API_KEY`.

Verificação (os números abaixo eram os últimos verdes; confira que continuam):

- `backend/`: `npm run build`, `npm run lint`, `npm run format:check`, `npm test` (447 unit), `npm run test:e2e` (355 em paralelo e 42 em série, dois grupos em sequência), `npm run scan:segredos`.
- `frontend/`: `npm run lint`, `npm run format:check`, `npm run build`, `npm test` (precisa de `CHROME_BIN`; procure em `~/.cache/puppeteer/chrome/*/chrome-linux64/chrome`). Eram 354 testes antes do trabalho em andamento da seção 5.
- Integração real no navegador: back e front de verdade com `puppeteer-core` (existe em `/home/caminhao/codeStage/PraiseApp/node_modules/puppeteer-core`). Use portas próprias (back 3100, front 4300 com `ng serve --proxy-config <arquivo apontando para 3100>`) para não colidir com outras coisas. Pare servidores por PID, nunca `pkill -f`.
- O repositório tem um grafo de código em `graphify-out/` (`graphify query "<pergunta>"` antes de caçar arquivo; `graphify update .` depois de mudar código, nunca dois em paralelo).

## 4. O que já está pronto e verificado

Itens de `docs/FEATURES.md` marcados `[x]`: 1 a 19 (menos 20 e 21, parcialmente prontos), 41, 42, 44, 51, 57 a 64 e a Fase 1.6 (correções da segunda revisão de segurança). Em resumo:

- **Isolamento:** todo dado de clínica tem `clinicaId` e RLS ENABLE + FORCE. Cada psicólogo lê só os próprios pacientes e documentos (padrão `psicologo_proprio`, ver `docs/ACESSO.md`); o ADMIN gerencia a equipe e atende os próprios pacientes, mas não lê prontuário de colega. FKs filhas incluem `psicologoId`, porque checagem de FK ignora RLS.
- **Criptografia:** AES-256-GCM, chave por clínica derivada por HKDF da `NOTTA_MASTER_KEY`, formato `v1.k1.<iv>.<tag>.<ct>`, AAD obrigatório (`aadDe(tabela, coluna, id, psicologoId)`). Paciente (nome, nascimento, telefone, e-mail) e conteúdo de documento ficam cifrados.
- **Auth:** JWT HS256 de 8 h com `sub`, `clinicaId` e `tv`; o guard global confere o psicólogo no banco a cada requisição (inativo, removido ou `tv` diferente dá 401; erro de infraestrutura dá 503). Bcrypt nativo custo 12 com teto de concorrência, limites de tentativa por IP e por conta, senha provisória com troca obrigatória, troca de senha, desativação de psicólogo.
- **Tabelas somente-acrescentar e imutáveis:** `Auditoria` (quem, o quê, quando, sem conteúdo), `Consentimento` (eventos), `Documento` aprovado imutável por trigger (inclusive para o dono do banco, exceto o desvio de limpeza de teste), `GeracaoIa` com máquina de estados no banco. Padrão: policies separadas, grants mínimos, trigger que barra o resto.
- **Documento clínico:** nota bruta, evolução e anamnese; rascunho editável, aprovação irreversível, correção vira novo documento ligado ao anterior; prontuário (aprovados) e rascunhos separados; aviso local de dado que identifica na digitação; consentimento `CONCEDIDO` exigido para criar documento.
- **IA (back completo):** anonimizador determinístico com códigos entre colchetes e reidentificação, cliente do SelahIA (timeout, erros tipados, https obrigatório em produção, sem log de texto), saneamento da saída, prévia obrigatória (o servidor guarda o texto anonimizado e o mapa cifrados; a confirmação nunca reenvia texto), geração em processo fora de transação, retentativa sem limite que não duplica documento, limite diário de gerações bem-sucedidas (`NOTTA_IA_LIMITE_DIARIO`, padrão 20, dia em `America/Sao_Paulo`), mapa e texto zerados no banco quando a geração fica PRONTA (CHECK no banco). Contrato do SelahIA (verificado em `/home/caminhao/codeStage/SelahIA`, v2.7.9): `POST /v1/adapters/psicologia/rascunho/gerar` com `x-selah-api-key`, corpo `{tipoDocumento: 'evolucao'|'anamnese', abordagem, textoAnonimizado ≤ 8000}`.
- **Front:** design system "intelly" em `docs/DESIGN-SYSTEM.md` (DM Sans auto-hospedada, ícones Lucide por npm, nada de CDN); login, cadastro de clínica, equipe (com desativar), pacientes, consentimento, documentos, troca de senha obrigatória; funciona em desktop e mobile web (não existe app nativo).

Os contratos detalhados de cada item e os relatórios dos agentes que implementaram estão em `.superpowers/sdd/fase-1/` (pasta ignorada pelo git, só existe nesta máquina; `contrato.md` e os `task-*-report.md` explicam decisões e COMO USAR de cada etapa).

## 5. O que está em andamento agora (termine isto primeiro)

Itens 20 e 21, parte do front (geração por IA). O commit `88d4ade` (prévia da nota anonimizada) já está feito. Há trabalho NÃO commitado na árvore: `frontend/src/app/ia/` (acompanhamento da geração, seção "Pedidos de IA") e mudanças em `frontend/src/app/documentos/`, `paciente-form` e `styles.scss`. Um agente do Claude estava terminando isso; ele pode ter parado no meio. Faça:

1. `git status` e `git diff`; liste o que o brief pedia e o que falta (`.superpowers/sdd/fase-1/task-f19-brief.md` tem o brief completo; `contrato.md`, seção "Onda B", tem rotas, estados e erros do back).
2. Termine: passo de acompanhamento (consulta a cada 3 s, no máximo 2 chamadas simultâneas, parar ao sair da página), PRONTO abre o rascunho, FALHOU mostra o motivo em linguagem simples com "Tentar de novo" sem limite, falha não retentável sem botão, tratamento dos dois 429 (limite diário e "já há geração em andamento"), seção "Pedidos de IA" no paciente, faixa "Rascunho gerado por IA. Revise antes de aprovar." e pill "IA" nas listas.
3. Rode os gates do front e faça a integração real uma vez, com um SelahIA FALSO em `node:http` e o back com `NOTTA_IA_HABILITADA=1` apontando para ele: previa com nome e CPF trocados, nova previa, enviar, PRONTO, derrubar o fake para ver FALHOU e "Tentar de novo" gerando UM só documento, sair e voltar vendo "Pedidos de IA", IA desligada mostrando o aviso, mobile 390 px sem rolagem horizontal, texto clínico ausente de console, storage, URL e `history.state`.
4. Faça o commit, marque 20 e 21 em `docs/FEATURES.md`.

## 6. O que falta (ordem recomendada)

1. **Testar contra o SelahIA de verdade com dado sintético.** Até hoje só existiu servidor falso. Confira timeouts, 429 e o formato real. Nada de dado real enquanto o Gemini estiver no plano grátis.
2. **Fase 4 (confiança e segurança):** 22 termo de consentimento do paciente (obrigatório antes de qualquer dado real; hoje o termo é provisório e o psicólogo é quem registra), 24 recuperar senha e confirmar e-mail (precisa decidir o provedor de e-mail), 65 convite por e-mail de uso único (fecha o risco I-1; depende do 24), 45 senha forte e checagem de senha vazada, 46 sessões revogáveis com refresh rotativo, 47 MFA (decisão aberta), 48 bloqueio de conta e aviso de novo login, 49 sessão em cookie httpOnly com CSRF e CSP (hoje o token fica em `sessionStorage`), 25 backup e rotação da chave mestra, 26 exportar e excluir dados (LGPD), 23 página de transparência, 52 retenção e descarte, 54 plano de incidente (processo), 50 cifrar identificadores (já cobre os campos que existem; falta CPF e endereço só se o dono decidir guardá-los).
3. **Itens antes de abrir para clínicas:** 66 ajustar o texto do painel de sigilo e a mensagem de 503 do login ao que o código realmente garante, 67 transferir pacientes de psicólogo desativado.
4. **Fase 5 (uso diário):** 27 linha do tempo, 28 busca por metadados (o texto é cifrado; a lista de pacientes hoje carrega no máximo 500 e ordena no app, então precisa de paginação aqui), 29 ajuste de linguagem técnica, 30 exportar PDF ou Word.
5. **Fase 6 (comercial):** 31 landing page (use a skill de design de landing, não o design system do app), 32 lista de early access, 33 planos e cobrança, 53 monitoramento e alertas.
6. **Antes do deploy:** 56 hardening de infraestrutura (TLS no banco, banco em rede privada, firewall, backups cifrados com restauração testada; a credencial `notta_owner` precisa ficar fora do app, porque quem a tem consegue desligar trigger ou usar o desvio de limpeza), 43 CI (o dono pediu deixar por último: testes, lint, `npm audit` e testes de RLS obrigatórios antes de merge), 55 teste de invasão externo e checklist OWASP ASVS.
7. **Fase 7 (áudio, documentos formais, bucket externo, mais de um provedor de IA; link do paciente, resumo semanal e alerta de risco foram para a Fase 8):** fora do escopo atual.
8. **Fase 8, pedidos de uma psicóloga (itens 34 a 36 e 68 a 78 de `docs/FEATURES.md`):** a decisão do dono já tomada é usar Google Agenda e Google Meet para agenda e vídeo (itens 71 e 72); a proposta de três planos (Individual, Plus e Premium) está no fim de `docs/FEATURES.md` como rascunho, sem decisão final.

## 7. Decisões abertas do dono (pergunte, não decida)

- **MFA (item 47):** TOTP ou código por e-mail. Recomendação: código por e-mail, por simplicidade, depois do item 24.
- **Plano pago do Gemini:** obrigatório antes de qualquer dado real passar pela IA. A IA em produção só liga depois disso (`NOTTA_IA_HABILITADA`).
- **Texto digitado e ainda não salvo no celular (item 21):** salvar automaticamente no servidor a cada poucos segundos, sem nada no navegador (recomendado, preserva o sigilo), ou guardar cópia local (não perde texto, mas deixa dado clínico em claro no aparelho).
- **Exclusão LGPD (item 26):** hoje psicólogo com trilha, paciente com consentimento ou documento e documento com correção têm FK `RESTRICT`, e a trilha e o consentimento são somente-acrescentar. Excluir de verdade exige decidir o que acontece com a trilha e como anonimizar ou apagar.
- **Item 67:** quem autoriza a transferência de pacientes e como fica o registro.
- **Termo de consentimento definitivo (item 22):** texto e forma de o paciente assinar.
- **Reativação de psicólogo desativado** e liberação do e-mail dele (hoje o e-mail continua ocupado).

## 8. Como implementar sem quebrar o que existe

- **Tabela nova com dado de paciente:** siga o padrão de `docs/ACESSO.md` (colunas `clinicaId` e `psicologoId`, FK composta incluindo o dono, RLS ENABLE + FORCE com `psicologo_proprio`, grants mínimos por coluna, sem DELETE se não precisar). O teste de acesso lê o SQL do doc. Se a tabela for histórico, copie o padrão append-only (policies separadas, trigger que barra UPDATE e DELETE, desvio `app.limpeza_de_teste` só para o dono e só DELETE) e acrescente a limpeza dela em `backend/test/acesso-owner.ts` (`apagarClinicas`).
- **Dado cifrado:** gere o `id` no app antes do INSERT, cifre com `aadDe(...)` incluindo o id e o psicólogo, nunca devolva coluna `*Cifrado`. Teste que copiar o cifrado de uma linha para outra faz a leitura falhar.
- **Rotas:** `runComoUsuario` para tudo que for dado do psicólogo; auditoria na MESMA transação; 404 idêntico para recurso alheio e inexistente; nunca I/O de rede dentro de `runComoUsuario`; rota nova com senha provisória fica bloqueada até ganhar `@PermiteSenhaProvisoria()`, e nunca marque rota de dado clínico.
- **Limites do app:** teto de 5 requisições simultâneas e 300 por minuto por psicólogo (429). Tela nova não pode disparar mais que 5 chamadas ao mesmo tempo (prefira sequência).
- **Migrations:** sempre como `notta_owner`; `prisma migrate diff` deve ficar limpo; confira o checksum das migrations aplicadas.
- **Testes:** teste primeiro; teste de RLS precisa provar leitura SEM contexto igual a ZERO linhas; para itens de auth, RLS e criptografia faça mutação (remover a proteção e ver um teste cair) antes de dizer pronto.
- **Front:** use os componentes de `frontend/src/app/ui`, os tokens do design system, textos em português com acentos e caixa de frase, sem emoji, acessível (label em todo campo, erro ligado ao campo, foco no primeiro erro, status com texto), `spellcheck="false"` e `autocomplete="off"` em campos de texto clínico, nada de `innerHTML`, e nada de dado de paciente em console, URL, `localStorage`, `sessionStorage`, `history.state` ou router state (só ids).

## 9. Riscos e limites conhecidos (não esconda)

- Um anonimizador por regras tem falsos negativos (nome de terceiro, endereço sem número, data por extenso, CPF inválido sem pontuação). A prévia obrigatória do psicólogo é a rede de segurança.
- Quem tem a credencial `notta_owner` consegue contornar triggers de imutabilidade. Só o item 56 fecha.
- O risco I-1 (o ADMIN define a senha provisória do colega e pode ativar a conta antes dele) foi aceito pelo dono e está documentado; o item 65 o fecha.
- O teste de carga `carga-clinicas` é sensível à máquina e já falhou uma vez numa primeira rodada fria; ele roda no grupo serial.
- O cliente do SelahIA nunca falou com o SelahIA real.
- Nunca foi validado com leitor de tela, nem com IPv6 e proxy reversos de produção.
- Passos pesados e destrutivos (apagar volume do Docker, mexer nos papéis do cluster, `pkill -f`) já foram bloqueados antes; não tente contornar.

## 10. Como se comunicar com o dono

Português, direto, curto. Ele tem TDAH: passos pequenos, uma coisa por vez, explique o porquê, dê uma recomendação clara em vez de só opções. Toda resposta termina com três blocos nesta ordem: **Lista** (as funcionalidades planejadas que ainda faltam, numeradas, uma linha cada), **Recomendação** (com o porquê em uma frase) e **Próximo passo** (um só). Quando mandar imagens ou prints, mande-os de forma que ele consiga ver no celular (ele costuma acompanhar remotamente).
