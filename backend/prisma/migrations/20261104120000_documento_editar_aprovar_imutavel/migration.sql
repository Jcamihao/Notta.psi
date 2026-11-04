-- Documento: editar rascunho (item 14), aprovar (item 15) e imutavel no banco (item 44).
-- Aprovar e irreversivel: aprovado nao edita nem apaga, nem para o dono da tabela (trigger).
-- Correcao = documento NOVO (rascunho) ligado ao aprovado por "substituiId".

-- AlterTable
ALTER TABLE "Documento" ADD COLUMN     "aprovadoEm" TIMESTAMP(3),
ADD COLUMN     "substituiId" TEXT;

-- CreateIndex (alvo da FK de correcao: paciente e dono entram na chave)
CREATE UNIQUE INDEX "Documento_id_pacienteId_psicologoId_clinicaId_key" ON "Documento"("id", "pacienteId", "psicologoId", "clinicaId");

-- AddForeignKey (so vale com substituiId preenchido; paciente ou dono diferente = recusado)
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_substituiId_pacienteId_psicologoId_clinicaId_fkey" FOREIGN KEY ("substituiId", "pacienteId", "psicologoId", "clinicaId") REFERENCES "Documento"("id", "pacienteId", "psicologoId", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs (o Prisma trata como text/timestamp)
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_aprovado_check" CHECK (("status" = 'APROVADO') = ("aprovadoEm" IS NOT NULL));
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_substitui_check" CHECK ("substituiId" IS NULL OR "substituiId" <> "id");

-- 1) Privilegios: UPDATE so nestas colunas. Sem DELETE. (id, clinicaId, psicologoId, pacienteId,
--    tipo, substituiId e criadoEm ficam imutaveis para o app.)
GRANT UPDATE ("conteudoCifrado", "dataSessao", "status", "aprovadoEm", "atualizadoEm") ON "Documento" TO notta_app;

-- 2) Policies separadas no lugar da unica psicologo_proprio (o WITH CHECK dela, com
--    status = 'RASCUNHO', tambem valia para UPDATE e impedia aprovar).
DROP POLICY psicologo_proprio ON "Documento";
CREATE POLICY documento_select_proprio ON "Documento" FOR SELECT
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));
CREATE POLICY documento_insert_proprio ON "Documento" FOR INSERT
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), '') AND "status" = 'RASCUNHO' AND "aprovadoEm" IS NULL);
CREATE POLICY documento_update_proprio ON "Documento" FOR UPDATE
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));

-- 3) Policies so do notta_owner, so da clinica do contexto (mesmo molde das tabelas
--    somente-acrescentar): sem elas o FORCE RLS faria o UPDATE/DELETE do dono afetar 0 linhas e o
--    trigger nunca dispararia. A barreira real e o trigger.
CREATE POLICY documento_dono_update ON "Documento" FOR UPDATE TO notta_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
CREATE POLICY documento_dono_delete ON "Documento" FOR DELETE TO notta_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- 4) Trigger (item 44), vale para TODOS os papeis, o dono da tabela inclusive.
--    DELETE: aprovado = excecao sempre; unico desvio: o DONO da tabela com
--    `app.limpeza_de_teste = '1'` na transacao (so a limpeza das suites, test/acesso-owner.ts).
--    O DELETE de rascunho nao tem barreira aqui: o app nao tem o privilegio.
--    UPDATE: aprovado = excecao sempre. RASCUNHO -> APROVADO so mudando status e aprovadoEm.
--    RASCUNHO -> RASCUNHO nao muda identidade (id, clinica, psicologo, paciente, tipo,
--    substituiId, aprovadoEm). TRUNCATE: sempre barrado.
CREATE FUNCTION documento_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Documento e imutavel (TRUNCATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'APROVADO' THEN
      IF current_setting('app.limpeza_de_teste', true) = '1'
         AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Documento aprovado e imutavel (DELETE barrado)' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'APROVADO' THEN
    RAISE EXCEPTION 'Documento aprovado e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."clinicaId" IS DISTINCT FROM OLD."clinicaId"
     OR NEW."psicologoId" IS DISTINCT FROM OLD."psicologoId"
     OR NEW."pacienteId" IS DISTINCT FROM OLD."pacienteId"
     OR NEW."tipo" IS DISTINCT FROM OLD."tipo"
     OR NEW."substituiId" IS DISTINCT FROM OLD."substituiId" THEN
    RAISE EXCEPTION 'Documento: identidade e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."status" = 'APROVADO' THEN
    IF NEW."aprovadoEm" IS NULL
       OR NEW."conteudoCifrado" IS DISTINCT FROM OLD."conteudoCifrado"
       OR NEW."dataSessao" IS DISTINCT FROM OLD."dataSessao" THEN
      RAISE EXCEPTION 'Documento: a aprovacao nao pode mudar o conteudo (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW."aprovadoEm" IS DISTINCT FROM OLD."aprovadoEm" THEN
    RAISE EXCEPTION 'Documento: rascunho nao tem data de aprovacao (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documento_barreira_linha BEFORE UPDATE OR DELETE ON "Documento"
  FOR EACH ROW EXECUTE FUNCTION documento_imutavel();
CREATE TRIGGER documento_barreira_truncate BEFORE TRUNCATE ON "Documento"
  FOR EACH STATEMENT EXECUTE FUNCTION documento_imutavel();
