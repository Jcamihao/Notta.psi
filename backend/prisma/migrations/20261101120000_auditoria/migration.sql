-- Trilha de auditoria (item 11): quem fez o que em que recurso e quando, SEM conteudo, nome
-- nem IP. Somente-acrescentar: o notta_app so tem SELECT e INSERT, e um trigger barra
-- UPDATE, DELETE e TRUNCATE ate para o dono da tabela (docs/ACESSO.md).

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "psicologoId" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "recursoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Auditoria_clinicaId_psicologoId_criadoEm_idx" ON "Auditoria"("clinicaId", "psicologoId", "criadoEm");

-- CreateIndex
CREATE INDEX "Auditoria_clinicaId_recurso_recursoId_idx" ON "Auditoria"("clinicaId", "recurso", "recursoId");

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_psicologoId_clinicaId_fkey" FOREIGN KEY ("psicologoId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 1) Privilegios: o notta_app so le e acrescenta (tira o que o DEFAULT PRIVILEGES deu).
REVOKE ALL ON "Auditoria" FROM notta_app;
GRANT SELECT, INSERT ON "Auditoria" TO notta_app;

-- 2) RLS ENABLE + FORCE. INSERT: clinica E psicologo do contexto (ninguem grava em nome de
--    outro). SELECT: so as PROPRIAS linhas. Leitura pela clinica/ADMIN e item futuro.
ALTER TABLE "Auditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Auditoria" FORCE ROW LEVEL SECURITY;
CREATE POLICY auditoria_insert ON "Auditoria" FOR INSERT
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));
CREATE POLICY auditoria_select_proprio ON "Auditoria" FOR SELECT
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));

-- 3) So o notta_owner (dono) alcanca linhas para UPDATE/DELETE, e so da clinica do contexto:
--    sem estas policies o FORCE RLS faria o UPDATE/DELETE do dono afetar 0 linhas e o trigger
--    abaixo nunca dispararia (nem daria para limpar os dados de teste). A barreira real e o trigger.
CREATE POLICY auditoria_dono_update ON "Auditoria" FOR UPDATE TO notta_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
CREATE POLICY auditoria_dono_delete ON "Auditoria" FOR DELETE TO notta_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- 4) Trigger: UPDATE, DELETE e TRUNCATE sempre levantam excecao. Unico desvio: DELETE feito
--    pelo DONO da tabela com `app.limpeza_de_teste = '1'` na transacao (so a limpeza das suites,
--    test/acesso-owner.ts). O notta_app nao e dono e nem tem DELETE, entao nunca usa o desvio.
CREATE FUNCTION auditoria_somente_acrescentar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.limpeza_de_teste', true) = '1'
     AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Auditoria e somente-acrescentar (% barrado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER auditoria_barreira_linha BEFORE UPDATE OR DELETE ON "Auditoria"
  FOR EACH ROW EXECUTE FUNCTION auditoria_somente_acrescentar();
CREATE TRIGGER auditoria_barreira_truncate BEFORE TRUNCATE ON "Auditoria"
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_somente_acrescentar();
