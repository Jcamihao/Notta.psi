-- Recifragem pelo dono (item 25, parte B): o comando `npm run recifrar` troca a chave de cada
-- valor cifrado para a chave atual, sem parar o sistema. O dono (praxis_owner) esta sujeito a
-- RLS FORCE, entao so enxerga/atualiza as linhas com a flag app.recifrar = '1' (ligada com
-- set_config(..., true) dentro da transacao do comando). praxis_app NAO ganha nada.
-- Excecao nos triggers: so o DONO da tabela, com a flag, e so a coluna cifrada muda.

-- 1) Policies do dono, so com a flag. Permissivas: somam com as policies de clinica existentes.
CREATE POLICY paciente_recifrar_select ON "Paciente" FOR SELECT TO praxis_owner
  USING (current_setting('app.recifrar', true) = '1');
CREATE POLICY paciente_recifrar_update ON "Paciente" FOR UPDATE TO praxis_owner
  USING (current_setting('app.recifrar', true) = '1')
  WITH CHECK (current_setting('app.recifrar', true) = '1');

CREATE POLICY documento_recifrar_select ON "Documento" FOR SELECT TO praxis_owner
  USING (current_setting('app.recifrar', true) = '1');
CREATE POLICY documento_recifrar_update ON "Documento" FOR UPDATE TO praxis_owner
  USING (current_setting('app.recifrar', true) = '1')
  WITH CHECK (current_setting('app.recifrar', true) = '1');

CREATE POLICY geracaoia_recifrar_select ON "GeracaoIa" FOR SELECT TO praxis_owner
  USING (current_setting('app.recifrar', true) = '1');
CREATE POLICY geracaoia_recifrar_update ON "GeracaoIa" FOR UPDATE TO praxis_owner
  USING (current_setting('app.recifrar', true) = '1')
  WITH CHECK (current_setting('app.recifrar', true) = '1');

-- 2) Documento: corpo de 20261106120000_geracao_ia mantido. Unica diferenca: dentro do ramo
--    APROVADO, o dono com a flag passa se a UNICA coluna que muda for conteudoCifrado (jsonb
--    compara todas as colunas; tudo o mais, inclusive status, aprovadoEm, atualizadoEm, igual).
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

-- 3) GeracaoIa: corpo de 20261106120000_geracao_ia mantido. Excecao no topo: o dono com a flag,
--    fora do PRONTO, troca EXATAMENTE UMA das duas cifradas (textoCifrado ou mapaCifrado) e nada
--    mais muda (identidade, estado, motivo, avisos, atualizadoEm... tudo igual).
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
