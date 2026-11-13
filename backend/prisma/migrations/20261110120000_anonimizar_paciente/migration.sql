-- Exclusao do paciente por ANONIMIZACAO (item 26, LGPD). Nao apaga linhas: o conteudo cifrado e
-- trocado por tombstones validos (cifrados com o AAD certo de cada linha, calculados no app), os
-- identificadores somem e `Paciente.excluidoEm` marca a exclusao. Quem executa e a funcao
-- `anonimizar_paciente` (SECURITY DEFINER, dona = praxis_owner): praxis_app so tem EXECUTE nela.
-- Triggers: a excecao de documento_imutavel e geracao_ia_barreira vale SO para o dono, com a flag
-- `app.anonimizando` ligada pela propria funcao, e SO para as colunas listadas. Os corpos de
-- documento_imutavel e geracao_ia_barreira abaixo sao os de 20261109120000_recifrar_dono; a unica
-- mudanca e a excecao nova no ramo APROVADO e no topo de geracao_ia_barreira.

-- 1) Coluna nova. praxis_app NAO ganha UPDATE nela: so a funcao escreve.
ALTER TABLE "Paciente" ADD COLUMN "excluidoEm" TIMESTAMP(3);

-- 2) Policies do dono, so com a flag (permissivas: somam com as de clinica existentes).
CREATE POLICY paciente_anonimizar_update ON "Paciente" FOR UPDATE TO praxis_owner
  USING (current_setting('app.anonimizando', true) = '1'
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
         AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK (current_setting('app.anonimizando', true) = '1'
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
         AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));

CREATE POLICY documento_anonimizar_update ON "Documento" FOR UPDATE TO praxis_owner
  USING (current_setting('app.anonimizando', true) = '1'
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
         AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK (current_setting('app.anonimizando', true) = '1'
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
         AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));

CREATE POLICY geracaoia_anonimizar_update ON "GeracaoIa" FOR UPDATE TO praxis_owner
  USING (current_setting('app.anonimizando', true) = '1'
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
         AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK (current_setting('app.anonimizando', true) = '1'
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
         AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));

-- 3) Trigger do Paciente: uma vez preenchida, excluidoEm nunca volta a NULL nem muda. Preencher
--    so pela funcao (flag ligada); o dono sem a flag nao marca exclusao.
CREATE FUNCTION paciente_excluido_barreira() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."excluidoEm" IS NOT NULL THEN
    IF NEW."excluidoEm" IS DISTINCT FROM OLD."excluidoEm" THEN
      RAISE EXCEPTION 'Paciente: excluidoEm e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW."excluidoEm" IS NOT NULL AND current_setting('app.anonimizando', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Paciente: exclusao so pela funcao anonimizar_paciente (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER paciente_excluido_barreira BEFORE UPDATE ON "Paciente"
  FOR EACH ROW EXECUTE FUNCTION paciente_excluido_barreira();

-- 4) Insert de linha nova de paciente excluido: barrado nas tabelas filhas. FOR SHARE: a insercao
--    espera uma anonimizacao concorrente (que pega FOR UPDATE/NO KEY UPDATE na linha do paciente)
--    e, depois dela, ve excluidoEm preenchido. Sem o lock, uma linha inserida logo antes do COMMIT
--    da anonimizacao sobreviveria com texto cifrado valido.
CREATE FUNCTION paciente_excluido_barreira_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_excluido timestamp(3);
BEGIN
  SELECT p."excluidoEm" INTO v_excluido FROM "Paciente" p
    WHERE p."id" = NEW."pacienteId" AND p."clinicaId" = NEW."clinicaId" AND p."psicologoId" = NEW."psicologoId"
    FOR SHARE;
  IF v_excluido IS NOT NULL THEN
    RAISE EXCEPTION 'Paciente excluido: insercao barrada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documento_paciente_excluido BEFORE INSERT ON "Documento"
  FOR EACH ROW EXECUTE FUNCTION paciente_excluido_barreira_insert();
CREATE TRIGGER geracaoia_paciente_excluido BEFORE INSERT ON "GeracaoIa"
  FOR EACH ROW EXECUTE FUNCTION paciente_excluido_barreira_insert();
CREATE TRIGGER consentimento_paciente_excluido BEFORE INSERT ON "Consentimento"
  FOR EACH ROW EXECUTE FUNCTION paciente_excluido_barreira_insert();
CREATE TRIGGER convite_paciente_excluido BEFORE INSERT ON "ConviteConsentimento"
  FOR EACH ROW EXECUTE FUNCTION paciente_excluido_barreira_insert();

-- 5) Documento: corpo de 20261109120000 mantido. Excecao nova no ramo APROVADO: o dono com a flag
--    `app.anonimizando` troca SO conteudoCifrado e zera dataSessao; todo o resto (status,
--    aprovadoEm, atualizadoEm...) fica igual.
CREATE OR REPLACE FUNCTION documento_imutavel() RETURNS trigger
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
    -- Recifragem (item 25, B): so o dono, com a flag, e so conteudoCifrado muda.
    IF current_setting('app.recifrar', true) = '1'
       AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID)
       AND (to_jsonb(NEW) - 'conteudoCifrado') = (to_jsonb(OLD) - 'conteudoCifrado') THEN
      RETURN NEW;
    END IF;
    -- Anonimizacao (item 26): so o dono, com a flag, so conteudoCifrado muda e dataSessao vira NULL.
    IF current_setting('app.anonimizando', true) = '1'
       AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID)
       AND NEW."dataSessao" IS NULL
       AND (to_jsonb(NEW) - 'conteudoCifrado' - 'dataSessao') = (to_jsonb(OLD) - 'conteudoCifrado' - 'dataSessao') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Documento aprovado e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."clinicaId" IS DISTINCT FROM OLD."clinicaId"
     OR NEW."psicologoId" IS DISTINCT FROM OLD."psicologoId"
     OR NEW."pacienteId" IS DISTINCT FROM OLD."pacienteId"
     OR NEW."tipo" IS DISTINCT FROM OLD."tipo"
     OR NEW."substituiId" IS DISTINCT FROM OLD."substituiId"
     OR NEW."geradoPorIa" IS DISTINCT FROM OLD."geradoPorIa" THEN
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

-- 6) GeracaoIa: corpo de 20261109120000 mantido. Excecao no topo: o dono com a flag
--    `app.anonimizando`, fora do PRONTO, troca textoCifrado e mapaCifrado e nada mais muda.
CREATE OR REPLACE FUNCTION geracao_ia_barreira() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.recifrar', true) = '1'
     AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID)
     AND OLD."estado" <> 'PRONTO'
     AND (to_jsonb(NEW) - 'textoCifrado' - 'mapaCifrado') = (to_jsonb(OLD) - 'textoCifrado' - 'mapaCifrado')
     AND ((NEW."textoCifrado" IS DISTINCT FROM OLD."textoCifrado")
          <> (NEW."mapaCifrado" IS DISTINCT FROM OLD."mapaCifrado")) THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.anonimizando', true) = '1'
     AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID)
     AND OLD."estado" <> 'PRONTO'
     AND (to_jsonb(NEW) - 'textoCifrado' - 'mapaCifrado') = (to_jsonb(OLD) - 'textoCifrado' - 'mapaCifrado') THEN
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."clinicaId" IS DISTINCT FROM OLD."clinicaId"
     OR NEW."psicologoId" IS DISTINCT FROM OLD."psicologoId"
     OR NEW."pacienteId" IS DISTINCT FROM OLD."pacienteId"
     OR NEW."origemId" IS DISTINCT FROM OLD."origemId"
     OR NEW."tipoDocumento" IS DISTINCT FROM OLD."tipoDocumento"
     OR NEW."abordagem" IS DISTINCT FROM OLD."abordagem"
     OR NEW."criadoEm" IS DISTINCT FROM OLD."criadoEm"
     OR NEW."expiraEm" IS DISTINCT FROM OLD."expiraEm" THEN
    RAISE EXCEPTION 'GeracaoIa: identidade e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD."estado" = 'PRONTO' THEN
    RAISE EXCEPTION 'GeracaoIa pronta e final (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT ((OLD."estado" IN ('PREVIA', 'FALHOU') AND NEW."estado" = 'PENDENTE')
          OR (OLD."estado" = 'PENDENTE' AND NEW."estado" IN ('PRONTO', 'FALHOU'))) THEN
    RAISE EXCEPTION 'GeracaoIa: transicao de estado invalida (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."estado" <> 'PRONTO'
     AND (NEW."textoCifrado" IS DISTINCT FROM OLD."textoCifrado"
          OR NEW."mapaCifrado" IS DISTINCT FROM OLD."mapaCifrado") THEN
    RAISE EXCEPTION 'GeracaoIa: o texto enviado a IA nao muda (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- 7) A funcao. SECURITY DEFINER (roda como praxis_owner, dono das tabelas, sob RLS FORCE) com
--    search_path fixo. Recusa paciente que nao e do psicologo do contexto (ou ja excluido) com o
--    MESMO erro do inexistente (no_data_found). Tudo numa transacao: quem chama ja abriu a
--    transacao com app.current_clinica_id e app.current_psicologo_id.
--    p_documentos: {id: cifra} de TODO documento do paciente (rascunho e aprovado).
--    p_geracoes:   {id: {texto, mapa}} de toda geracao do paciente que nao esta PRONTA.
--    Id faltando em qualquer um dos dois = erro (nada muda).
CREATE FUNCTION anonimizar_paciente(p_paciente text, p_nome text, p_documentos jsonb, p_geracoes jsonb)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_clinica text := NULLIF(current_setting('app.current_clinica_id', true), '');
  v_psicologo text := NULLIF(current_setting('app.current_psicologo_id', true), '');
  v_agora timestamptz := now();
  v_doc record;
  v_ger record;
  v_cifra text;
  v_texto text;
  v_mapa text;
BEGIN
  IF v_clinica IS NULL OR v_psicologo IS NULL OR p_paciente IS NULL OR p_nome IS NULL THEN
    RAISE EXCEPTION 'Paciente nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM 1 FROM "Paciente"
    WHERE "id" = p_paciente AND "clinicaId" = v_clinica AND "psicologoId" = v_psicologo AND "excluidoEm" IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  -- Liga a flag so por dentro da funcao; desliga no fim (a transacao do app segue sem ela).
  PERFORM set_config('app.anonimizando', '1', true);

  UPDATE "Paciente" SET
    "nomeCifrado" = p_nome,
    "nascimentoCifrado" = NULL,
    "telefoneCifrado" = NULL,
    "emailCifrado" = NULL,
    "excluidoEm" = v_agora,
    "atualizadoEm" = v_agora
  WHERE "id" = p_paciente;

  FOR v_doc IN
    SELECT "id" FROM "Documento"
    WHERE "pacienteId" = p_paciente AND "clinicaId" = v_clinica AND "psicologoId" = v_psicologo
    FOR UPDATE
  LOOP
    v_cifra := p_documentos ->> v_doc."id";
    IF v_cifra IS NULL THEN
      RAISE EXCEPTION 'Tombstone de documento ausente' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE "Documento" SET "conteudoCifrado" = v_cifra, "dataSessao" = NULL
      WHERE "id" = v_doc."id";
  END LOOP;

  FOR v_ger IN
    SELECT "id" FROM "GeracaoIa"
    WHERE "pacienteId" = p_paciente AND "clinicaId" = v_clinica AND "psicologoId" = v_psicologo
      AND "estado" <> 'PRONTO'
    FOR UPDATE
  LOOP
    IF jsonb_typeof(p_geracoes -> v_ger."id") IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Tombstone de geracao ausente' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_texto := p_geracoes -> v_ger."id" ->> 'texto';
    v_mapa := p_geracoes -> v_ger."id" ->> 'mapa';
    IF v_texto IS NULL OR v_mapa IS NULL THEN
      RAISE EXCEPTION 'Tombstone de geracao incompleto' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE "GeracaoIa" SET "textoCifrado" = v_texto, "mapaCifrado" = v_mapa
      WHERE "id" = v_ger."id";
  END LOOP;

  -- Convites ainda pendentes deixam de valer (estado final CANCELADO, com usadoEm).
  UPDATE "ConviteConsentimento" SET "estado" = 'CANCELADO', "usadoEm" = v_agora
    WHERE "pacienteId" = p_paciente AND "clinicaId" = v_clinica AND "psicologoId" = v_psicologo
      AND "estado" = 'PENDENTE';

  PERFORM set_config('app.anonimizando', '', true);
  RETURN v_agora;
END;
$$;

REVOKE ALL ON FUNCTION anonimizar_paciente(text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anonimizar_paciente(text, text, jsonb, jsonb) TO praxis_app;
