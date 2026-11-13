-- Consentimento do paciente (item 10): cada evento e uma linha NOVA, nada e sobrescrito.
-- Filha de Paciente (FK composta com o dono, docs/ACESSO.md). Somente-acrescentar como a
-- Auditoria: o praxis_app so tem SELECT e INSERT e um trigger barra UPDATE, DELETE e TRUNCATE
-- ate para o dono da tabela.

-- CreateTable
CREATE TABLE "Consentimento" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "psicologoId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "evento" TEXT NOT NULL,
    "termoVersao" TEXT NOT NULL,
    "termoTexto" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consentimento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Consentimento_evento_check" CHECK ("evento" IN ('CONCEDIDO', 'REVOGADO')),
    CONSTRAINT "Consentimento_seq_check" CHECK ("seq" >= 1)
);

-- CreateIndex (unique com o dono: a FK ja garante 1 dono por paciente; sem ele o erro de unique,
-- que ignora RLS, seria oraculo de existencia de paciente alheio)
CREATE UNIQUE INDEX "Consentimento_pacienteId_psicologoId_seq_key" ON "Consentimento"("pacienteId", "psicologoId", "seq");

-- CreateIndex
CREATE INDEX "Consentimento_clinicaId_psicologoId_idx" ON "Consentimento"("clinicaId", "psicologoId");

-- AddForeignKey (inclui o dono: paciente alheio e inexistente dao o MESMO erro)
ALTER TABLE "Consentimento" ADD CONSTRAINT "Consentimento_pacienteId_psicologoId_clinicaId_fkey" FOREIGN KEY ("pacienteId", "psicologoId", "clinicaId") REFERENCES "Paciente"("id", "psicologoId", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 1) Privilegios: o praxis_app so le e acrescenta (tira o que o DEFAULT PRIVILEGES deu).
REVOKE ALL ON "Consentimento" FROM praxis_app;
GRANT SELECT, INSERT ON "Consentimento" TO praxis_app;

-- 2) RLS ENABLE + FORCE com a policy psicologo_proprio (bloco de docs/ACESSO.md).
ALTER TABLE "Consentimento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Consentimento" FORCE ROW LEVEL SECURITY;
CREATE POLICY psicologo_proprio ON "Consentimento"
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));

-- 3) Policies so do praxis_owner, so da clinica do contexto: sem elas o FORCE RLS faria o
--    UPDATE/DELETE do dono afetar 0 linhas e o trigger nunca dispararia (nem daria para limpar
--    os dados de teste). A barreira real e o trigger.
CREATE POLICY consentimento_dono_update ON "Consentimento" FOR UPDATE TO praxis_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
CREATE POLICY consentimento_dono_delete ON "Consentimento" FOR DELETE TO praxis_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- 4) Trigger: UPDATE, DELETE e TRUNCATE sempre levantam excecao. Unico desvio: DELETE feito
--    pelo DONO da tabela com `app.limpeza_de_teste = '1'` na transacao (so a limpeza das suites,
--    test/acesso-owner.ts). O praxis_app nao e dono e nem tem DELETE, entao nunca usa o desvio.
CREATE FUNCTION consentimento_somente_acrescentar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.limpeza_de_teste', true) = '1'
     AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Consentimento e somente-acrescentar (% barrado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER consentimento_barreira_linha BEFORE UPDATE OR DELETE ON "Consentimento"
  FOR EACH ROW EXECUTE FUNCTION consentimento_somente_acrescentar();
CREATE TRIGGER consentimento_barreira_truncate BEFORE TRUNCATE ON "Consentimento"
  FOR EACH STATEMENT EXECUTE FUNCTION consentimento_somente_acrescentar();
