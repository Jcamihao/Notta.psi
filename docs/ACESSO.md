# Regras de acesso entre psicologos

Decisao do dono (2026-10-30): **cada psicologo ve so os proprios pacientes e documentos. Ninguem le prontuario de colega, nem o ADMIN.**

## Quem pode o que

| Acao | ADMIN | PSICOLOGO | Sem login |
|---|---|---|---|
| Cadastrar clinica (`POST /clinicas`, senha forte: item 45), login, renovar a sessao, `/saude` | sim | sim | sim (rotas publicas) |
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
- **Barreiras no banco em `Psicologo` e `Clinica` (M-2 da 2a revisao, migration `20261031210000_barreiras_psicologo_clinica`):** o INSERT so aceita colega (`PSICOLOGO`, senha provisoria, `tokenVersao` 0) ou o 1o ADMIN da clinica (sem outro psicologo, senha definitiva, versao 0); o `praxis_app` nao tem DELETE em `Psicologo` nem UPDATE/DELETE em `Clinica`; o trigger `psicologo_barreira_update` so deixa `senhaProvisoria` ir de true para false junto com nova `senhaHash`, e `tokenVersao` so subir 1 e junto com nova `senhaHash`. O app nao desliga o trigger (nao e dono, sem TRIGGER). `lo_create` e revogado fora da migration, por superuser: `backend/prisma/bootstrap/endurecer-banco.sql`.
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
- UPDATE em `Psicologo` na PROPRIA linha (policy `psicologo_update_proprio`: clinica E `id = app.current_psicologo_id`, entao use `runComoUsuario`) e so nas colunas `nome`, `abordagemPadrao`, `senhaHash`, `senhaProvisoria` e `tokenVersao` (mais `ativo`/`desativadoEm`, que o trigger barra na propria linha). `papel`, `email`, `clinicaId` e `id` sao imutaveis para o `praxis_app` (permission denied). Coluna nova editavel pelo app: `GRANT UPDATE (coluna)` explicito na migration.

## Sessao segura: cookie httpOnly, refresh rotativo, sessao revogavel e CSRF (itens 46 e 49, back)

Decisao do dono (2026-11-05): acesso de **15 min** que se renova sozinho; sessao maxima de **7 dias**; desconexao apos **30 min parado**; "sair de todos os aparelhos". Antes, o JWT de 8 h ficava no `sessionStorage` (um script injetado o lia). Agora o navegador so tem cookies `httpOnly`. Rotas e envs: `backend/README.md` (secao "Sessao segura"). Front: `frontend/README.md` (secao "Sessao"); cabecalhos e CSP do servidor web: `docs/SEGURANCA-HEADERS.md`.

- **Tabela `Sessao`** (migration `20261108120000_sessao`): UMA linha por geracao do refresh; `familia` = um login (todas as renovacoes dele); `id` = o `sid` do JWT. Colunas: `refreshHash` (SHA-256 hex, UNIQUE, CHECK de formato: o refresh cru NUNCA e gravado), `criadoEm`, `ultimoUsoEm`, `absolutaAte` (login + 7 dias, herdado pelas linhas rotacionadas; CHECK `absolutaAte <= criadoEm + 7 dias`), `usadoEm` (o refresh ja foi trocado), `revogadaEm` + `motivoRevogacao` (`SAIU`, `SAIU_DE_TODOS`, `REUSO`, `EXPIROU`, `SENHA_TROCADA`; par obrigatorio por CHECK). FK composta `(psicologoId, clinicaId) -> Psicologo` RESTRICT. As datas vem SEMPRE do `relogio` do app (nunca do `now()` do banco: fuso).
- **RLS ENABLE + FORCE**, policies: `sessao_select_proprio`, `sessao_insert_proprio` (so nasce ativa: nem usada nem revogada) e `sessao_update_proprio` (clinica E psicologo do contexto); `sessao_por_hash` (SELECT so da linha cujo `refreshHash` e o `app.refresh_hash` da transacao: a renovacao nao tem sessao; mesmo molde de `convite_por_token` e `login_lookup`; sem a variavel = ZERO linhas); `sessao_dono_update`/`sessao_dono_delete` so `TO praxis_owner` (para o trigger poder disparar e para a limpeza de teste). O hash NAO abre outra tabela.
- **Grants do `praxis_app`:** SELECT e INSERT; UPDATE so em `ultimoUsoEm`, `usadoEm`, `revogadaEm`, `motivoRevogacao`; sem DELETE e sem TRUNCATE (a retencao e o item 52).
- **Trigger `sessao_barreira` (BEFORE UPDATE, todos os papeis, o dono inclusive):** identidade imutavel (`id`, clinica, psicologo, `familia`, `refreshHash`, `criadoEm`, `absolutaAte`); linha revogada nao muda mais (nao revive); `usadoEm` nao volta a NULL nem muda.
- **`TenantPrismaService.runRefresh(hash, fn(tx, assumirDono))`:** unico lugar com `set_config('app.refresh_hash', ...)`. Achada a linha, `assumirDono` poe clinica e psicologo LIDOS DELA; so entao valem as policies proprias (revogar a familia, criar a linha seguinte, auditar). Mesmas regras de `run`: so banco dentro, sem rede.
- **Guard:** o JWT carrega `sid`; a MESMA transacao que ja le o psicologo confere a sessao (existe, e dele, nao revogada, `agora < absolutaAte`). Revogou = 401 na hora, nao so em 15 min. Grava `ultimoUsoEm` no maximo 1x por minuto. Aceita o cookie `praxis_acesso` OU `Authorization: Bearer` (cabecalho presente mas torto = 401, nunca cai para o cookie).
- **Renovar:** valida o hash, linha nao usada nem revogada, `agora < absolutaAte`, parado <= 30 min, psicologo ativo. `UPDATE ... WHERE usadoEm IS NULL` atomico: so UMA renovacao concorrente vence, a outra cai no REUSO. Reuso = revoga a familia (`REUSO`) + auditoria `REFRESH_REUSADO` (recurso `Sessao`, recursoId = a linha reusada) na MESMA transacao (se a auditoria falhar, 500 e nada e revogado). Expirou/ocioso = familia `EXPIROU`.
- **Sair / sair de todos / trocar senha:** ver README. Trocar senha revoga as OUTRAS familias (`SENHA_TROCADA`) na mesma transacao que muda a senha e emite so um cookie de acesso novo (mesmo `sid`, `tv` novo).
- **CSRF:** `CsrfGuard` global antes do JWT. Requisicao por cookie com metodo nao seguro: header `X-CSRF-Token` = cookie `praxis_csrf` (comparacao em tempo constante) E Origin/Referer na lista de origens (`PRAXIS_APP_URL`, `PRAXIS_CORS_ORIGIN`). `login`, cadastro de clinica e `renovar`: so Origin. Bearer e `@Publico()` do termo: fora. 403 com corpo fixo. O CSRF e uma vez por login (nao muda na renovacao).
- **Limite de tentativas:** `renovar` 30/min por IP (/64), contado antes do banco.
- **Limpeza em teste:** `apagarClinicas` apaga `Sessao` antes de `Psicologo` (FK RESTRICT); teste que apaga `Psicologo` por conta propria apaga a `Sessao` antes (como owner, com o psicologo no contexto: o DELETE tambem precisa passar pela policy de SELECT).
- **Cookies (decisao de nome):** `praxis_acesso`, `praxis_refresh`, `praxis_csrf`, sem prefixo `__Host-`/`__Secure-`. Motivo: o front le o CSRF pelo nome; o refresh precisa de `Path=/api/auth` e `__Host-` exige `Path=/`; `__Host-` exige `Secure`, e o http de desenvolvimento nao o tem. Consequencia aceita: sem o prefixo, um subdominio irmao poderia "plantar" cookie (cookie tossing); mitigacao: nao hospedar nada de terceiros em subdominio do dominio do app.
- Testes: `test/sessao-rls.e2e-spec.ts` (banco, trigger, policy por hash), `test/sessao.e2e-spec.ts` (HTTP: cookies, rotacao, reuso, ociosidade, limite, sair, sair de todos, troca de senha, CSRF, throttler), `src/auth/*.spec.ts` (guard, cookies, CSRF).

## Senha forte e residual de enumeracao de e-mail (item 45, back)

Decisao do dono (2026-11-05): sem servico externo. A checagem de senha vazada usa uma LISTA LOCAL de senhas comuns (nao consulta o Have I Been Pwned: a senha nunca sai do processo); o dono pode ligar um servico externo depois.

### Politica de senha

- **Onde vale:** ao DEFINIR ou TROCAR senha: cadastro de clinica (`POST /clinicas`), colega criado pelo ADMIN com senha provisoria (`POST /psicologos`) e nova senha em `POST /auth/trocar-senha`. **NAO vale no login:** conta antiga com senha fraca continua entrando, mas so troca para uma forte.
- **Onde esta:** funcao pura `avaliarSenha(senha, {email, nome})` e `exigirSenhaForte` em `backend/src/auth/politica-senha.ts`, chamada nos 3 services ANTES do bcrypt (e antes do e-mail unico). O DTO so confere o formato (1 a 72 BYTES, o maximo do bcrypt: 400); a regra de qualidade e 422.
- **Regras (nesta ordem; a primeira que falhar responde):**
  1. `CURTA`: menos de 10 CARACTERES (conta caracteres, nao bytes; 72 bytes continua o teto).
  2. `REPETIDA`: uma unidade de 1 a 3 caracteres repetida do comeco ao fim (`aaaaaaaaaa`, `1212121212`, `abcabcabcabc`) ou a senha inteira e um trecho de sequencia obvia, no sentido normal ou invertido: `0123456789(0)`, `abcdefghijklmnopqrstuvwxyz`, `qwertyuiopasdfghjklzxcvbnm`.
  3. `PESSOAL`: igual ao e-mail, ou CONTEM a parte local do e-mail (3+ caracteres) ou uma palavra do nome com 3+ letras (as particulas `das` e `dos` nao contam). Sem diferenciar caixa nem acento, e depois de trocar o leetspeak.
  4. `COMUM`: esta na lista local. Comparacao sem caixa e sem acento; corta o FIM da senha (digitos e simbolos) em cada ponto possivel e so depois troca o leetspeak (`@`->a, `0`->o, `3`->e, `$`->s, `5`->s, `1`->i ou l). Por isso `Senha1234!` e `Fl@meng0123` caem. Palavra comum no COMECO de uma frase longa e diferente (`flamengo-cadeira-tijolo-9`) passa.
- **Resposta:** 422 `{ statusCode: 422, message: 'Senha fraca: <motivo curto>', motivo: 'CURTA'|'COMUM'|'PESSOAL'|'REPETIDA' }`. A mensagem e FIXA por motivo: nunca traz a senha, um trecho dela nem a lista; todo `COMUM` responde igual, sem I/O (so um `Set` na memoria).
- **Lista:** `backend/src/auth/senhas-comuns.txt`, uma por linha, minusculas: as 10 mil do SecLists (MIT) mais ~130 senhas comuns no Brasil escritas a mao (times, `senha123`, `123mudar`, `deus`, `amor`, nomes do dominio da clinica). Origem e licenca em `docs/LICENCAS.md`. Lida UMA vez quando o modulo carrega (boot); o `nest-cli.json` copia o arquivo para `dist/` (`assets`). Atualizar a lista = trocar o arquivo e subir de novo.
- **Troca de senha:** a politica roda antes de conferir a senha atual (barato e nao revela nada da conta); `novaSenha` igual a atual segue 400.
- **Log e auditoria:** nenhuma senha, hash ou motivo detalhado em log; a recusa nao grava auditoria (nao houve acao).
- **Limite conhecido:** lista local de ~10 mil nao pega senha vazada que nao esteja nela. Servico de senha vazada (HIBP por faixa de hash, k-anonimato) fica como evolucao: exige rede no cadastro e decisao de privacidade do dono.
- Testes: `src/auth/politica-senha.spec.ts` (funcao pura) e `test/senha-forte.e2e-spec.ts` (HTTP nos 3 pontos, login antigo fraco).

### Residual de enumeracao de e-mail

`POST /clinicas` e `POST /psicologos` respondem 409 `E-mail ja cadastrado` quando o e-mail ja existe (o e-mail e unico GLOBAL). Quem consegue chamar essas rotas pode, portanto, descobrir se um e-mail ja tem conta, inclusive em OUTRA clinica (o ADMIN sonda e-mails por `POST /psicologos`).

- **O que o app faz hoje:** o corpo do 409 e identico para e-mail de outra clinica e da propria (teste `senha-forte.e2e-spec.ts`); o tempo nao revela mais (o bcrypt roda antes do INSERT nos dois caminhos); senha fraca responde 422 ANTES do 409 (a politica nao serve de sonda). Limites: cadastro de clinica 5/h por IP, equipe 20/h por psicologo, `@TetoHash()`. O login ja e generico (401 igual, hash falso, mesmo tempo).
- **O que NAO resolve:** com limites, a sonda fica lenta, nao impossivel (20 e-mails por hora por ADMIN; 5 por hora por IP).
- **Como fecha de verdade:** so a confirmacao de e-mail no cadastro (item 24: a resposta e sempre "enviamos um e-mail", igual existindo ou nao a conta) e o convite por e-mail de uso unico para colega (item 65: o ADMIN nao digita senha nem ve se o e-mail existe). Ate la e risco aceito e documentado.

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

| Tabela | Policy | Cifrado em repouso (AAD = `Paciente\|<coluna>\|id\|psicologoId`) | Grants do `praxis_app` |
|---|---|---|---|
| `Paciente` (item 9, migration `20261031230000_paciente`) | so `psicologo_proprio` (ENABLE + FORCE) | `nomeCifrado`, `nascimentoCifrado`, `telefoneCifrado`, `emailCifrado` (AES-256-GCM, chave por clinica; `id` gerado no app antes do INSERT porque entra no AAD) | SELECT, INSERT; UPDATE so dessas 4 colunas e `atualizadoEm`; sem DELETE (exclusao e o item 26) e sem UPDATE de `id`, `clinicaId`, `psicologoId` |
| `Auditoria` (item 11, migration `20261101120000_auditoria`) | `auditoria_insert` (WITH CHECK: clinica E psicologo do contexto) e `auditoria_select_proprio` (so as PROPRIAS linhas), ENABLE + FORCE; mais `auditoria_dono_update`/`auditoria_dono_delete` so `TO praxis_owner` (ver abaixo) | nada: sem conteudo clinico | **SELECT e INSERT apenas** (sem UPDATE, DELETE, TRUNCATE) |
| `Consentimento` (item 10, migration `20261101140000_consentimento`) | so `psicologo_proprio` (ENABLE + FORCE); mais `consentimento_dono_update`/`consentimento_dono_delete` so `TO praxis_owner` (mesmo motivo da `Auditoria`). Filha de `Paciente`: FK `(pacienteId, psicologoId, clinicaId)` RESTRICT | nada cifrado: so `evento` e o snapshot do termo (texto fixo do servidor, sem dado do paciente) | **SELECT e INSERT apenas** (sem UPDATE, DELETE, TRUNCATE) |
| `ConviteConsentimento` (item 22, migration `20261107120000_convite_consentimento`) | policies SEPARADAS (ENABLE + FORCE): `convite_select_proprio`, `convite_insert_proprio` (proprio E `estado = 'PENDENTE'`), `convite_cancelar_proprio` (UPDATE: proprio E `PENDENTE` -> so `CANCELADO`), as PUBLICAS `convite_por_token_select` e `convite_por_token_update` (so a linha cujo `tokenHash` e o `app.convite_hash` da transacao; UPDATE so `PENDENTE` -> `ACEITO`\|`RECUSADO`), e `convite_dono_update`/`convite_dono_delete` so `TO praxis_owner`. Filha de `Paciente`: FK `(pacienteId, psicologoId, clinicaId)` RESTRICT | nada cifrado: so o SHA-256 do token (CHECK de formato hex 64: o token cru nao cabe) | **SELECT e INSERT**; UPDATE so em `estado` e `usadoEm`; sem DELETE, sem TRUNCATE |
| `Documento` (item 12, migration `20261103120000_documento`; itens 14, 15 e 44, migration `20261104120000_documento_editar_aprovar_imutavel`) | policies SEPARADAS (ENABLE + FORCE): `documento_select_proprio`, `documento_insert_proprio` (proprio E `status = 'RASCUNHO'` E `aprovadoEm IS NULL`: ninguem insere ja aprovado), `documento_update_proprio` (proprio); mais `documento_dono_update`/`documento_dono_delete` so `TO praxis_owner` (para o trigger poder disparar). A `psicologo_proprio` do item 12 foi removida. Filha de `Paciente`: FK `(pacienteId, psicologoId, clinicaId)` RESTRICT; correcao: FK `(substituiId, pacienteId, psicologoId, clinicaId)` -> `Documento` RESTRICT. CHECKs: `tipo`, `status`, `(status = 'APROVADO') = (aprovadoEm IS NOT NULL)`, `substituiId <> id` | `conteudoCifrado` (AAD = `Documento\|conteudoCifrado\|id\|psicologoId`; `id` gerado no app). `dataSessao` fica em claro (metadado de linha do tempo) | **SELECT e INSERT**; UPDATE so em `conteudoCifrado`, `dataSessao`, `status`, `aprovadoEm`, `atualizadoEm`; sem DELETE, sem TRUNCATE |
| `GeracaoIa` (itens 19 a 21, migration `20261106120000_geracao_ia`) | policies SEPARADAS (ENABLE + FORCE): `geracaoia_select_proprio`, `geracaoia_insert_proprio` (proprio E `estado = 'PREVIA'`), `geracaoia_update_proprio`; mais `geracaoia_dono_update`/`geracaoia_dono_delete` so `TO praxis_owner` (trigger e limpeza de teste). Filha de `Documento`: FK da origem `(origemId, pacienteId, psicologoId, clinicaId)` e FK do documento gerado `(documentoId, ...)` (DEFERRABLE INITIALLY DEFERRED), ambas RESTRICT | `textoCifrado` e `mapaCifrado` (AAD = `GeracaoIa\|<coluna>\|id\|psicologoId`; `id` gerado no app) | **SELECT e INSERT**; UPDATE so em `estado`, `motivo`, `retentavel`, `avisos`, `textoCifrado`, `mapaCifrado`, `documentoId`, `atualizadoEm`, `finalizadoEm`; sem DELETE, sem TRUNCATE |

- Rotas `/pacientes` (qualquer usuario autenticado, senha provisoria = 403): o `PacientesService` e o unico lugar que cifra e decifra. Falha de decifra (ex.: texto cifrado copiado para outra linha) = 500 generico, sem o texto no log. Sem CPF nem endereco (decisao do dono); o item 50 cobre o que vier depois.
- Limpeza em teste: o `praxis_app` nao apaga `Paciente` nem `Documento`; `apagarClinicas` (`test/acesso-owner.ts`) apaga como `praxis_owner`, um psicologo por vez (a policy exige o dono no contexto) e so depois o `Psicologo`.

## Trilha de auditoria (item 11)

Registra **quem** (`psicologoId`), **o que** (`acao`: `CRIOU`, `LEU`, `LISTOU`, `EDITOU`, `APROVOU`, `CONCEDEU`, `REVOGOU`, `DESATIVOU`, `PREVIA_IA`, `ENVIOU_IA`, `CRIOU_CONVITE`, `CANCELOU_CONVITE`, `PACIENTE_ACEITOU_TERMO`, `PACIENTE_RECUSOU_TERMO`), **em que recurso** (`recurso` = `Paciente`, `Consentimento`, `Documento`, `Psicologo`, `GeracaoIa` ou `ConviteConsentimento`, `recursoId`) e **quando** (`criadoEm`), por tempo indefinido. Decisao do dono (2026-11-01).

- **O que NAO registra:** nome, e-mail, telefone, nascimento, valor de campo, texto clinico, IP, user-agent. So ids e constantes. `LISTOU` nao tem `recursoId`. 404, 400 e 401 nao gravam (nao houve acesso). `recursoId` nao tem FK: a trilha sobrevive ao recurso.
- **Como grava:** `AuditoriaService.registrar(tx, user, acao, recurso, recursoId?)` (`backend/src/auditoria/`), SEMPRE na mesma transacao (`runComoUsuario`) da acao. Se a trilha falhar, a acao inteira desfaz e a rota responde 500 (falha fechada). Sem fila. Rota clinica nova: chame `registrar` dentro do mesmo `runComoUsuario` e acrescente a constante em `ACOES`/`RECURSOS`.
- **Somente-acrescentar (3 camadas):** (1) o `praxis_app` so tem `SELECT` e `INSERT`; (2) RLS FORCE: INSERT so com clinica e psicologo do contexto, SELECT so das proprias linhas (colega e ADMIN veem zero do alheio; leitura pela clinica e item futuro, nao ha rota); (3) trigger `auditoria_somente_acrescentar` levanta excecao em UPDATE, DELETE e TRUNCATE, ate para o `praxis_owner`.
- **Policies do dono (`auditoria_dono_update`/`_delete`, so `TO praxis_owner`, so da clinica do contexto):** existem so para o trigger poder disparar. Sem policy o FORCE RLS faria o UPDATE/DELETE do dono afetar 0 linhas em silencio. A barreira e o trigger.
- **Desvio unico (limpeza das suites):** o trigger deixa passar `DELETE` quando quem executa e o DONO da tabela E a transacao tem `set_config('app.limpeza_de_teste', '1', true)`. Uso: `apagarClinicas` em `test/acesso-owner.ts` (a FK `Auditoria -> Psicologo` e RESTRICT, entao apagar o psicologo exige apagar a trilha antes). O `praxis_app` nunca usa: nao e dono e nao tem DELETE (teste prova com o desvio ligado). UPDATE e TRUNCATE nao tem desvio. Em producao nao ha rotina que ligue o desvio; apagar trilha so a mao, como dono, de proposito.
- **Consequencia da FK RESTRICT:** psicologo com trilha nao pode ser apagado (nem pelo dono) sem antes apagar a trilha com o desvio. O item de exclusao/LGPD (26) precisa decidir isso.
- Testes: `test/auditoria-rls.e2e-spec.ts` (banco) e `test/auditoria.e2e-spec.ts` (HTTP + atomicidade).

## Consentimento do paciente (item 10)

Decisao do dono (2026-11-01): consentimento POR PACIENTE; cada evento e uma linha NOVA (`CONCEDIDO`, `REVOGADO`, `CONCEDIDO` de novo); nada e sobrescrito nem apagado. Revogado bloqueia NOVOS documentos mas nao apaga os antigos. Quem registra e o psicologo (registro manual) ou o proprio paciente pelo link (item 22, secao abaixo). O termo e a constante `TERMO_VIGENTE` em `backend/src/consentimento/termo-consentimento.ts` (RASCUNHO nao revisado).

- **Estado** = `evento` da maior `seq` do paciente (sem linhas = `NENHUM`). Transicoes: `NENHUM|REVOGADO -> CONCEDIDO` e `CONCEDIDO -> REVOGADO`; qualquer outra = 409 `Transicao invalida`.
- **Rotas** (qualquer autenticado, senha provisoria = 403): `GET /pacientes/:id/consentimento` (200 `{estado, desde, historico:[{seq, evento, termoVersao, em}]}`, audita `LEU`), `POST /pacientes/:id/consentimento` body `{evento}` (201 com o mesmo corpo; audita `CONCEDEU` ou `REVOGOU`). Paciente alheio ou inexistente = 404 igual. `GET /pacientes` e `GET /pacientes/:id` trazem `consentimento` (a lista usa UMA consulta para todos).
- **Termo e snapshot:** `termoVersao`/`termoTexto` vem do servidor (nunca do corpo; campo extra = 400) e ficam gravados em cada linha. No `REVOGADO` repete-se a versao/texto do ultimo `CONCEDIDO`.
- **Concorrencia sem lock:** `UNIQUE (pacienteId, psicologoId, seq)`. Dois POST simultaneos calculam a mesma `seq`; o 2o recebe unique violation (P2002) e vira 409. O dono entra no unique de proposito: sem ele, o erro de unique (que ignora RLS) seria oraculo de existencia de paciente alheio via SQL direto (a FK ja garante 1 dono por paciente, entao a restricao e equivalente).
- **Somente-acrescentar (mesmas 3 camadas da `Auditoria`):** `praxis_app` so SELECT/INSERT; RLS FORCE `psicologo_proprio`; trigger `consentimento_somente_acrescentar` barra UPDATE, DELETE e TRUNCATE ate para o dono, com o MESMO desvio de limpeza de teste (`app.limpeza_de_teste = '1'`, so o dono da tabela, so DELETE). `apagarClinicas` apaga `Consentimento` antes de `Paciente`. CHECK no banco: `evento IN ('CONCEDIDO','REVOGADO')` e `seq >= 1`.
- **Consequencia da FK RESTRICT:** paciente com consentimento nao pode ser apagado (nem pelo dono) sem antes apagar as linhas com o desvio. O item 26 (exclusao/LGPD) precisa decidir isso.
- **`ConsentimentoService.exigirConcedido(tx, user, pacienteId)`:** lanca 403 `Consentimento nao concedido` se o estado nao for `CONCEDIDO`. O `DocumentosService.criar` (item 12) chama DENTRO da mesma transacao, depois de provar que o paciente e do usuario (404 antes de 403).
- Testes: `test/consentimento-rls.e2e-spec.ts` (banco), `test/consentimento.e2e-spec.ts` (HTTP) e `src/consentimento/consentimento.service.spec.ts` (maquina de estados).

## Termo de consentimento por link (item 22)

Decisao do dono (2026-11-05): o paciente recebe o termo por **link de uso unico e com prazo (7 dias)**, le e aceita **sem criar conta**; isso grava um evento de consentimento com a versao do termo. O texto (`TERMO_VIGENTE`, `backend/src/consentimento/termo-consentimento.ts`) e um **RASCUNHO NAO REVISADO**: producao so sobe com `PRAXIS_TERMO_REVISADO=1`, que o dono liga depois da revisao juridica. Rotas, envs e erros: `backend/README.md`.

- **Tabela `ConviteConsentimento`:** `tokenHash` (SHA-256 hex, UNIQUE, CHECK `^[0-9a-f]{64}$`), `termoVersao`, `estado` (`PENDENTE`, `ACEITO`, `RECUSADO`, `CANCELADO`), `expiraEm` (7 dias, relogio do app), `usadoEm` (quando saiu de `PENDENTE`; CHECK `(estado = 'PENDENTE') = (usadoEm IS NULL)`). **O token cru nunca e gravado, logado nem auditado**: so existe na resposta do `POST` (o `link`, mostrado UMA vez). "Expirado" e derivado (`PENDENTE` com `expiraEm` no passado), sem estado proprio; o prazo e conferido no codigo (`ConsentimentoPublicoService.valido`), com o relogio do app e nao o `now()` do banco (o Prisma grava UTC sem fuso).
- **Trigger `convite_consentimento_barreira` (BEFORE UPDATE, todos os papeis, o dono inclusive):** identidade imutavel (`id`, `clinicaId`, `psicologoId`, `pacienteId`, `tokenHash`, `termoVersao`, `expiraEm`, `criadoEm`); so `PENDENTE -> ACEITO|RECUSADO|CANCELADO`; estado final nao muda; `usadoEm` obrigatorio ao sair de `PENDENTE`. Indice unico parcial `ConviteConsentimento_um_pendente_por_paciente (pacienteId, psicologoId) WHERE estado = 'PENDENTE'`: no maximo 1 convite pendente por paciente, decidido pelo banco (o dono entra no indice pelo mesmo motivo do unique de `seq`).
- **Policy PUBLICA `convite_por_token` (modelo: `login_lookup`):** o paciente nao tem login nem `clinicaId`. A rota publica roda em `TenantPrismaService.runConvite(hash, fn)`, o unico lugar com o `set_config('app.convite_hash', ...)`. Com o hash a transacao enxerga **so a linha desse hash** (`SELECT`) e so pode mudar `PENDENTE -> ACEITO|RECUSADO` (`UPDATE`, com `WITH CHECK`); sem o hash (ou vazio) a comparacao nao casa nunca: ZERO linhas. O hash NAO abre `Paciente`, `Documento` nem `Consentimento`. Para gravar o evento e a trilha, `fn` chama `assumirDono({clinicaId, psicologoId})` com os valores LIDOS DO CONVITE (nunca do cliente): so ai valem as policies de clinica/psicologo, e o evento e gravado como o dono do paciente.
- **`Consentimento` ganha `origem` (`PSICOLOGO` default | `PACIENTE`) e `conviteId`:** CHECK `(origem = 'PACIENTE') = (conviteId IS NOT NULL)`; FK composta `(conviteId, pacienteId, psicologoId, clinicaId)` RESTRICT; unique `(conviteId, pacienteId, psicologoId)` (um convite gera no maximo UM evento). Policy **RESTRITIVA** `consentimento_origem_paciente` (INSERT): `origem = 'PACIENTE'` so com `evento = 'CONCEDIDO'` E convite `ACEITO` cujo hash e o `app.convite_hash` da transacao. Resultado: o psicologo, mesmo com SQL direto, nao forja "aceito pelo paciente"; a ordem do fluxo e fixa (primeiro o convite vira `ACEITO`, depois o evento). A tabela segue somente-acrescentar (o trigger `consentimento_somente_acrescentar` nao mudou).
- **Fluxo `aceitar` (uma transacao):** (1) `UPDATE` do convite condicional `PENDENTE`, nao expirado e `termoVersao` = a vigente (0 linhas = 404 igual); (2) `assumirDono`; (3) psicologo precisa estar ativo (senao 404 igual); (4) `INSERT` em `Consentimento` (`CONCEDIDO`, `origem PACIENTE`, `seq` como no registro manual, termo vigente), salvo se o estado ja for `CONCEDIDO` (registro manual no meio do caminho: o convite fica `ACEITO` sem evento novo); (5) auditoria `PACIENTE_ACEITOU_TERMO` (recurso `Consentimento`, recursoId = paciente, psicologo = o dono). Clique duplo e 2 abas: a 2a espera o lock da linha, ve `ACEITO` e responde 404; colisao de `seq` com um registro manual simultaneo desfaz a transacao e tenta UMA vez de novo. `recusar` e igual, sem evento, com `PACIENTE_RECUSOU_TERMO`.
- **O que o link REVELA:** nome da clinica, nome do psicologo, o texto e a versao do termo, e o prazo. **O que NAO revela:** nome ou qualquer dado do paciente, ids, se o paciente existe, estado de outros convites. Token desconhecido, de formato errado, expirado, cancelado, usado, recusado, de outra versao do termo ou de psicologo desativado respondem o MESMO 404 `Link invalido ou expirado`; o 400 so existe para corpo invalido em `aceitar`. Versao nova do termo invalida os convites antigos (o paciente nunca aceita um texto que nao viu).
- **Minimizacao:** nao grava IP, user-agent nem nome digitado. Toda resposta publica sai com `Cache-Control: no-store` e `Referrer-Policy: no-referrer` (guard de classe: vale tambem em 404, 400 e 429). Throttler proprio `consentimento-publico` (20/min por IP, /64 no IPv6; contador por rota); o 429 nao tem detalhe. O token e uma credencial de 256 bits na URL: quem tem o link aceita; por isso o prazo curto, o uso unico e o cancelamento pelo psicologo.
- **Limpeza em teste:** `apagarClinicas` apaga `ConviteConsentimento` depois de `Consentimento` (FK RESTRICT) e antes de `Paciente`; o `praxis_app` nao tem DELETE.
- Testes: `test/convite-consentimento-rls.e2e-spec.ts` (banco, policy publica, trigger, origem), `test/convite-consentimento.e2e-spec.ts` (HTTP) e `src/convite-consentimento/*.spec.ts`.

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
- **Trigger `documento_imutavel` (item 44, vale para TODOS os papeis, o dono da tabela inclusive):** UPDATE com `OLD.status = 'APROVADO'` = excecao sempre (nem `atualizadoEm` muda). RASCUNHO -> APROVADO so com `aprovadoEm` preenchido e `conteudoCifrado`/`dataSessao` iguais. RASCUNHO -> RASCUNHO nao muda `id`, `clinicaId`, `psicologoId`, `pacienteId`, `tipo`, `substituiId` nem `aprovadoEm`. DELETE de APROVADO = excecao sempre; unico desvio: o DONO da tabela com `set_config('app.limpeza_de_teste', '1', true)` (so a limpeza das suites, como nas outras tabelas). DELETE de rascunho nao tem barreira no trigger: o `praxis_app` nao tem o privilegio. TRUNCATE barrado sempre.
- **Camadas:** (1) o `praxis_app` tem UPDATE so em 5 colunas e nenhum DELETE; (2) policies: INSERT so RASCUNHO sem `aprovadoEm`, UPDATE/SELECT so do proprio; (3) trigger; (4) o `WHERE status = 'RASCUNHO'` do codigo decide a corrida aprovar x editar sem SELECT antes. Policies `documento_dono_*` existem so para o trigger poder disparar para o dono (sem elas o FORCE RLS faria o UPDATE/DELETE do dono afetar 0 linhas).
- **Consequencia da FK de correcao RESTRICT:** aprovado que tem correcao nao pode ser apagado (nem pelo dono com o desvio) antes da correcao. O item 26 (exclusao/LGPD) precisa decidir; ate la, aprovado so sai pelo desvio de limpeza.
- Testes: `test/documentos-rls.e2e-spec.ts` (banco e trigger), `test/documentos-aprovacao.e2e-spec.ts` (HTTP, corrida, auditoria, atomicidade) e `src/documentos/documentos.service.spec.ts`.

## Geracao de documento por IA (itens 19, 20, 21 e 51)

Decisao do dono (2026-11-05): **previa obrigatoria** (o psicologo ve e confirma o texto anonimizado que sai do sistema) e **retentativa sem limite** quando a IA ou a conexao falha. O resultado entra como NOVO documento EVOLUCAO ou ANAMNESE em RASCUNHO (`Documento.geradoPorIa = true`, imutavel); o psicologo sempre revisa e aprova. Rotas e envs: `backend/README.md`.

- **Tabela `GeracaoIa`** (um pedido): `estado` `PREVIA -> PENDENTE -> PRONTO | FALHOU`, e `FALHOU` retentavel volta a `PENDENTE`. Trigger `geracao_ia_barreira` (todos os papeis, o dono inclusive): identidade imutavel (id, clinica, psicologo, paciente, origem, tipo, abordagem, `criadoEm`, `expiraEm`); so as transicoes `PREVIA->PENDENTE`, `FALHOU->PENDENTE`, `PENDENTE->PRONTO`, `PENDENTE->FALHOU`; `PRONTO` e final; fora do `PRONTO` o texto e o mapa cifrados NAO mudam (sai exatamente o que a previa mostrou). CHECKs: tipo, abordagem, estado, `motivo` (lista fechada, nunca texto da IA) e a FORMA de cada estado (PRONTO = documento ligado, `finalizadoEm`, cifrados NULOS; FALHOU = motivo, retentavel, `finalizadoEm`, cifrados presentes; demais = sem documento, sem fim, cifrados presentes). Indice unico parcial `GeracaoIa_um_pendente_por_psicologo`: no maximo UMA `PENDENTE` por psicologo, decidido pelo banco. A policy de INSERT exige `estado = 'PREVIA'`.
- **Cifra:** `textoCifrado` = texto anonimizado exato da previa; `mapaCifrado` = JSON codigo->original (tem nome, CPF, telefone em claro por dentro, por isso cifrado). AES-256-GCM por clinica, AAD com a coluna, o `id` e o psicologo. No `PRONTO` os dois viram NULL (nao precisam mais: o documento ja tem o texto reidentificado, cifrado). No `FALHOU` ficam, para a retentativa.
- **Quem faz o que:** o `GeracaoIaService` (previa, confirmar, consulta) so grava estado; a chamada ao SelahIA e do `GeracaoIaExecutor`, em processo, DEPOIS do commit da transicao e FORA de qualquer transacao (regra do projeto: nunca I/O de rede dentro de `runComoUsuario`). O executor conclui numa transacao nova: UPDATE condicional `PENDENTE -> PRONTO` (0 linhas = perdeu a corrida, nao cria nada) e so entao o INSERT do `Documento` (o `documentoId` do pedido e conferido no COMMIT pela FK deferida). Servidor que cai no meio deixa o pedido `PENDENTE`; a consulta vira `FALHOU` (`TEMPO_ESGOTADO`, retentavel) apos 120 s.
- **O que NAO vai a log, motivo, aviso nem auditoria:** nota, texto anonimizado, mapa, rascunho da IA, nome do paciente, chave do SelahIA. So ids, `motivo` de lista fechada, `avisos` (`DADO_NOVO`, `CODIGO_DESCONHECIDO`), nomes de erro, status HTTP, latencia e `inputChars`. A saida da IA e so TEXTO: e saneada (controle e invisiveis fora), limitada a 20000 caracteres (recusa, nao corta) e vira rascunho; nada e executado nem renderizado como HTML.
- **Auditoria (mesma transacao da mudanca):** `PREVIA_IA` ao criar a previa; `ENVIOU_IA` a CADA envio (a 1a vez e cada retentativa: e quando dado sai do sistema); `LEU` ao reabrir a previa; `CRIOU` (recurso `Documento`) quando o executor cria o rascunho. Consultar o estado e listar nao auditam.
- **Limite diario (item 19):** `PRAXIS_IA_LIMITE_DIARIO` (padrao 20) conta geracoes `PRONTO` do psicologo no dia corrente de `America/Sao_Paulo`; falhas e pendentes nao contam.
- **Consequencia das FKs RESTRICT:** nota com pedido de IA, e rascunho gerado ligado a um pedido, nao sao apagados antes do pedido. Retencao e o item 52; sem DELETE para o app. `apagarClinicas` (teste) apaga `GeracaoIa` antes de `Documento`.
- Testes: `test/geracao-ia-rls.e2e-spec.ts` (banco e trigger), `test/geracao-ia.e2e-spec.ts` (HTTP com SelahIA falso) e `src/geracao-ia/*.spec.ts`.

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

## Recifragem pelo dono do banco (item 25, parte B)

- Quem pode: quem tem a credencial do `praxis_owner` (`DATABASE_URL_OWNER`). Isso ja era possivel antes, desligando o trigger; o item 56 guarda essa credencial. O `praxis_app` nao ganha nada: a CLI recusa rodar como ele.
- O que faz: troca cada valor cifrado que esta em chave antiga pela chave atual (`PRAXIS_MASTER_KEY_ATUAL`), em lotes, sem parar o sistema. So as colunas cifradas (`Paciente`, `Documento.conteudoCifrado`, `GeracaoIa.textoCifrado`/`mapaCifrado`).
- Excecao nos triggers: em documento aprovado e em geracao de IA, so o dono, com `app.recifrar = '1'` na transacao, e so se a coluna cifrada for a unica que muda. Status, datas e identidade continuam imutaveis.
- Comando: `npm run recifrar -- [--clinica <id>] [--lote 200] [--dry-run]`, em `backend/`. Saida: so contagens por tabela e coluna, nunca valor ou chave. Sai com 1 se houver falha de verificacao (nada e gravado nessas linhas).
- Excecao a regra "set_config so no TenantPrismaService": `backend/src/ferramentas/recifrar.ts` (ferramenta do dono, documentada no cabecalho).

## Retencao de rascunhos (item 52A, fatia do back)

- Regra: documento `RASCUNHO` (qualquer tipo, inclusive `PRAXIS_BRUTA`) sem edicao ha mais de N dias e apagado de verdade. O criterio e `atualizadoEm` anterior ao corte; cada edicao zera o prazo. N = `PRAXIS_RETENCAO_RASCUNHO_DIAS` (inteiro de 1 a 36500, padrao 7). Valor invalido derruba o boot e o comando, sem mostrar o valor.
- Nunca apagado: `APROVADO`. O trigger `documento_imutavel` barra o DELETE de aprovado para todos os papeis, e a funcao filtra antes. Para guardar um texto, aprove-o.
- Sai junto: as `GeracaoIa` ligadas ao rascunho, como origem ou como documento gerado (FK RESTRICT: saem antes). Isso inclui a geracao cujo documento gerado ja foi aprovado: o aprovado fica intacto, mas o registro de qual rascunho o originou some. Rascunho de paciente excluido (anonimizado) tambem sai.
- Pulado: rascunho com `GeracaoIa` `PENDENTE` (executor da IA em voo). Sai numa rodada seguinte, se ainda vencido.
- Quem apaga: a funcao `descartar_rascunhos_vencidos(corte, lote, simular)` (migration `20261111120000_descartar_rascunhos`). EXECUTE so do dono: `REVOKE` de PUBLIC e de `praxis_app`. Ela usa as policies de DELETE do dono que ja existiam (so da clinica do contexto). A flag `app.descartando`, ligada so na transacao, abre a leitura e a auditoria do dono nessa clinica, e nada mais. `praxis_app` continua sem DELETE em `Documento`.
- Auditoria: `DESCARTOU` por documento apagado (`recursoId` = id do documento, dono = dono do documento), na mesma transacao do DELETE.
- Comando: `npm run descartar -- [--dry-run] [--clinica <id>] [--lote N]` (N de 1 a 5000, padrao 500), em `backend/`, com `DATABASE_URL_OWNER`. Recusa rodar como `praxis_app`. Percorre clinica por clinica, em lotes (cada lote e uma transacao curta). `--dry-run` so conta. Dois processos ao mesmo tempo nao apagam o mesmo rascunho (`FOR UPDATE SKIP LOCKED`). Saida: so numeros e ids de clinica. Codigos de saida: 0 ok, 1 erro de banco, 2 uso ou configuracao.
- Ainda nao agendado: o comando roda na mao. O agendamento e do item 56 (deploy).
- Para a tela (fatia 52C): a API devolve `descarteEm` (ISO = `atualizadoEm` + prazo) em cada rascunho, nas respostas de listar, obter, criar e editar. Em aprovado vem `null`.
- Testes: `test/descartar-rascunhos.e2e-spec.ts` (banco, com envelhecimento feito pelo dono), `src/ferramentas/descartar.spec.ts` e `src/comum/retencao.spec.ts`.
- Backups (item 52B) guardam 30 dias e sao apagados por `npm run podar-backups`: ver `docs/BACKUP-E-CHAVES.md`, secao "Quanto tempo guardar (30 dias)".

## Exclusao de paciente por anonimizacao (item 26, fatia do back)

- Rota: `DELETE /pacientes/:id` (200 `{ excluidoEm }`). So o proprio psicologo (ADMIN nao exclui paciente de colega). Inexistente, alheio e ja excluido = o MESMO 404 (`P0002` da funcao `anonimizar_paciente`, sem pre-checagem no app). 409 se um documento ou geracao nasceu no meio (tombstone faltando; tente de novo).
- O app calcula os tombstones cifrados com o AAD de cada linha e a funcao SQL (dona `praxis_owner`, flag `app.anonimizando`) so troca esses valores e marca `excluidoEm`. Auditoria `EXCLUIU` na mesma transacao: se ela falha, nada muda. Mapa da geracao vira `[]` (lista JSON, o executor itera sobre ele).
- Todo caminho que le paciente, documento, geracao, consentimento ou convite filtra paciente excluido (`excluidoEm: null`, ou `SO_PACIENTE_VIVO` nas geracoes) e responde 404 identico.
- IA em voo (limite): a chamada ao SelahIA que ja saiu antes da exclusao nao volta (rede, fora de transacao); o texto anonimizado (sem identificadores) ja estava la. Quando ela responde, o INSERT do documento e barrado pelo trigger `documento_paciente_excluido`, a transacao desfaz e o pedido vira FALHOU com texto tombstone. Provado em `test/pacientes-excluir.e2e-spec.ts` (IA em voo).
- Pendente: tela da exportacao (o back esta pronto, ver a secao abaixo).

## Exportacao de paciente (item 26, portabilidade, fatia do back)

- Rota: `GET /pacientes/:id/exportar`. So o proprio psicologo (ADMIN nao le paciente de colega). Resposta 200 em JSON, `Content-Disposition: attachment; filename="paciente-<uuid>.json"` (nunca o nome), `Cache-Control: no-store`. Formato versionado (`"versao": 1`): `paciente` (id, nome, nascimento, telefone, email, criadoEm, atualizadoEm), `consentimentos`, `documentos` (texto DECIFRADO), `convites` e um `aviso` fixo.
- Sai: os dados do paciente, o historico de consentimento (evento, versao do termo, origem, convite de origem), os documentos com status, datas e a ligacao de correcao (`substituiId`), e os convites (estado e datas).
- NAO sai, e por que: colunas `*Cifrado` e hashes (sao do armazenamento, nao do dado); `tokenHash` e o token do link (credencial de aceite); GeracaoIa (texto anonimizado e mapa sao transitorios e o mapa tem pseudonimos); trilha de auditoria (e do sistema, nao do paciente); texto longo do termo (sai so a versao); dados de outros pacientes ou do psicologo.
- Tudo numa unica transacao (`runComoUsuario`): leituras, decifra e a auditoria `EXPORTOU` (recurso `Paciente`, id do paciente). Falha de decifra = 500 generico, sem arquivo parcial e sem auditoria. 404 identico (inexistente, alheio, outra clinica, ja excluido), sem auditoria.
- Teto: 2000 linhas por lista (documentos, consentimentos, convites). Acima disso = 413 com mensagem fixa, sem montar o arquivo.
- Limite: 10 por hora por psicologo (`exportar`, 429 com `Retry-After`). Conta tambem 400 (id invalido), 404 e 413, porque o guard roda antes do pipe e do servico. Aceito de proposito: so o proprio psicologo se trava (por no maximo 1 hora), e contar so os 200 deixaria varrer ids sem custo.
- Provado em `test/pacientes-exportar.e2e-spec.ts` (cabecalhos, formato, decifra, nada de segredo no JSON, 404 identico, trilha, limite) e nos testes unitarios de `src/pacientes/pacientes.service.spec.ts`.
