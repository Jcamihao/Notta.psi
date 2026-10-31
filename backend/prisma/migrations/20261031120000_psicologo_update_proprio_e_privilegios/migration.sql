-- Psicologo: cada um so ALTERA a propria linha (M1 da revisao da Fase 1).
-- Antes a policy tenant_isolation era FOR ALL: qualquer colega da clinica podia
-- trocar papel ou senhaHash de outro (inclusive do ADMIN) no nivel do banco.
-- Leitura, cadastro e remocao continuam por clinica (o ADMIN lista e cadastra a equipe).
DROP POLICY tenant_isolation ON "Psicologo";

CREATE POLICY tenant_isolation_select ON "Psicologo" FOR SELECT
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

CREATE POLICY tenant_isolation_insert ON "Psicologo" FOR INSERT
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

CREATE POLICY tenant_isolation_delete ON "Psicologo" FOR DELETE
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- UPDATE exige a clinica E o proprio id (app.current_psicologo_id, vem do token via
-- runComoUsuario). Sem psicologoId no contexto o UPDATE afeta 0 linhas.
CREATE POLICY psicologo_update_proprio ON "Psicologo" FOR UPDATE
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "id" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "id" = NULLIF(current_setting('app.current_psicologo_id', true), ''));

-- Colunas: o app so altera nome, abordagem e senha. papel, email, clinicaId e id
-- ficam imutaveis para o notta_app (permission denied), mesmo na propria linha.
-- Coluna nova que o app precise alterar: GRANT UPDATE (coluna) explicito.
REVOKE UPDATE ON "Psicologo" FROM notta_app;
GRANT UPDATE ("nome", "abordagemPadrao", "senhaHash") ON "Psicologo" TO notta_app;

-- TEMP vem de PUBLIC por padrao: o app nao precisa criar tabela temporaria (M8).
-- DO + format: o nome do banco muda entre dev, teste e producao.
DO $$
BEGIN
  EXECUTE format('REVOKE TEMP ON DATABASE %I FROM PUBLIC', current_database());
END
$$;

-- Tabela futura com autoincrement precisa de USAGE na sequence (nextval) para o app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO notta_app;
