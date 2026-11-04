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
| Desativar um colega (`POST /psicologos/:id/desativar`, item 58) | sim (so PSICOLOGO ativo, nunca a si nem outro ADMIN) | nao (403) | nao (401) |
| Atender e ler os PROPRIOS pacientes/documentos (Fase 2) | sim | sim | nao (401) |
| Ler paciente/documento de COLEGA | **nao** | **nao** | nao |

- ADMIN = quem cadastrou a clinica. Ele gerencia a equipe e tambem atende como qualquer psicologo (clinica solo). O papel NAO abre prontuario alheio.
- O papel e lido do banco a cada requisicao (nao vai no token): rebaixar alguem vale na hora.
- 403 de papel e sempre generico (`Forbidden resource`): nunca diz qual papel faltou.
- **Senha provisoria (item 62):** o colega criado pelo ADMIN (`POST /psicologos`) nasce com `senhaProvisoria = true`. Ate trocar a senha, TODA rota autenticada responde 403 `Troca de senha obrigatoria`, salvo `GET /eu` e `POST /auth/trocar-senha`. A troca incrementa `tokenVersao` (claim `tv` do JWT): os tokens antigos viram 401 e a senha que o ADMIN conhecia deixa de logar. **Limite real (I-1 da 2a revisao):** quem define a senha provisoria e o ADMIN, entao ele pode ativar a conta ANTES do colega (loga, troca a senha e fica com a conta). So um canal separado, o convite por e-mail de uso unico (itens 24 e 65), faz o ADMIN nunca ter a credencial. Ate la e risco aceito e detectavel: o colega nao consegue entrar com a senha que recebeu.
- **Rota nova e bloqueada enquanto a senha for provisoria** ate ter `@PermiteSenhaProvisoria()` (falha fechada, `JwtAuthGuard`). So marque rota que o colega PRECISA antes de trocar a senha; nunca rota de dado clinico.
- A tabela `Psicologo` usa policies por clinica para SELECT e INSERT (`tenant_isolation_*`), nao `psicologo_proprio`: o ADMIN lista nome, e-mail, papel e abordagem dos colegas (nunca `senhaHash`). Isso nao abre prontuario: paciente/documento seguem o padrao abaixo.
- **Barreiras no banco em `Psicologo` e `Clinica` (M-2 da 2a revisao, migration `20261031210000_barreiras_psicologo_clinica`):** o INSERT so aceita colega (`PSICOLOGO`, senha provisoria, `tokenVersao` 0) ou o 1o ADMIN da clinica (sem outro psicologo, senha definitiva, versao 0); o `notta_app` nao tem DELETE em `Psicologo` nem UPDATE/DELETE em `Clinica`; o trigger `psicologo_barreira_update` so deixa `senhaProvisoria` ir de true para false junto com nova `senhaHash`, e `tokenVersao` so subir 1 e junto com nova `senhaHash`. O app nao desliga o trigger (nao e dono, sem TRIGGER). `lo_create` e revogado fora da migration, por superuser: `backend/prisma/bootstrap/endurecer-banco.sql`.
- **Desativar psicologo (item 58, migration `20261105120000_psicologo_desativar`).** Decisao do dono (2026-11-04): o ADMIN desativa um colega; o colega NAO entra mais; pacientes, documentos, consentimentos e trilha dele FICAM guardados, sem leitura por ninguem; reativar nao existe (nem pelo dono do banco); transferir pacientes fica fora desta etapa.
  - **Colunas:** `ativo` (default true) e `desativadoEm`, com CHECK `(ativo = false) = (desativadoEm IS NOT NULL)`.
  - **Quem desativa:** policy de UPDATE `psicologo_desativar_colega` (permissiva, soma com `psicologo_update_proprio`): o ator (`app.current_psicologo_id`, entao use `runComoUsuario`) e ADMIN ATIVO da mesma clinica; o alvo e OUTRA pessoa (`id <>` ator), `papel = 'PSICOLOGO'` e `ativo`; o WITH CHECK exige o alvo `ativo = false`. ADMIN nao desativa ADMIN nem a si mesmo; colega nao desativa ninguem; outra clinica = 0 linhas.
  - **Trigger `psicologo_barreira_update` (estendido):** `ativo`/`desativadoEm` so vao de true/NULL para false/data e NUNCA voltam (vale para o dono tambem); ninguem muda o PROPRIO `ativo`; na linha de OUTRA pessoa so `ativo`/`desativadoEm` mudam (o ADMIN nao troca nome, abordagem, senha nem versao do token do colega). `papel`, `email` e `clinicaId` seguem sem UPDATE para o app (permission denied). INSERT ja desativado e barrado (`tenant_isolation_insert` exige `ativo`).
  - **Efeito imediato:** `JwtAuthGuard` e `AuthService.login` leem `ativo`; desativado = 401 igual ao de usuario inexistente (login com o mesmo tempo de bcrypt). O token cai na proxima requisicao, sem esperar expirar.
  - **Rota:** `POST /psicologos/:id/desativar` (`@Papeis('ADMIN')`, sem corpo, id uuid): 200 `{id, nome, email, papel, abordagemPadrao, ativo: false, desativadoEm}`; 409 `Psicologo ja desativado`; 409 `Nao e possivel desativar este usuario` (a si mesmo ou outro ADMIN); 404 igual para outra clinica e id inexistente. UPDATE atomico (`WHERE ativo = true AND papel = 'PSICOLOGO'`) + auditoria `DESATIVOU` (recurso `Psicologo`) na MESMA transacao.
  - **Lista:** `GET /psicologos` (e o 201 de `POST /psicologos`) trazem `ativo` e `desativadoEm`; desativados continuam na lista.
  - **E-mail ocupado:** o e-mail do desativado continua unico global: criar colega novo com ele = 409 `E-mail ja cadastrado`. Liberar e-mail e item futuro (junto com reativacao ou exclusao/LGPD, item 26).
  - **O que fica guardado:** a linha de `Psicologo` (nao ha DELETE), `Paciente`, `Documento`, `Consentimento` e `Auditoria` do desativado, intactos e cifrados como antes. Ninguem le: a RLS `psicologo_proprio` so abre para o proprio dono, que nao loga mais; o ADMIN recebe 404 igual ao de colega.
  - **Consequencia:** o ADMIN nao tem como recuperar a conta nem passar os pacientes a outro colega nesta versao.
- UPDATE em `Psicologo` na PROPRIA linha (policy `psicologo_update_proprio`: clinica E `id = app.current_psicologo_id`, entao use `runComoUsuario`) e so nas colunas `nome`, `abordagemPadrao`, `senhaHash`, `senhaProvisoria` e `tokenVersao` (mais `ativo`/`desativadoEm`, que o trigger barra na propria linha). `papel`, `email`, `clinicaId` e `id` sao imutaveis para o `notta_app` (permission denied). Coluna nova editavel pelo app: `GRANT UPDATE (coluna)` explicito na migration.

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
| `Documento` (item 12, migration `20261103120000_documento`; itens 14, 15 e 44, migration `20261104120000_documento_editar_aprovar_imutavel`) | policies SEPARADAS (ENABLE + FORCE): `documento_select_proprio`, `documento_insert_proprio` (proprio E `status = 'RASCUNHO'` E `aprovadoEm IS NULL`: ninguem insere ja aprovado), `documento_update_proprio` (proprio); mais `documento_dono_update`/`documento_dono_delete` so `TO notta_owner` (para o trigger poder disparar). A `psicologo_proprio` do item 12 foi removida. Filha de `Paciente`: FK `(pacienteId, psicologoId, clinicaId)` RESTRICT; correcao: FK `(substituiId, pacienteId, psicologoId, clinicaId)` -> `Documento` RESTRICT. CHECKs: `tipo`, `status`, `(status = 'APROVADO') = (aprovadoEm IS NOT NULL)`, `substituiId <> id` | `conteudoCifrado` (AAD = `Documento\|conteudoCifrado\|id\|psicologoId`; `id` gerado no app). `dataSessao` fica em claro (metadado de linha do tempo) | **SELECT e INSERT**; UPDATE so em `conteudoCifrado`, `dataSessao`, `status`, `aprovadoEm`, `atualizadoEm`; sem DELETE, sem TRUNCATE |

- Rotas `/pacientes` (qualquer usuario autenticado, senha provisoria = 403): o `PacientesService` e o unico lugar que cifra e decifra. Falha de decifra (ex.: texto cifrado copiado para outra linha) = 500 generico, sem o texto no log. Sem CPF nem endereco (decisao do dono); o item 50 cobre o que vier depois.
- Limpeza em teste: o `notta_app` nao apaga `Paciente` nem `Documento`; `apagarClinicas` (`test/acesso-owner.ts`) apaga como `notta_owner`, um psicologo por vez (a policy exige o dono no contexto) e so depois o `Psicologo`.

## Trilha de auditoria (item 11)

Registra **quem** (`psicologoId`), **o que** (`acao`: `CRIOU`, `LEU`, `LISTOU`, `EDITOU`, `APROVOU`, `CONCEDEU`, `REVOGOU`, `DESATIVOU`), **em que recurso** (`recurso` = `Paciente`, `Consentimento`, `Documento` ou `Psicologo`, `recursoId`) e **quando** (`criadoEm`), por tempo indefinido. Decisao do dono (2026-11-01).

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
- **`ConsentimentoService.exigirConcedido(tx, user, pacienteId)`:** lanca 403 `Consentimento nao concedido` se o estado nao for `CONCEDIDO`. O `DocumentosService.criar` (item 12) chama DENTRO da mesma transacao, depois de provar que o paciente e do usuario (404 antes de 403).
- Testes: `test/consentimento-rls.e2e-spec.ts` (banco), `test/consentimento.e2e-spec.ts` (HTTP) e `src/consentimento/consentimento.service.spec.ts` (maquina de estados).

## Documento clinico (item 12)

Decisao do dono (2026-11-03): UMA tabela `Documento` com tres tipos (`NOTA_BRUTA`, `EVOLUCAO`, `ANAMNESE`); campos paciente, data da sessao (opcional) e texto livre ate 20 mil caracteres. Nasce `RASCUNHO`. Fora desta etapa: secoes estruturadas e IA (Fase 3). Edicao, aprovacao e imutavel: secao seguinte.

- **Rotas** (`backend/src/documentos/`, qualquer autenticado, senha provisoria = 403), aninhadas em `/pacientes/:pacienteId/documentos`: `POST` body `{tipo, dataSessao?: 'YYYY-MM-DD', conteudo}` (201 com o documento e o `conteudo` decifrado), `GET` (so metadados `[{id, tipo, dataSessao, status, criadoEm}]`, mais novo primeiro, take 200, nada e decifrado) e `GET /:id` (corpo completo, decifrado). **Nao existe DELETE** (o PATCH veio no item 14). Resposta nunca traz `conteudoCifrado`.
- **Ordem de erros do POST:** 400 validacao; 404 paciente que nao e seu (alheio = inexistente, antes do 403 para nao revelar que existe); 403 `Consentimento nao concedido` (`exigirConcedido`, na mesma transacao); 401. Consentimento REVOGADO bloqueia so a CRIACAO: ler e listar o que ja existe continua 200.
- **404 igual no GET `:id`:** documento de colega, de outra clinica, de outro paciente seu na URL errada e inexistente respondem o mesmo `Documento nao encontrado` (uma consulta so, sem oraculo).
- **Texto:** `conteudo` 1..20000 caracteres, NAO e aparado (so rejeita vazio ou so espacos). Cifrado no `DocumentosService`, o unico lugar que cifra e decifra; falha de decifra (ex.: cifrado copiado para outro documento, o AAD tem o `id`) = 500 generico, log so com o nome do erro.
- **Auditoria** (mesma transacao): `CRIOU` (recursoId = id do documento), `LISTOU` (recursoId = id do paciente), `LEU` (recursoId = id do documento, so quando achou). A linha nao contem texto do documento.
- **Item 15 (aprovar):** feito (secao abaixo). A policy unica `psicologo_proprio` foi trocada por policies separadas, porque o `WITH CHECK ... status = 'RASCUNHO'` dela tambem valia para UPDATE e impedia aprovar.
- Testes: `test/documentos-rls.e2e-spec.ts` (banco), `test/documentos.e2e-spec.ts` (HTTP + auditoria + atomicidade) e `src/documentos/documentos.service.spec.ts`.

## Editar, aprovar e corrigir documento (itens 14, 15 e 44)

Decisao do dono (2026-11-04): **aprovar e irreversivel.** Aprovado nao edita nem apaga; correcao = NOVO documento (rascunho) ligado ao anterior. So quem criou aprova (a RLS ja garante: documento e do psicologo). A trilha grava quem aprovou e quando (`APROVOU`, `criadoEm`).

- **Rotas** (`backend/src/documentos/`, todas `runComoUsuario`, auditoria na MESMA transacao, 404 generico igual para alheio/inexistente/paciente errado na URL):
  - `PATCH /pacientes/:pacienteId/documentos/:id` body parcial `{conteudo?, dataSessao?: 'YYYY-MM-DD'|null}`. Corpo vazio, `tipo` ou qualquer campo extra = 400; `conteudo: null` = 400; `dataSessao: null` apaga a data. Atomico: `updateMany ... status = 'RASCUNHO'`; 0 linhas -> relê: APROVADO = 409 `Documento aprovado nao pode ser editado`, senao 404. Recifra com o MESMO AAD. 200 com o documento completo. Auditoria `EDITOU`. Vale com consentimento revogado.
  - `POST .../:id/aprovar` sem corpo: atomico (`status = 'RASCUNHO'` no WHERE), 200 com `status: 'APROVADO'` e `aprovadoEm`; ja aprovado = 409 `Documento ja aprovado`. Auditoria `APROVOU`. Vale com consentimento revogado (o documento nasceu sob consentimento).
  - `POST .../documentos` ganha `substituiId?: uuid`: o documento tem que existir, ser do mesmo paciente e do mesmo psicologo e estar APROVADO (rascunho = 409 `So documento aprovado pode ser corrigido`; inexistente, alheio ou de outro paciente = 404 igual). Continua exigindo consentimento CONCEDIDO (o 403 vem antes da checagem de `substituiId`).
  - `GET .../documentos` aceita `?status=RASCUNHO|APROVADO` (outro valor, repetido ou parametro desconhecido = 400). Lista e `GET /:id` trazem `aprovadoEm` e `substituiId`.
- **Regra de correcao:** nao existe editar aprovado nem desaprovar. Para corrigir, `POST` com `substituiId` do aprovado cria um rascunho novo (com o texto que o psicologo quiser); ele edita e aprova como qualquer rascunho. O aprovado original fica intacto e legivel. Varias correcoes do mesmo aprovado sao permitidas; uma correcao pode ser aprovada e corrigida de novo (cadeia).
- **Trigger `documento_imutavel` (item 44, vale para TODOS os papeis, o dono da tabela inclusive):** UPDATE com `OLD.status = 'APROVADO'` = excecao sempre (nem `atualizadoEm` muda). RASCUNHO -> APROVADO so com `aprovadoEm` preenchido e `conteudoCifrado`/`dataSessao` iguais. RASCUNHO -> RASCUNHO nao muda `id`, `clinicaId`, `psicologoId`, `pacienteId`, `tipo`, `substituiId` nem `aprovadoEm`. DELETE de APROVADO = excecao sempre; unico desvio: o DONO da tabela com `set_config('app.limpeza_de_teste', '1', true)` (so a limpeza das suites, como nas outras tabelas). DELETE de rascunho nao tem barreira no trigger: o `notta_app` nao tem o privilegio. TRUNCATE barrado sempre.
- **Camadas:** (1) o `notta_app` tem UPDATE so em 5 colunas e nenhum DELETE; (2) policies: INSERT so RASCUNHO sem `aprovadoEm`, UPDATE/SELECT so do proprio; (3) trigger; (4) o `WHERE status = 'RASCUNHO'` do codigo decide a corrida aprovar x editar sem SELECT antes. Policies `documento_dono_*` existem so para o trigger poder disparar para o dono (sem elas o FORCE RLS faria o UPDATE/DELETE do dono afetar 0 linhas).
- **Consequencia da FK de correcao RESTRICT:** aprovado que tem correcao nao pode ser apagado (nem pelo dono com o desvio) antes da correcao. O item 26 (exclusao/LGPD) precisa decidir; ate la, aprovado so sai pelo desvio de limpeza.
- Testes: `test/documentos-rls.e2e-spec.ts` (banco e trigger), `test/documentos-aprovacao.e2e-spec.ts` (HTTP, corrida, auditoria, atomicidade) e `src/documentos/documentos.service.spec.ts`.

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
