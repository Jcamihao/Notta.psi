-- Item 58: o ADMIN desativa um colega. Desativado nao entra mais (guard e login); pacientes,
-- documentos e trilha ficam guardados. Nunca reativa (nem o dono do banco, pelo trigger).

-- 1) Colunas. CHECK: desativado <=> tem data.
ALTER TABLE "Psicologo" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Psicologo" ADD COLUMN "desativadoEm" TIMESTAMP(3);
ALTER TABLE "Psicologo" ADD CONSTRAINT "Psicologo_ativo_desativadoEm_check"
  CHECK (("ativo" = false) = ("desativadoEm" IS NOT NULL));

-- 2) Grants por coluna, somados aos ja existentes.
GRANT UPDATE ("ativo", "desativadoEm") ON "Psicologo" TO praxis_app;

-- 3) INSERT: colega novo nasce ativo (ninguem insere ja desativado). Mesma policy da migration
--    20261031210000 com `"ativo"` a mais.
DROP POLICY tenant_isolation_insert ON "Psicologo";

CREATE POLICY tenant_isolation_insert ON "Psicologo" FOR INSERT
  WITH CHECK (
    "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
    AND "ativo"
    AND (
      ("papel" = 'PSICOLOGO' AND "senhaProvisoria" AND "tokenVersao" = 0)
      OR (
        "papel" = 'ADMIN' AND NOT "senhaProvisoria" AND "tokenVersao" = 0
        AND NOT EXISTS (
          SELECT 1 FROM "Psicologo" outro WHERE outro."clinicaId" = "Psicologo"."clinicaId"
        )
      )
    )
  );

-- 4) UPDATE de OUTRA pessoa: so o ADMIN ATIVO da mesma clinica, so em PSICOLOGO ativo que nao
--    e ele, e so para deixar de ser ativo. Permissiva: soma (OU) com psicologo_update_proprio.
--    O EXISTS le "Psicologo" pela policy de SELECT (so a clinica do contexto), sem recursao.
--    Quais colunas mudam: grant por coluna + trigger (so ativo/desativadoEm na linha alheia).
CREATE POLICY psicologo_desativar_colega ON "Psicologo" FOR UPDATE
  USING (
    "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
    AND "id" <> NULLIF(current_setting('app.current_psicologo_id', true), '')
    AND "papel" = 'PSICOLOGO' AND "ativo"
    AND EXISTS (
      SELECT 1 FROM "Psicologo" ator
      WHERE ator."id" = NULLIF(current_setting('app.current_psicologo_id', true), '')
        AND ator."clinicaId" = "Psicologo"."clinicaId"
        AND ator."papel" = 'ADMIN' AND ator."ativo"
    )
  )
  WITH CHECK (
    "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
    AND "id" <> NULLIF(current_setting('app.current_psicologo_id', true), '')
    AND "papel" = 'PSICOLOGO' AND NOT "ativo"
    AND EXISTS (
      SELECT 1 FROM "Psicologo" ator
      WHERE ator."id" = NULLIF(current_setting('app.current_psicologo_id', true), '')
        AND ator."clinicaId" = "Psicologo"."clinicaId"
        AND ator."papel" = 'ADMIN' AND ator."ativo"
    )
  );

-- 5) Trigger: regras anteriores (senhaProvisoria e tokenVersao) + as novas.
--    - `ativo`/`desativadoEm` so vao de true/NULL para false/data, e NUNCA voltam (vale para o
--      dono tambem). Esta regra vem antes da do proprio `ativo`, para a mensagem dizer o motivo.
--    - Ninguem muda o PROPRIO `ativo` (ator do contexto = a linha).
--    - Com outra pessoa no contexto (o ADMIN mexendo no colega), so `ativo`/`desativadoEm`
--      podem mudar: nome, abordagem, senha e versao do token do colega ficam como estao.
CREATE OR REPLACE FUNCTION psicologo_barreira_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ator text := NULLIF(current_setting('app.current_psicologo_id', true), '');
BEGIN
  IF NEW."senhaProvisoria" IS DISTINCT FROM OLD."senhaProvisoria" THEN
    IF NOT (OLD."senhaProvisoria" AND NOT NEW."senhaProvisoria"
            AND NEW."senhaHash" IS DISTINCT FROM OLD."senhaHash") THEN
      RAISE EXCEPTION 'senhaProvisoria so sai de true para false junto com nova senhaHash'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."tokenVersao" IS DISTINCT FROM OLD."tokenVersao" THEN
    IF NOT (NEW."tokenVersao" = OLD."tokenVersao" + 1
            AND NEW."senhaHash" IS DISTINCT FROM OLD."senhaHash") THEN
      RAISE EXCEPTION 'tokenVersao so sobe de 1 em 1 e junto com nova senhaHash'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."ativo" IS DISTINCT FROM OLD."ativo"
     OR NEW."desativadoEm" IS DISTINCT FROM OLD."desativadoEm" THEN
    IF NOT (OLD."ativo" AND NOT NEW."ativo" AND NEW."desativadoEm" IS NOT NULL) THEN
      RAISE EXCEPTION 'psicologo desativado nunca reativa: ativo so vai de true para false junto com desativadoEm'
        USING ERRCODE = 'check_violation';
    END IF;
    IF ator IS NOT DISTINCT FROM OLD."id" THEN
      RAISE EXCEPTION 'ninguem muda o proprio ativo'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF ator IS NOT NULL AND ator <> OLD."id" THEN
    IF NEW."nome" IS DISTINCT FROM OLD."nome"
       OR NEW."abordagemPadrao" IS DISTINCT FROM OLD."abordagemPadrao"
       OR NEW."senhaHash" IS DISTINCT FROM OLD."senhaHash"
       OR NEW."senhaProvisoria" IS DISTINCT FROM OLD."senhaProvisoria"
       OR NEW."tokenVersao" IS DISTINCT FROM OLD."tokenVersao" THEN
      RAISE EXCEPTION 'na linha de outra pessoa so ativo e desativadoEm mudam'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
