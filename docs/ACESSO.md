# Regras de acesso entre psicologos

Decisao do dono (2026-10-30): **cada psicologo ve so os proprios pacientes e documentos. Ninguem le prontuario de colega, nem o ADMIN.**

## Quem pode o que

| Acao | ADMIN | PSICOLOGO | Sem login |
|---|---|---|---|
| Cadastrar clinica (`POST /clinicas`), login, `/saude` | sim | sim | sim (rotas publicas) |
| Ver os proprios dados (`GET /eu`) | sim | sim | nao (401) |
| Gerenciar equipe: criar e listar psicologos (`POST/GET /psicologos`, item 8) | sim | nao (403) | nao (401) |
| Atender e ler os PROPRIOS pacientes/documentos (Fase 2) | sim | sim | nao (401) |
| Ler paciente/documento de COLEGA | **nao** | **nao** | nao |

- ADMIN = quem cadastrou a clinica. Ele gerencia a equipe e tambem atende como qualquer psicologo (clinica solo). O papel NAO abre prontuario alheio.
- O papel e lido do banco a cada requisicao (nao vai no token): rebaixar alguem vale na hora.
- 403 e sempre generico (`Forbidden resource`): nunca diz qual papel faltou.
- A tabela `Psicologo` usa a policy `tenant_isolation` (por clinica), nao `psicologo_proprio`: o ADMIN lista nome, e-mail, papel e abordagem dos colegas (nunca `senhaHash`). Isso nao abre prontuario: paciente/documento seguem o padrao abaixo.

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
- [ ] Migration tem ENABLE + FORCE e a policy `psicologo_proprio` copiada deste arquivo, com USING e WITH CHECK.
- [ ] Nenhuma outra policy permissiva na tabela (`SELECT policyname FROM pg_policies WHERE tablename = '...'` mostra so `psicologo_proprio`).
- [ ] Todo acesso passa por `runComoUsuario`; nenhum `run` sem `psicologoId` nessa tabela.
- [ ] Todo `where` tem `clinicaId` e `psicologoId` do token.
- [ ] Teste de integracao (Postgres real) prova: colega da mesma clinica (inclusive ADMIN) ve ZERO; sem `psicologoId` = zero; outra clinica = zero; INSERT com `psicologoId` alheio falha; UPDATE/DELETE de linha alheia afeta 0.
- [ ] Teste unitario do service com banco falso SEM RLS prova o filtro por `psicologoId` no `where`.
