-- Termo de consentimento do paciente por link (item 22).
-- 1) ConviteConsentimento: link de uso unico e com prazo. So o SHA-256 do token fica no banco.
-- 2) Consentimento ganha `origem` (PSICOLOGO | PACIENTE) e `conviteId`.
-- O fluxo PUBLICO (paciente sem login) abre a linha pela policy `convite_por_token`, que compara
-- o hash com `app.convite_hash` (set_config so no TenantPrismaService). Somente ele aceita ou recusa.

-- CreateTable
CREATE TABLE "ConviteConsentimento" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "psicologoId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "termoVersao" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDENTE',
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usadoEm" TIMESTAMP(3),

    CONSTRAINT "ConviteConsentimento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConviteConsentimento_estado_check" CHECK ("estado" IN ('PENDENTE', 'ACEITO', 'RECUSADO', 'CANCELADO')),
    -- `usadoEm` = quando saiu de PENDENTE (aceite, recusa ou cancelamento).
    CONSTRAINT "ConviteConsentimento_usadoEm_check" CHECK (("estado" = 'PENDENTE') = ("usadoEm" IS NULL)),
    -- So hex de SHA-256: o token cru (base64url) nunca cabe nesta coluna.
    CONSTRAINT "ConviteConsentimento_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "ConviteConsentimento_tokenHash_key" ON "ConviteConsentimento"("tokenHash");

-- CreateIndex (alvo da FK de Consentimento.conviteId; inclui o dono)
CREATE UNIQUE INDEX "ConviteConsentimento_id_pacienteId_psicologoId_clinicaId_key" ON "ConviteConsentimento"("id", "pacienteId", "psicologoId", "clinicaId");

-- CreateIndex
CREATE INDEX "ConviteConsentimento_clinicaId_psicologoId_pacienteId_criad_idx" ON "ConviteConsentimento"("clinicaId", "psicologoId", "pacienteId", "criadoEm");

-- No maximo 1 convite PENDENTE por paciente, decidido pelo banco (corrida entre dois "Enviar
-- termo"). Inclui o dono: sem ele, o erro de unique (que ignora RLS) seria oraculo de existencia
-- de convite de paciente alheio.
CREATE UNIQUE INDEX "ConviteConsentimento_um_pendente_por_paciente" ON "ConviteConsentimento"("pacienteId", "psicologoId") WHERE "estado" = 'PENDENTE';

-- AddForeignKey (inclui o dono: paciente alheio e inexistente dao o MESMO erro)
ALTER TABLE "ConviteConsentimento" ADD CONSTRAINT "ConviteConsentimento_pacienteId_psicologoId_clinicaId_fkey" FOREIGN KEY ("pacienteId", "psicologoId", "clinicaId") REFERENCES "Paciente"("id", "psicologoId", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilegios: o notta_app le, cria e so muda `estado` e `usadoEm`. Sem DELETE.
REVOKE ALL ON "ConviteConsentimento" FROM notta_app;
GRANT SELECT, INSERT ON "ConviteConsentimento" TO notta_app;
GRANT UPDATE ("estado", "usadoEm") ON "ConviteConsentimento" TO notta_app;

ALTER TABLE "ConviteConsentimento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConviteConsentimento" FORCE ROW LEVEL SECURITY;

-- Psicologo (usuario logado): ve, cria e CANCELA so os proprios convites. Policies separadas (nao
-- `psicologo_proprio` FOR ALL) para o psicologo nao conseguir marcar ACEITO/RECUSADO: quem aceita
-- e so o fluxo publico, pelo hash.
CREATE POLICY convite_select_proprio ON "ConviteConsentimento" FOR SELECT
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));
CREATE POLICY convite_insert_proprio ON "ConviteConsentimento" FOR INSERT
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), '') AND "estado" = 'PENDENTE');
CREATE POLICY convite_cancelar_proprio ON "ConviteConsentimento" FOR UPDATE
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), '') AND "estado" = 'PENDENTE')
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), '') AND "estado" = 'CANCELADO');

-- Fluxo publico (paciente, sem login): so a linha do hash em `app.convite_hash`. Sem a variavel
-- (ou vazia) a comparacao nao casa nunca: ZERO linhas. UPDATE so PENDENTE -> ACEITO | RECUSADO.
CREATE POLICY convite_por_token_select ON "ConviteConsentimento" FOR SELECT
  USING ("tokenHash" = NULLIF(current_setting('app.convite_hash', true), ''));
CREATE POLICY convite_por_token_update ON "ConviteConsentimento" FOR UPDATE
  USING ("tokenHash" = NULLIF(current_setting('app.convite_hash', true), '') AND "estado" = 'PENDENTE')
  WITH CHECK ("tokenHash" = NULLIF(current_setting('app.convite_hash', true), '') AND "estado" IN ('ACEITO', 'RECUSADO'));

-- Policies so do notta_owner, so da clinica do contexto: sem elas o FORCE RLS faria o UPDATE/DELETE
-- do dono afetar 0 linhas e o trigger nunca dispararia (nem daria para limpar os dados de teste).
-- A barreira real e o trigger.
CREATE POLICY convite_dono_update ON "ConviteConsentimento" FOR UPDATE TO notta_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
CREATE POLICY convite_dono_delete ON "ConviteConsentimento" FOR DELETE TO notta_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- Trigger BEFORE UPDATE, vale para TODOS os papeis (o dono da tabela inclusive): identidade
-- imutavel; so PENDENTE -> ACEITO | RECUSADO | CANCELADO; estado final nao muda; `usadoEm`
-- obrigatorio ao sair de PENDENTE.
CREATE FUNCTION convite_consentimento_barreira() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."clinicaId" IS DISTINCT FROM OLD."clinicaId"
     OR NEW."psicologoId" IS DISTINCT FROM OLD."psicologoId"
     OR NEW."pacienteId" IS DISTINCT FROM OLD."pacienteId"
     OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
     OR NEW."termoVersao" IS DISTINCT FROM OLD."termoVersao"
     OR NEW."expiraEm" IS DISTINCT FROM OLD."expiraEm"
     OR NEW."criadoEm" IS DISTINCT FROM OLD."criadoEm" THEN
    RAISE EXCEPTION 'ConviteConsentimento: identidade e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD."estado" <> 'PENDENTE' THEN
    RAISE EXCEPTION 'ConviteConsentimento: estado final e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."estado" NOT IN ('ACEITO', 'RECUSADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'ConviteConsentimento: transicao de estado invalida (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."usadoEm" IS NULL THEN
    RAISE EXCEPTION 'ConviteConsentimento: usadoEm e obrigatorio ao sair de PENDENTE (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER convite_consentimento_barreira BEFORE UPDATE ON "ConviteConsentimento"
  FOR EACH ROW EXECUTE FUNCTION convite_consentimento_barreira();

-- Consentimento: origem e convite. Continua somente-acrescentar (o trigger
-- consentimento_somente_acrescentar barra todo UPDATE/DELETE/TRUNCATE; as colunas novas nao mudam isso).
ALTER TABLE "Consentimento" ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'PSICOLOGO';
ALTER TABLE "Consentimento" ADD COLUMN "conviteId" TEXT;
ALTER TABLE "Consentimento" ADD CONSTRAINT "Consentimento_origem_check" CHECK ("origem" IN ('PSICOLOGO', 'PACIENTE'));
-- PACIENTE <=> veio de um convite.
ALTER TABLE "Consentimento" ADD CONSTRAINT "Consentimento_origem_convite_check" CHECK (("origem" = 'PACIENTE') = ("conviteId" IS NOT NULL));

-- Um convite gera no maximo UM evento (clique duplo, duas abas). Inclui o dono (mesmo motivo do
-- unique de seq: o erro de unique ignora RLS).
CREATE UNIQUE INDEX "Consentimento_conviteId_pacienteId_psicologoId_key" ON "Consentimento"("conviteId", "pacienteId", "psicologoId");

ALTER TABLE "Consentimento" ADD CONSTRAINT "Consentimento_conviteId_pacienteId_psicologoId_clinicaId_fkey" FOREIGN KEY ("conviteId", "pacienteId", "psicologoId", "clinicaId") REFERENCES "ConviteConsentimento"("id", "pacienteId", "psicologoId", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evento com origem PACIENTE so nasce no fluxo publico: exige CONCEDIDO e um convite ACEITO cujo
-- hash e o `app.convite_hash` da transacao. Policy RESTRITIVA (soma com E, nao com OU): vale junto
-- com `psicologo_proprio`, que continua igual. O psicologo, por mais que tente, nao forja
-- "aceito pelo paciente" (e a ordem e fixa: primeiro o convite vira ACEITO, depois o evento).
CREATE POLICY consentimento_origem_paciente ON "Consentimento" AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    "origem" = 'PSICOLOGO'
    OR ("evento" = 'CONCEDIDO' AND EXISTS (
      SELECT 1 FROM "ConviteConsentimento" c
      WHERE c."id" = "conviteId"
        AND c."tokenHash" = NULLIF(current_setting('app.convite_hash', true), '')
        AND c."estado" = 'ACEITO'
    ))
  );
