-- Retencao de RASCUNHO (item 52A). Rascunho sem edicao ha mais de N dias (`atualizadoEm` antes do
-- corte) e APAGADO de verdade pelo dono (praxis_owner), com a sua GeracaoIa ligada. Quem executa e o
-- comando `npm run descartar` (backend/src/ferramentas/descartar.ts); a funcao abaixo e o unico
-- caminho de descarte e guarda as regras no banco:
--  - so Documento RASCUNHO com atualizadoEm < corte. APROVADO nunca: o trigger documento_imutavel
--    (20261109120000) ja barra o DELETE de aprovado para todos os papeis, e a funcao filtra antes;
--  - pula rascunho com GeracaoIa PENDENTE (executor da IA em voo). A checagem repete sob lock;
--  - apaga as GeracaoIa ligadas (como origem OU como gerado) antes do Documento (FK RESTRICT);
--  - grava a auditoria DESCARTOU na MESMA transacao do DELETE;
--  - SKIP LOCKED: dois processos do comando nao apagam o mesmo rascunho nem falham.
-- praxis_app NAO ganha nada: sem EXECUTE, sem DELETE, sem SELECT novo. Os DELETEs usam as policies
-- do dono que ja existem (documento_dono_delete e geracaoia_dono_delete, so da clinica do contexto).
-- A flag `app.descartando` vale so na transacao e so para o dono; ela abre as leituras e a
-- auditoria do dono da clinica do contexto, e nada mais.

-- 1) Policies do dono, so com a flag e so da clinica do contexto (somam com as existentes).
CREATE POLICY documento_descartar_select ON "Documento" FOR SELECT TO praxis_owner
  USING (current_setting('app.descartando', true) = '1'
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

CREATE POLICY geracaoia_descartar_select ON "GeracaoIa" FOR SELECT TO praxis_owner
  USING (current_setting('app.descartando', true) = '1'
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

CREATE POLICY auditoria_descartar_insert ON "Auditoria" FOR INSERT TO praxis_owner
  WITH CHECK (current_setting('app.descartando', true) = '1'
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- Listar clinicas (so ids): a tabela Clinica so mostra a propria clinica do contexto, entao o
-- comando precisa de uma leitura de ids com a flag. Nada de nome sai daqui.
CREATE POLICY clinica_descartar_select ON "Clinica" FOR SELECT TO praxis_owner
  USING (current_setting('app.descartando', true) = '1');

-- 2) Lista de clinicas para o comando (so ids).
CREATE FUNCTION clinicas_para_descarte() RETURNS SETOF text
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM set_config('app.descartando', '1', true);
  RETURN QUERY SELECT c."id" FROM "Clinica" c ORDER BY c."id";
END;
$$;

-- 3) O descarte, de UMA clinica (a do contexto) e de no maximo p_lote rascunhos por chamada.
--    p_simular = true so conta (nada e gravado nem travado). Devolve contagens, nunca conteudo:
--    selecionados (rascunhos vencidos vistos), documentos (apagados), geracoes (apagadas).
--    Corte: `p_corte` e um instante; a comparacao usa UTC explicito, porque o fuso do servidor
--    de banco pode nao ser UTC e o Prisma grava timestamp sem fuso em UTC.
CREATE FUNCTION descartar_rascunhos_vencidos(p_corte timestamptz, p_lote integer, p_simular boolean)
RETURNS TABLE(selecionados integer, documentos integer, geracoes integer)
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_clinica text := NULLIF(current_setting('app.current_clinica_id', true), '');
  v_corte timestamp(3) := p_corte AT TIME ZONE 'UTC';
  v_doc record;
  v_ger record;
  v_ids text[];
  v_pendente boolean;
  v_apagadas integer;
  v_sel integer := 0;
  v_docs integer := 0;
  v_gers integer := 0;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Clinica nao informada' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_corte IS NULL OR p_lote IS NULL OR p_lote < 1 OR p_lote > 5000 OR p_simular IS NULL THEN
    RAISE EXCEPTION 'Parametros invalidos' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.descartando', '1', true);

  IF p_simular THEN
    RETURN QUERY
      WITH candidatos AS (
        SELECT d."id" FROM "Documento" d
        WHERE d."clinicaId" = v_clinica AND d."status" = 'RASCUNHO' AND d."atualizadoEm" < v_corte
          AND NOT EXISTS (SELECT 1 FROM "GeracaoIa" g
                          WHERE g."estado" = 'PENDENTE' AND (g."origemId" = d."id" OR g."documentoId" = d."id"))
      )
      SELECT (SELECT count(*) FROM candidatos)::integer,
             (SELECT count(*) FROM candidatos)::integer,
             (SELECT count(*) FROM "GeracaoIa" g
              WHERE g."origemId" IN (SELECT c."id" FROM candidatos c)
                 OR g."documentoId" IN (SELECT c."id" FROM candidatos c))::integer;
    RETURN;
  END IF;

  FOR v_doc IN
    SELECT d."id", d."clinicaId", d."psicologoId"
    FROM "Documento" d
    WHERE d."clinicaId" = v_clinica AND d."status" = 'RASCUNHO' AND d."atualizadoEm" < v_corte
      AND NOT EXISTS (SELECT 1 FROM "GeracaoIa" g
                      WHERE g."estado" = 'PENDENTE' AND (g."origemId" = d."id" OR g."documentoId" = d."id"))
    ORDER BY d."atualizadoEm", d."id"
    LIMIT p_lote
    FOR UPDATE OF d SKIP LOCKED
  LOOP
    v_sel := v_sel + 1;
    v_ids := ARRAY[]::text[];
    v_pendente := false;
    -- Trava as GeracaoIa ligadas: se um executor passou para PENDENTE na corrida, o rascunho fica.
    FOR v_ger IN
      SELECT g."id", g."estado" FROM "GeracaoIa" g
      WHERE g."origemId" = v_doc."id" OR g."documentoId" = v_doc."id"
      FOR UPDATE
    LOOP
      IF v_ger."estado" = 'PENDENTE' THEN
        v_pendente := true;
      END IF;
      v_ids := array_append(v_ids, v_ger."id");
    END LOOP;
    CONTINUE WHEN v_pendente;

    DELETE FROM "GeracaoIa" WHERE "id" = ANY(v_ids);
    GET DIAGNOSTICS v_apagadas = ROW_COUNT;
    v_gers := v_gers + v_apagadas;

    DELETE FROM "Documento" WHERE "id" = v_doc."id";
    GET DIAGNOSTICS v_apagadas = ROW_COUNT;
    -- Falha fechada: se o DELETE nao pegou exatamente a linha, a transacao inteira desfaz.
    IF v_apagadas <> 1 THEN
      RAISE EXCEPTION 'Descarte: documento nao apagado (lote desfeito)' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_docs := v_docs + 1;

    INSERT INTO "Auditoria" ("id", "clinicaId", "psicologoId", "acao", "recurso", "recursoId")
      VALUES (gen_random_uuid()::text, v_doc."clinicaId", v_doc."psicologoId", 'DESCARTOU', 'Documento', v_doc."id");
  END LOOP;

  PERFORM set_config('app.descartando', '', true);
  RETURN QUERY SELECT v_sel, v_docs, v_gers;
END;
$$;

-- 4) Privilegios: so o dono (dono da funcao, executa por padrao). PUBLIC e praxis_app ficam de fora.
REVOKE ALL ON FUNCTION clinicas_para_descarte() FROM PUBLIC;
REVOKE ALL ON FUNCTION clinicas_para_descarte() FROM praxis_app;
REVOKE ALL ON FUNCTION descartar_rascunhos_vencidos(timestamptz, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION descartar_rascunhos_vencidos(timestamptz, integer, boolean) FROM praxis_app;
