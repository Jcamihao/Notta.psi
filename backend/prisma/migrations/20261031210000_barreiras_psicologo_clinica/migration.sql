-- M-2 da 2a revisao da Fase 1.5: o banco segura sozinho o que antes so o codigo segurava
-- (papel, senha provisoria, versao do token, remocao e edicao de clinica).

-- 1) INSERT em Psicologo: alem da clinica no contexto, so entram
--    a) colega: papel PSICOLOGO, senha provisoria, tokenVersao 0 (o que a equipe cria);
--    b) o 1o ADMIN da clinica (cadastro de clinica): sem outro psicologo na clinica, senha
--       definitiva, tokenVersao 0.
--    O NOT EXISTS le "Psicologo" pela policy de SELECT (so a clinica do contexto), o que e
--    exatamente o escopo da checagem. Um colega nao cria ADMIN nem conta "nao provisoria".
DROP POLICY tenant_isolation_insert ON "Psicologo";

CREATE POLICY tenant_isolation_insert ON "Psicologo" FOR INSERT
  WITH CHECK (
    "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
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

-- 2) Sem DELETE de Psicologo para o app (a desativacao, item 58, tera caminho proprio).
--    A policy tenant_isolation_delete fica: sem o GRANT ela nao e alcancavel, e o caminho
--    novo nao precisa recria-la.
REVOKE DELETE ON "Psicologo" FROM notta_app;

-- 3) Clinica: nenhuma rota edita ou apaga clinica. SELECT e INSERT (cadastro) continuam.
REVOKE UPDATE, DELETE ON "Clinica" FROM notta_app;

-- 4) Trigger BEFORE UPDATE em Psicologo.
--    - senhaProvisoria so vai de true para false se senhaHash mudou na mesma instrucao;
--      nunca de false para true.
--    - tokenVersao so muda para OLD + 1, e so se senhaHash mudou na mesma instrucao.
--    nome e abordagemPadrao seguem livres. Funcao e trigger sao do owner (esta migration roda
--    como notta_owner); o app nao tem TRIGGER nem e dono, entao nao desliga nem troca
--    (session_replication_role exige superuser).
CREATE FUNCTION psicologo_barreira_update() RETURNS trigger
LANGUAGE plpgsql AS $$
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
  RETURN NEW;
END
$$;

CREATE TRIGGER psicologo_barreira_update BEFORE UPDATE ON "Psicologo"
  FOR EACH ROW EXECUTE FUNCTION psicologo_barreira_update();

-- 5) M-11 (lo_create): o REVOKE de lo_create/lo_creat FROM PUBLIC NAO cabe numa migration.
--    As funcoes sao do superuser e o notta_owner nao tem como revoga-las (o Postgres aceita o
--    comando e nao muda nada). Fica em prisma/bootstrap/endurecer-banco.sql, rodado UMA vez por
--    banco como superuser (ver README); test/acesso-psicologo.e2e-spec.ts confere o resultado.
