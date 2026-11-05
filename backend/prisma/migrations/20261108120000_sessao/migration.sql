-- Sessao segura (itens 46 e 49, back): cada linha e UMA geracao do token de refresh. Um login cria
-- a primeira linha de uma `familia`; cada renovacao marca a linha usada (`usadoEm`) e cria outra da
-- MESMA familia. `id` e o `sid` do JWT de acesso. So o SHA-256 do refresh fica no banco.
-- A renovacao roda sem sessao: abre a linha pela policy `sessao_por_hash` (app.refresh_hash, so no
-- TenantPrismaService), no mesmo molde de `convite_por_token` e `login_lookup`.

-- CreateTable
CREATE TABLE "Sessao" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "psicologoId" TEXT NOT NULL,
    "familia" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL,
    "ultimoUsoEm" TIMESTAMP(3) NOT NULL,
    "absolutaAte" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "revogadaEm" TIMESTAMP(3),
    "motivoRevogacao" TEXT,

    CONSTRAINT "Sessao_pkey" PRIMARY KEY ("id"),
    -- So hex de SHA-256: o refresh cru (base64url) nunca cabe nesta coluna.
    CONSTRAINT "Sessao_refreshHash_check" CHECK ("refreshHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "Sessao_motivo_check" CHECK ("motivoRevogacao" IN ('SAIU', 'SAIU_DE_TODOS', 'REUSO', 'EXPIROU', 'SENHA_TROCADA')),
    CONSTRAINT "Sessao_revogada_motivo_check" CHECK (("revogadaEm" IS NULL) = ("motivoRevogacao" IS NULL)),
    -- Limite absoluto de 7 dias desde o login da familia: o banco recusa linha com prazo maior.
    -- (A linha rotacionada herda o `absolutaAte` do login, entao fica sempre dentro do limite.)
    CONSTRAINT "Sessao_absoluta_check" CHECK ("absolutaAte" <= "criadoEm" + interval '7 days')
);

-- CreateIndex
CREATE UNIQUE INDEX "Sessao_refreshHash_key" ON "Sessao"("refreshHash");

-- CreateIndex
CREATE INDEX "Sessao_clinicaId_psicologoId_idx" ON "Sessao"("clinicaId", "psicologoId");

-- CreateIndex
CREATE INDEX "Sessao_familia_idx" ON "Sessao"("familia");

-- AddForeignKey (composta: a linha e do dono E da clinica dele)
ALTER TABLE "Sessao" ADD CONSTRAINT "Sessao_psicologoId_clinicaId_fkey" FOREIGN KEY ("psicologoId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilegios: o notta_app cria, le e so muda quando usou, revogou e o ultimo uso. Sem DELETE
-- (retencao dessas linhas e o item 52).
REVOKE ALL ON "Sessao" FROM notta_app;
GRANT SELECT, INSERT ON "Sessao" TO notta_app;
GRANT UPDATE ("ultimoUsoEm", "usadoEm", "revogadaEm", "motivoRevogacao") ON "Sessao" TO notta_app;

ALTER TABLE "Sessao" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sessao" FORCE ROW LEVEL SECURITY;

-- Psicologo logado: ve, cria e atualiza so as PROPRIAS sessoes (listar, revogar, conferir no guard).
-- INSERT so nasce ativa (nem usada nem revogada).
CREATE POLICY sessao_select_proprio ON "Sessao" FOR SELECT
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));
CREATE POLICY sessao_insert_proprio ON "Sessao" FOR INSERT
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), '') AND "usadoEm" IS NULL AND "revogadaEm" IS NULL);
CREATE POLICY sessao_update_proprio ON "Sessao" FOR UPDATE
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));

-- Renovacao (sem sessao): so a linha cujo refreshHash e o `app.refresh_hash` da transacao, so SELECT.
-- Sem a variavel (ou vazia) a comparacao nao casa nunca: ZERO linhas. Depois de achar a linha, quem
-- renova assume o dono (clinica e psicologo LIDOS DA LINHA) e as policies proprias valem.
CREATE POLICY sessao_por_hash ON "Sessao" FOR SELECT
  USING ("refreshHash" = NULLIF(current_setting('app.refresh_hash', true), ''));

-- Policies so do notta_owner, so da clinica do contexto: sem elas o FORCE RLS faria o UPDATE/DELETE
-- do dono afetar 0 linhas e o trigger nunca dispararia (nem daria para limpar dados de teste).
CREATE POLICY sessao_dono_update ON "Sessao" FOR UPDATE TO notta_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
CREATE POLICY sessao_dono_delete ON "Sessao" FOR DELETE TO notta_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- Trigger BEFORE UPDATE, vale para TODOS os papeis (o dono da tabela inclusive): identidade imutavel;
-- sessao revogada nao muda mais (nao revive); `usadoEm` nao volta a NULL nem muda.
CREATE FUNCTION sessao_barreira() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."clinicaId" IS DISTINCT FROM OLD."clinicaId"
     OR NEW."psicologoId" IS DISTINCT FROM OLD."psicologoId"
     OR NEW."familia" IS DISTINCT FROM OLD."familia"
     OR NEW."refreshHash" IS DISTINCT FROM OLD."refreshHash"
     OR NEW."criadoEm" IS DISTINCT FROM OLD."criadoEm"
     OR NEW."absolutaAte" IS DISTINCT FROM OLD."absolutaAte" THEN
    RAISE EXCEPTION 'Sessao: identidade e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD."revogadaEm" IS NOT NULL THEN
    RAISE EXCEPTION 'Sessao: sessao revogada e final (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD."usadoEm" IS NOT NULL AND NEW."usadoEm" IS DISTINCT FROM OLD."usadoEm" THEN
    RAISE EXCEPTION 'Sessao: refresh ja usado nao volta a valer (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sessao_barreira BEFORE UPDATE ON "Sessao"
  FOR EACH ROW EXECUTE FUNCTION sessao_barreira();
