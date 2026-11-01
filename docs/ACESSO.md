# Regras de acesso entre psicologos

Decisao do dono (2026-10-30): **cada psicologo ve so os proprios pacientes e documentos. Ninguem le prontuario de colega, nem o ADMIN.**

## Quem pode o que

| Acao | ADMIN | PSICOLOGO | Sem login |
|---|---|---|---|
| Cadastrar clinica (`POST /clinicas`), login, `/saude` | sim | sim | sim (rotas publicas) |
| Ver os proprios dados (`GET /eu`) | sim | sim | nao (401) |
| Trocar a PROPRIA senha (`POST /auth/trocar-senha`, item 57) | sim | sim | nao (401) |
| Qualquer outra rota com senha PROVISORIA (colega recem-criado, item 62) | n/a | **nao (403 "Troca de senha obrigatoria")** | nao (401) |
| Gerenciar equipe: criar e listar psicologos (`POST/GET /psicologos`, item 8) | sim | nao (403) | nao (401) |
| Atender e ler os PROPRIOS pacientes/documentos (Fase 2) | sim | sim | nao (401) |
| Ler paciente/documento de COLEGA | **nao** | **nao** | nao |

- ADMIN = quem cadastrou a clinica. Ele gerencia a equipe e tambem atende como qualquer psicologo (clinica solo). O papel NAO abre prontuario alheio.
- O papel e lido do banco a cada requisicao (nao vai no token): rebaixar alguem vale na hora.
- 403 de papel e sempre generico (`Forbidden resource`): nunca diz qual papel faltou.
- **Senha provisoria (item 62):** o colega criado pelo ADMIN (`POST /psicologos`) nasce com `senhaProvisoria = true`. Ate trocar a senha, TODA rota autenticada responde 403 `Troca de senha obrigatoria`, salvo `GET /eu` e `POST /auth/trocar-senha`. A troca incrementa `tokenVersao` (claim `tv` do JWT): os tokens antigos viram 401 e a senha que o ADMIN conhecia deixa de logar. **Limite real (I-1 da 2a revisao):** quem define a senha provisoria e o ADMIN, entao ele pode ativar a conta ANTES do colega (loga, troca a senha e fica com a conta). So um canal separado, o convite por e-mail de uso unico (itens 24 e 65), faz o ADMIN nunca ter a credencial. Ate la e risco aceito e detectavel: o colega nao consegue entrar com a senha que recebeu.
- **Rota nova e bloqueada enquanto a senha for provisoria** ate ter `@PermiteSenhaProvisoria()` (falha fechada, `JwtAuthGuard`). So marque rota que o colega PRECISA antes de trocar a senha; nunca rota de dado clinico.
- A tabela `Psicologo` usa policies por clinica para SELECT e INSERT (`tenant_isolation_*`), nao `psicologo_proprio`: o ADMIN lista nome, e-mail, papel e abordagem dos colegas (nunca `senhaHash`). Isso nao abre prontuario: paciente/documento seguem o padrao abaixo.
- **Barreiras no banco em `Psicologo` e `Clinica` (M-2 da 2a revisao, migration `20261031210000_barreiras_psicologo_clinica`):** o INSERT so aceita colega (`PSICOLOGO`, senha provisoria, `tokenVersao` 0) ou o 1o ADMIN da clinica (sem outro psicologo, senha definitiva, versao 0); o `notta_app` nao tem DELETE em `Psicologo` nem UPDATE/DELETE em `Clinica`; o trigger `psicologo_barreira_update` so deixa `senhaProvisoria` ir de true para false junto com nova `senhaHash`, e `tokenVersao` so subir 1 e junto com nova `senhaHash`. O app nao desliga o trigger (nao e dono, sem TRIGGER). `lo_create` e revogado fora da migration, por superuser: `backend/prisma/bootstrap/endurecer-banco.sql`.
- UPDATE em `Psicologo` so na PROPRIA linha (policy `psicologo_update_proprio`: clinica E `id = app.current_psicologo_id`, entao use `runComoUsuario`) e so nas colunas `nome`, `abordagemPadrao`, `senhaHash`, `senhaProvisoria` e `tokenVersao`. `papel`, `email`, `clinicaId` e `id` sao imutaveis para o `notta_app` (permission denied). Coluna nova editavel pelo app: `GRANT UPDATE (coluna)` explicito na migration.

## Como proteger uma rota por papel

```ts
import { Papeis } from '../auth/papeis';

@Papeis('ADMIN') // na classe vale para todas as rotas; no metodo, o metodo vence
@Get()
listarEquipe() { ... }
```

- Sem `@Papeis` = qualquer usuario autenticado. Toda rota ja exige JWT (guard global), salvo `@Publico()`.
- Ordem dos guards globais: `JwtAuthGuard` (401) e depois `PapeisGuard` (403). Sem token = 401, nunca 403.
- `@Papeis` NAO isola dados. Quem isola prontuario e o banco (abaixo). Papel e so para acoes de gestao.

## PADRAO obrigatorio para toda tabela clinica (Fases 2 e 3)

Vale para paciente, sessao, documento, anotacao e qualquer tabela com dado de um paciente.

1. **Colunas** `clinicaId` e `psicologoId` (texto, NOT NULL), com FK composta para o dono:
   ```sql
   FOREIGN KEY ("psicologoId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId")
   ```
   No Prisma: `psicologo Psicologo @relation(fields: [psicologoId, clinicaId], references: [id, clinicaId])` e `@@index([clinicaId, psicologoId])`.

   **Tabela filha de outra tabela clinica** (ex.: `Sessao` de um `Paciente`): a FK para o pai INCLUI o dono. No pai: `@@unique([id, psicologoId, clinicaId])`. Na filha (copie e troque os nomes):

   <!-- sql-fk-filha:inicio -->
   ```sql
   ALTER TABLE "Sessao" ADD CONSTRAINT "Sessao_pacienteId_psicologoId_clinicaId_fkey" FOREIGN KEY ("pacienteId", "psicologoId", "clinicaId") REFERENCES "Paciente"("id", "psicologoId", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE
   ```
   <!-- sql-fk-filha:fim -->

   No Prisma: `paciente Paciente @relation(fields: [pacienteId, psicologoId, clinicaId], references: [id, psicologoId, clinicaId], onDelete: Restrict)`.

   Por que: **a checagem de FK ignora RLS.** Com a FK so `("pacienteId", "clinicaId")`, um colega da mesma clinica (que ve ZERO pacientes alheios) ainda consegue gravar uma sessao apontando para o paciente de outro psicologo, e o erro de FK para um id inexistente vira oraculo de existencia (descobre que o id existe). Com o dono na FK, e o WITH CHECK obrigando `psicologoId` = o proprio, so existe chave valida se o pai for SEU: pai alheio e pai inexistente dao o MESMO erro.

   **Proibido `ON DELETE CASCADE`** entre tabelas clinicas: o cascade tambem ignora RLS. Use RESTRICT: apagar o pai com filhas falha, e cada tabela apaga as proprias linhas, sob a propria policy. Esse bloco e o que `backend/test/acesso.e2e-spec.ts` aplica e testa (o teste le daqui).
2. **RLS FORCE com a policy `psicologo_proprio`** na migration (copie e troque `"MinhaTabela"`):

   <!-- sql-psicologo-proprio:inicio -->
   ```sql
   ALTER TABLE "MinhaTabela" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "MinhaTabela" FORCE ROW LEVEL SECURITY;
   CREATE POLICY psicologo_proprio ON "MinhaTabela"
     USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
     WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));
   ```
   <!-- sql-psicologo-proprio:fim -->

   **NAO** crie tambem a policy `tenant_isolation` nessa tabela: policies permissivas se somam com OU, e a de clinica abriria os dados para todo colega. Esse bloco e o mesmo que `backend/test/acesso.e2e-spec.ts` aplica e testa (o teste le daqui).
3. **No codigo**, todo `where` filtra `clinicaId` E `psicologoId` (duas camadas: codigo e banco), os dois vindos do token (`@UsuarioAtual()`), nunca do corpo.
4. **Sempre** `tenant.runComoUsuario(user, (tx) => ...)`. `run(clinicaId, ...)` sem `psicologoId` devolve ZERO linhas nessas tabelas (falha fechada, nao erro).
5. Migration de DADOS nessas tabelas: com FORCE, sem contexto atualiza 0 linhas. Faca laco por clinica e psicologo com `set_config`.

## Tabelas clinicas que ja existem

| Tabela | Policy | Cifrado em repouso (AAD = `Paciente\|<coluna>\|id\|psicologoId`) | Grants do `notta_app` |
|---|---|---|---|
| `Paciente` (item 9, migration `20261031230000_paciente`) | so `psicologo_proprio` (ENABLE + FORCE) | `nomeCifrado`, `nascimentoCifrado`, `telefoneCifrado`, `emailCifrado` (AES-256-GCM, chave por clinica; `id` gerado no app antes do INSERT porque entra no AAD) | SELECT, INSERT; UPDATE so dessas 4 colunas e `atualizadoEm`; sem DELETE (exclusao e o item 26) e sem UPDATE de `id`, `clinicaId`, `psicologoId` |
| `Auditoria` (item 11, migration `20261101120000_auditoria`) | `auditoria_insert` (WITH CHECK: clinica E psicologo do contexto) e `auditoria_select_proprio` (so as PROPRIAS linhas), ENABLE + FORCE; mais `auditoria_dono_update`/`auditoria_dono_delete` so `TO notta_owner` (ver abaixo) | nada: sem conteudo clinico | **SELECT e INSERT apenas** (sem UPDATE, DELETE, TRUNCATE) |
| `Consentimento` (item 10, migration `20261101140000_consentimento`) | so `psicologo_proprio` (ENABLE + FORCE); mais `consentimento_dono_update`/`consentimento_dono_delete` so `TO notta_owner` (mesmo motivo da `Auditoria`). Filha de `Paciente`: FK `(pacienteId, psicologoId, clinicaId)` RESTRICT | nada cifrado: so `evento` e o snapshot do termo (texto fixo do servidor, sem dado do paciente) | **SELECT e INSERT apenas** (sem UPDATE, DELETE, TRUNCATE) |

- Rotas `/pacientes` (qualquer usuario autenticado, senha provisoria = 403): o `PacientesService` e o unico lugar que cifra e decifra. Falha de decifra (ex.: texto cifrado copiado para outra linha) = 500 generico, sem o texto no log. Sem CPF nem endereco (decisao do dono); o item 50 cobre o que vier depois.
- Limpeza em teste: o `notta_app` nao apaga `Paciente`; `apagarClinicas` (`test/acesso-owner.ts`) apaga como `notta_owner`, um psicologo por vez (a policy exige o dono no contexto) e so depois o `Psicologo`.

## Trilha de auditoria (item 11)

Registra **quem** (`psicologoId`), **o que** (`acao`: `CRIOU`, `LEU`, `LISTOU`, `EDITOU`, `CONCEDEU`, `REVOGOU`), **em que recurso** (`recurso` = `Paciente` ou `Consentimento`, `recursoId`) e **quando** (`criadoEm`), por tempo indefinido. Decisao do dono (2026-11-01).

- **O que NAO registra:** nome, e-mail, telefone, nascimento, valor de campo, texto clinico, IP, user-agent. So ids e constantes. `LISTOU` nao tem `recursoId`. 404, 400 e 401 nao gravam (nao houve acesso). `recursoId` nao tem FK: a trilha sobrevive ao recurso.
- **Como grava:** `AuditoriaService.registrar(tx, user, acao, recurso, recursoId?)` (`backend/src/auditoria/`), SEMPRE na mesma transacao (`runComoUsuario`) da acao. Se a trilha falhar, a acao inteira desfaz e a rota responde 500 (falha fechada). Sem fila. Rota clinica nova: chame `registrar` dentro do mesmo `runComoUsuario` e acrescente a constante em `ACOES`/`RECURSOS`.
- **Somente-acrescentar (3 camadas):** (1) o `notta_app` so tem `SELECT` e `INSERT`; (2) RLS FORCE: INSERT so com clinica e psicologo do contexto, SELECT so das proprias linhas (colega e ADMIN veem zero do alheio; leitura pela clinica e item futuro, nao ha rota); (3) trigger `auditoria_somente_acrescentar` levanta excecao em UPDATE, DELETE e TRUNCATE, ate para o `notta_owner`.
- **Policies do dono (`auditoria_dono_update`/`_delete`, so `TO notta_owner`, so da clinica do contexto):** existem so para o trigger poder disparar. Sem policy o FORCE RLS faria o UPDATE/DELETE do dono afetar 0 linhas em silencio. A barreira e o trigger.
- **Desvio unico (limpeza das suites):** o trigger deixa passar `DELETE` quando quem executa e o DONO da tabela E a transacao tem `set_config('app.limpeza_de_teste', '1', true)`. Uso: `apagarClinicas` em `test/acesso-owner.ts` (a FK `Auditoria -> Psicologo` e RESTRICT, entao apagar o psicologo exige apagar a trilha antes). O `notta_app` nunca usa: nao e dono e nao tem DELETE (teste prova com o desvio ligado). UPDATE e TRUNCATE nao tem desvio. Em producao nao ha rotina que ligue o desvio; apagar trilha so a mao, como dono, de proposito.
- **Consequencia da FK RESTRICT:** psicologo com trilha nao pode ser apagado (nem pelo dono) sem antes apagar a trilha com o desvio. O item de exclusao/LGPD (26) precisa decidir isso.
- Testes: `test/auditoria-rls.e2e-spec.ts` (banco) e `test/auditoria.e2e-spec.ts` (HTTP + atomicidade).

## Consentimento do paciente (item 10)

Decisao do dono (2026-11-01): consentimento POR PACIENTE; cada evento e uma linha NOVA (`CONCEDIDO`, `REVOGADO`, `CONCEDIDO` de novo); nada e sobrescrito nem apagado. Revogado bloqueia NOVOS documentos mas nao apaga os antigos. Quem registra e o psicologo (o termo assinado pelo paciente e o item 22; ate la o termo e **PROVISORIO**: constante `TERMO_V1` em `backend/src/consentimento/termo.ts`, placeholder).

- **Estado** = `evento` da maior `seq` do paciente (sem linhas = `NENHUM`). Transicoes: `NENHUM|REVOGADO -> CONCEDIDO` e `CONCEDIDO -> REVOGADO`; qualquer outra = 409 `Transicao invalida`.
- **Rotas** (qualquer autenticado, senha provisoria = 403): `GET /pacientes/:id/consentimento` (200 `{estado, desde, historico:[{seq, evento, termoVersao, em}]}`, audita `LEU`), `POST /pacientes/:id/consentimento` body `{evento}` (201 com o mesmo corpo; audita `CONCEDEU` ou `REVOGOU`). Paciente alheio ou inexistente = 404 igual. `GET /pacientes` e `GET /pacientes/:id` trazem `consentimento` (a lista usa UMA consulta para todos).
- **Termo e snapshot:** `termoVersao`/`termoTexto` vem do servidor (nunca do corpo; campo extra = 400) e ficam gravados em cada linha. No `REVOGADO` repete-se a versao/texto do ultimo `CONCEDIDO`.
- **Concorrencia sem lock:** `UNIQUE (pacienteId, psicologoId, seq)`. Dois POST simultaneos calculam a mesma `seq`; o 2o recebe unique violation (P2002) e vira 409. O dono entra no unique de proposito: sem ele, o erro de unique (que ignora RLS) seria oraculo de existencia de paciente alheio via SQL direto (a FK ja garante 1 dono por paciente, entao a restricao e equivalente).
- **Somente-acrescentar (mesmas 3 camadas da `Auditoria`):** `notta_app` so SELECT/INSERT; RLS FORCE `psicologo_proprio`; trigger `consentimento_somente_acrescentar` barra UPDATE, DELETE e TRUNCATE ate para o dono, com o MESMO desvio de limpeza de teste (`app.limpeza_de_teste = '1'`, so o dono da tabela, so DELETE). `apagarClinicas` apaga `Consentimento` antes de `Paciente`. CHECK no banco: `evento IN ('CONCEDIDO','REVOGADO')` e `seq >= 1`.
- **Consequencia da FK RESTRICT:** paciente com consentimento nao pode ser apagado (nem pelo dono) sem antes apagar as linhas com o desvio. O item 26 (exclusao/LGPD) precisa decidir isso.
- **`ConsentimentoService.exigirConcedido(tx, user, pacienteId)`:** lanca 403 `Consentimento nao concedido` se o estado nao for `CONCEDIDO`. O item 12 (gerar documento) deve chamar DENTRO da mesma transacao antes de gerar. Ainda sem chamador de producao.
- Testes: `test/consentimento-rls.e2e-spec.ts` (banco), `test/consentimento.e2e-spec.ts` (HTTP) e `src/consentimento/consentimento.service.spec.ts` (maquina de estados).

## Checklist de revisao (Fase 2, cada tabela nova)

- [ ] Tem `clinicaId` e `psicologoId` NOT NULL, FK composta `(psicologoId, clinicaId) -> Psicologo(id, clinicaId)`.
- [ ] Tabela filha de outra tabela clinica: FK `(paiId, psicologoId, clinicaId) -> Pai(id, psicologoId, clinicaId)` (bloco `sql-fk-filha` deste arquivo) e `@@unique([id, psicologoId, clinicaId])` no pai. Nenhuma FK entre tabelas clinicas sem `psicologoId`.
- [ ] Nenhum `ON DELETE CASCADE` entre tabelas clinicas (`SELECT conname FROM pg_constraint WHERE confdeltype = 'c'` nao lista FK delas).
- [ ] Migration tem ENABLE + FORCE e a policy `psicologo_proprio` copiada deste arquivo, com USING e WITH CHECK.
- [ ] Nenhuma outra policy permissiva na tabela (`SELECT policyname FROM pg_policies WHERE tablename = '...'` mostra so `psicologo_proprio`).
- [ ] Todo acesso passa por `runComoUsuario`; nenhum `run` sem `psicologoId` nessa tabela.
- [ ] Todo `where` tem `clinicaId` e `psicologoId` do token.
- [ ] Teste de integracao (Postgres real) prova: colega da mesma clinica (inclusive ADMIN) ve ZERO; sem `psicologoId` = zero; outra clinica = zero; INSERT com `psicologoId` alheio falha; UPDATE/DELETE de linha alheia afeta 0; filha apontando para pai de colega falha com o mesmo erro de pai inexistente.
- [ ] Teste unitario do service com banco falso SEM RLS prova o filtro por `psicologoId` no `where`.
