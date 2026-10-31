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
- **Senha provisoria (item 62):** o colega criado pelo ADMIN (`POST /psicologos`) nasce com `senhaProvisoria = true`. Ate trocar a senha, TODA rota autenticada responde 403 `Troca de senha obrigatoria`, salvo `GET /eu` e `POST /auth/trocar-senha`. A troca incrementa `tokenVersao` (claim `tv` do JWT): os tokens antigos viram 401 e a senha que o ADMIN conhecia deixa de logar. Assim o ADMIN nao entra na conta do colega.
- **Rota nova e bloqueada enquanto a senha for provisoria** ate ter `@PermiteSenhaProvisoria()` (falha fechada, `JwtAuthGuard`). So marque rota que o colega PRECISA antes de trocar a senha; nunca rota de dado clinico.
- A tabela `Psicologo` usa policies por clinica para SELECT, INSERT e DELETE (`tenant_isolation_*`), nao `psicologo_proprio`: o ADMIN lista nome, e-mail, papel e abordagem dos colegas (nunca `senhaHash`). Isso nao abre prontuario: paciente/documento seguem o padrao abaixo.
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
