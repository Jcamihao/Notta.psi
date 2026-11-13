-- Transferencia de pacientes de um psicologo DESATIVADO para outro ativo (item 67, back). DUAS
-- AUTORIZACOES: o ADMIN da clinica CRIA o pedido; o DESTINO aceita ou recusa; o DESTINO executa, em
-- lotes. Maquina de estados do PEDIDO (PedidoTransferencia): PENDENTE -> ACEITO | RECUSADO | CANCELADO;
-- ACEITO -> ACEITO so para preencher concluidoEm uma vez. Estados finais imutaveis, sem DELETE.
--
-- Quem escreve: SO as funcoes SECURITY DEFINER (dona = praxis_owner). praxis_app tem SELECT na tabela
-- e EXECUTE nas funcoes; nada de INSERT/UPDATE/DELETE direto. Toda funcao le ator e clinica do
-- contexto (app.current_clinica_id, app.current_psicologo_id) e reconfere, NO BANCO, papel e `ativo`
-- (nunca confia so no JWT). Falha de autorizacao, inexistencia, outra clinica ou estado invalido =
-- o MESMO erro (P0002 no_data_found, 'Pedido nao encontrado').
--
-- Movimento de pacientes: a funcao troca as colunas cifradas (o app recifra em memoria com o AAD novo)
-- e DEPOIS muda Paciente.psicologoId. As FKs filhas (Documento, GeracaoIa, Consentimento,
-- ConviteConsentimento) sao ON UPDATE CASCADE, entao a cascata leva tudo junto. Essa cascata passa pelos
-- triggers que barram UPDATE (imutabilidade de documento e geracao, somente-acrescentar de consentimento,
-- identidade de convite). Cada um ganhou UMA excecao estreita, abaixo: so o DONO da tabela, so com a
-- flag `app.transferindo` ligada (dentro destas funcoes), e so se a UNICA mudanca for psicologoId
-- (inalterado ou igual ao destino da flag) mais as colunas cifradas listadas. Fora disso, barrado.
--
-- Datas: gravadas em UTC naive (timestamp(3)), como em descartar_rascunhos_vencidos.
-- Flag `app.transferindo`: '1' em leituras e pedido; o id do destino em transferencia_aplicar. O valor
-- do destino e o que deixa a cascata entrar. Ao fim de cada funcao volta a ''.

-- 1) Tabela. id = uuid gerado no app. Um pedido por linha; estado com CHECK.
CREATE TABLE "PedidoTransferencia" (
    "id" UUID NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "origemId" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "decididoEm" TIMESTAMP(3),
    "decididoPorId" TEXT,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "PedidoTransferencia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PedidoTransferencia_estado_check" CHECK ("estado" IN ('PENDENTE', 'ACEITO', 'RECUSADO', 'CANCELADO')),
    CONSTRAINT "PedidoTransferencia_origem_destino_check" CHECK ("origemId" <> "destinoId"),
    -- Validade de 14 dias, fixa no banco.
    CONSTRAINT "PedidoTransferencia_expiracao_check" CHECK ("expiraEm" = "criadoEm" + interval '14 days'),
    -- Decidido (com quem) <=> saiu de PENDENTE.
    CONSTRAINT "PedidoTransferencia_decisao_check" CHECK (("estado" = 'PENDENTE') = ("decididoEm" IS NULL)),
    CONSTRAINT "PedidoTransferencia_decisor_check" CHECK (("decididoEm" IS NULL) = ("decididoPorId" IS NULL)),
    -- Concluido so existe em ACEITO.
    CONSTRAINT "PedidoTransferencia_concluido_check" CHECK ("concluidoEm" IS NULL OR "estado" = 'ACEITO')
);

-- Um unico pedido ABERTO por origem (PENDENTE, ou ACEITO ainda nao concluido). Indice unico parcial:
-- o banco recusa o segundo mesmo se duas requisicoes corrersem.
CREATE UNIQUE INDEX "PedidoTransferencia_origem_aberta_key" ON "PedidoTransferencia"("origemId")
  WHERE "concluidoEm" IS NULL AND "estado" IN ('PENDENTE', 'ACEITO');
CREATE INDEX "PedidoTransferencia_clinicaId_destinoId_idx" ON "PedidoTransferencia"("clinicaId", "destinoId");

-- FKs compostas com o psicologo da mesma clinica (origem, destino, criador e decisor). RESTRICT:
-- nada apaga psicologo com pedido.
ALTER TABLE "PedidoTransferencia" ADD CONSTRAINT "PedidoTransferencia_origemId_clinicaId_fkey" FOREIGN KEY ("origemId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PedidoTransferencia" ADD CONSTRAINT "PedidoTransferencia_destinoId_clinicaId_fkey" FOREIGN KEY ("destinoId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PedidoTransferencia" ADD CONSTRAINT "PedidoTransferencia_criadoPorId_clinicaId_fkey" FOREIGN KEY ("criadoPorId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PedidoTransferencia" ADD CONSTRAINT "PedidoTransferencia_decididoPorId_clinicaId_fkey" FOREIGN KEY ("decididoPorId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilegios: o runtime so le (a policy filtra). O default de privilegios do schema da um ALL ao
-- praxis_app em toda tabela nova: aqui ele e revogado de proposito.
REVOKE ALL ON "PedidoTransferencia" FROM praxis_app;
GRANT SELECT ON "PedidoTransferencia" TO praxis_app;

ALTER TABLE "PedidoTransferencia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PedidoTransferencia" FORCE ROW LEVEL SECURITY;

-- Leitura: mesma clinica do contexto E (o chamador e o destino OU o chamador e ADMIN ativo da clinica).
-- Vale tambem para o dono quando a funcao roda com o contexto do chamador (SECURITY DEFINER nao troca o
-- contexto), entao a lista so mostra o que o chamador pode ver.
CREATE POLICY pedido_transferencia_select ON "PedidoTransferencia" FOR SELECT
  USING (
    "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '')
    AND (
      "destinoId" = NULLIF(current_setting('app.current_psicologo_id', true), '')
      OR EXISTS (
        SELECT 1 FROM "Psicologo" a
        WHERE a."id" = NULLIF(current_setting('app.current_psicologo_id', true), '')
          AND a."clinicaId" = "PedidoTransferencia"."clinicaId"
          AND a."papel" = 'ADMIN' AND a."ativo"
      )
    )
  );

-- Escrita: so o dono, so com a flag, so da clinica do contexto. Sem elas o FORCE RLS faria o UPDATE/INSERT
-- do dono afetar 0 linhas. A barreira real e o trigger abaixo.
CREATE POLICY pedido_transferencia_transferir_insert ON "PedidoTransferencia" FOR INSERT TO praxis_owner
  WITH CHECK (coalesce(current_setting('app.transferindo', true), '') <> ''
              AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
CREATE POLICY pedido_transferencia_transferir_update ON "PedidoTransferencia" FOR UPDATE TO praxis_owner
  USING (coalesce(current_setting('app.transferindo', true), '') <> ''
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''))
  WITH CHECK (coalesce(current_setting('app.transferindo', true), '') <> ''
              AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
-- DELETE: so o dono, so da clinica; o trigger barra tudo, salvo a limpeza das suites (flag de teste).
CREATE POLICY pedido_transferencia_dono_delete ON "PedidoTransferencia" FOR DELETE TO praxis_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- 2) Excecao de cascata (usada pelos triggers abaixo). Verdadeira SO quando: a flag `app.transferindo`
--    esta ligada, quem roda e o DONO da tabela, e o psicologoId novo e o antigo ou o destino da flag.
--    SECURITY INVOKER de proposito: current_user tem que ser o do chamador (o RI roda como dono).
CREATE FUNCTION transferencia_excecao(p_rel oid, p_old_psicologo text, p_new_psicologo text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.transferindo', true), '') <> ''
    AND current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = p_rel)
    AND (p_new_psicologo = p_old_psicologo OR p_new_psicologo = current_setting('app.transferindo', true))
$$;

-- Helpers de autorizacao (lidos do banco). Chamados pelas funcoes SECURITY DEFINER (dono).
CREATE FUNCTION transferencia_papel_ativo(p_clinica text, p_psicologo text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p."papel"::text FROM "Psicologo" p
  WHERE p_clinica IS NOT NULL AND p_psicologo IS NOT NULL
    AND p."id" = p_psicologo AND p."clinicaId" = p_clinica AND p."ativo"
$$;

-- Origem: psicologo (nao ADMIN) DESATIVADO da clinica. Destino: ativo da mesma clinica. Diferentes.
CREATE FUNCTION transferencia_par_valido(p_clinica text, p_origem text, p_destino text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_clinica IS NOT NULL AND p_origem IS NOT NULL AND p_destino IS NOT NULL
    AND p_origem <> p_destino
    AND EXISTS (SELECT 1 FROM "Psicologo" o WHERE o."id" = p_origem AND o."clinicaId" = p_clinica
                AND o."papel" = 'PSICOLOGO' AND NOT o."ativo")
    AND EXISTS (SELECT 1 FROM "Psicologo" d WHERE d."id" = p_destino AND d."clinicaId" = p_clinica
                AND d."ativo")
$$;

-- Valor cifrado de um campo do lote: o payload traz nulo SO onde o banco tem nulo, e string onde o banco
-- tem valor. Falta ou sobra = falso (a funcao chamadora barra).
CREATE FUNCTION transferencia_campo_ok(p_valor jsonb, p_atual text, p_anulavel boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_valor IS NULL OR jsonb_typeof(p_valor) = 'null' THEN p_anulavel AND p_atual IS NULL
    ELSE jsonb_typeof(p_valor) = 'string' AND p_atual IS NOT NULL AND length(p_valor #>> '{}') > 0
  END
$$;

-- 3) Triggers de imutabilidade: cada um so ganha a excecao de cascata. Corpos de 20261110120000 mantidos.

-- 3a) Documento: UPDATE com so psicologoId (cascata/transferencia) e conteudoCifrado mudando, pelo dono com a flag.
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

  -- Transferencia (item 67): so o dono, com a flag, so psicologoId e conteudoCifrado mudam.
  IF transferencia_excecao(TG_RELID, OLD."psicologoId", NEW."psicologoId")
     AND (to_jsonb(NEW) - 'psicologoId' - 'conteudoCifrado') = (to_jsonb(OLD) - 'psicologoId' - 'conteudoCifrado') THEN
    RETURN NEW;
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

-- 3b) GeracaoIa: UPDATE com so psicologoId e os cifrados mudando, pelo dono com a flag, fora do PENDENTE.
--     Corpo de 20261110120000 mantido, com a excecao no topo.
CREATE OR REPLACE FUNCTION geracao_ia_barreira() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF transferencia_excecao(TG_RELID, OLD."psicologoId", NEW."psicologoId")
     AND OLD."estado" <> 'PENDENTE'
     AND (to_jsonb(NEW) - 'psicologoId' - 'textoCifrado' - 'mapaCifrado') = (to_jsonb(OLD) - 'psicologoId' - 'textoCifrado' - 'mapaCifrado') THEN
    RETURN NEW;
  END IF;

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

-- 3c) Consentimento: somente-acrescentar. Excecao SO de psicologoId (cascata), so para o dono com a flag.
CREATE OR REPLACE FUNCTION consentimento_somente_acrescentar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND transferencia_excecao(TG_RELID, OLD."psicologoId", NEW."psicologoId")
     AND (to_jsonb(NEW) - 'psicologoId') = (to_jsonb(OLD) - 'psicologoId') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE'
     AND current_setting('app.limpeza_de_teste', true) = '1'
     AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Consentimento e somente-acrescentar (% barrado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- 3d) ConviteConsentimento: identidade e estado final. Excecao SO de psicologoId (cascata), so para o dono
--     com a flag. A cancelacao dos PENDENTES no lote (PENDENTE -> CANCELADO com usadoEm) passa pelo caminho
--     normal, sem excecao.
CREATE OR REPLACE FUNCTION convite_consentimento_barreira() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF transferencia_excecao(TG_RELID, OLD."psicologoId", NEW."psicologoId")
     AND (to_jsonb(NEW) - 'psicologoId') = (to_jsonb(OLD) - 'psicologoId') THEN
    RETURN NEW;
  END IF;

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

-- 3e) Pedido: maquina de estados e identidade. Sem excecao de cascata (ninguem o move).
CREATE FUNCTION pedido_transferencia_barreira() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'PedidoTransferencia nao pode ser truncado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- So a limpeza das suites (flag de teste, dono da tabela). Nunca o runtime.
    IF current_setting('app.limpeza_de_teste', true) = '1'
       AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'PedidoTransferencia nao pode ser apagado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."clinicaId" IS DISTINCT FROM OLD."clinicaId"
     OR NEW."origemId" IS DISTINCT FROM OLD."origemId"
     OR NEW."destinoId" IS DISTINCT FROM OLD."destinoId"
     OR NEW."criadoPorId" IS DISTINCT FROM OLD."criadoPorId"
     OR NEW."criadoEm" IS DISTINCT FROM OLD."criadoEm"
     OR NEW."expiraEm" IS DISTINCT FROM OLD."expiraEm" THEN
    RAISE EXCEPTION 'PedidoTransferencia: identidade e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD."estado" IN ('RECUSADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'PedidoTransferencia: estado final e imutavel (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD."estado" = 'PENDENTE' THEN
    IF NEW."estado" NOT IN ('ACEITO', 'RECUSADO', 'CANCELADO') OR NEW."concluidoEm" IS NOT NULL THEN
      RAISE EXCEPTION 'PedidoTransferencia: transicao de estado invalida (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    -- ACEITO: so preenche concluidoEm, uma vez. Decisao nao muda.
    IF NEW."estado" <> 'ACEITO'
       OR NEW."decididoEm" IS DISTINCT FROM OLD."decididoEm"
       OR NEW."decididoPorId" IS DISTINCT FROM OLD."decididoPorId"
       OR (OLD."concluidoEm" IS NOT NULL AND NEW."concluidoEm" IS DISTINCT FROM OLD."concluidoEm") THEN
      RAISE EXCEPTION 'PedidoTransferencia: transicao de estado invalida (UPDATE barrado)' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER pedido_transferencia_barreira_linha BEFORE UPDATE OR DELETE ON "PedidoTransferencia"
  FOR EACH ROW EXECUTE FUNCTION pedido_transferencia_barreira();
CREATE TRIGGER pedido_transferencia_barreira_truncate BEFORE TRUNCATE ON "PedidoTransferencia"
  FOR EACH STATEMENT EXECUTE FUNCTION pedido_transferencia_barreira();

-- 4) Policies do dono, so com a flag e so da clinica do contexto, para as leituras e escritas do lote
--    (somam com as policies de clinica/psicologo que ja existem).
CREATE POLICY paciente_transferir_select ON "Paciente" FOR SELECT TO praxis_owner
  USING (coalesce(current_setting('app.transferindo', true), '') <> ''
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
CREATE POLICY paciente_transferir_update ON "Paciente" FOR UPDATE TO praxis_owner
  USING (coalesce(current_setting('app.transferindo', true), '') <> ''
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''))
  WITH CHECK (coalesce(current_setting('app.transferindo', true), '') <> ''
              AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

CREATE POLICY documento_transferir_select ON "Documento" FOR SELECT TO praxis_owner
  USING (coalesce(current_setting('app.transferindo', true), '') <> ''
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
CREATE POLICY documento_transferir_update ON "Documento" FOR UPDATE TO praxis_owner
  USING (coalesce(current_setting('app.transferindo', true), '') <> ''
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''))
  WITH CHECK (coalesce(current_setting('app.transferindo', true), '') <> ''
              AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

CREATE POLICY geracaoia_transferir_select ON "GeracaoIa" FOR SELECT TO praxis_owner
  USING (coalesce(current_setting('app.transferindo', true), '') <> ''
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
-- Convite: o UPDATE do cancelamento (PENDENTE -> CANCELADO) casa linhas do ORIGEM com o contexto do
-- DESTINO. Sem esta policy de SELECT, o scan do UPDATE nao acha nenhuma linha (silencioso: 0 linhas).
CREATE POLICY convite_transferir_select ON "ConviteConsentimento" FOR SELECT TO praxis_owner
  USING (coalesce(current_setting('app.transferindo', true), '') <> ''
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

CREATE POLICY geracaoia_transferir_update ON "GeracaoIa" FOR UPDATE TO praxis_owner
  USING (coalesce(current_setting('app.transferindo', true), '') <> ''
         AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''))
  WITH CHECK (coalesce(current_setting('app.transferindo', true), '') <> ''
              AND "clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- 5) Funcoes. Todas SECURITY DEFINER (dona = praxis_owner), search_path fixo, EXECUTE so para praxis_app.
--    Erro de autorizacao / inexistencia / estado = P0002 'Pedido nao encontrado' (mesmo para tudo).

-- 5a) Criar: chamador = ADMIN ativo; origem desativada; destino ativo; origem com paciente vivo; sem
--     outro pedido aberto da origem. Estado PENDENTE, expiraEm = criadoEm + 14 dias.
CREATE FUNCTION pedido_transferencia_criar(p_id uuid, p_origem text, p_destino text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_clinica text := NULLIF(current_setting('app.current_clinica_id', true), '');
  v_ator text := NULLIF(current_setting('app.current_psicologo_id', true), '');
  v_agora timestamp(3) := (now() AT TIME ZONE 'UTC');
BEGIN
  PERFORM set_config('app.transferindo', '1', true);
  IF p_id IS NULL
     OR transferencia_papel_ativo(v_clinica, v_ator) IS DISTINCT FROM 'ADMIN'
     OR NOT transferencia_par_valido(v_clinica, p_origem, p_destino) THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Paciente" p WHERE p."psicologoId" = p_origem AND p."clinicaId" = v_clinica AND p."excluidoEm" IS NULL) THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM "PedidoTransferencia" q WHERE q."origemId" = p_origem AND q."clinicaId" = v_clinica
             AND q."concluidoEm" IS NULL AND q."estado" IN ('PENDENTE', 'ACEITO')) THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO "PedidoTransferencia" ("id", "clinicaId", "origemId", "destinoId", "criadoPorId", "estado",
                                     "criadoEm", "expiraEm")
    VALUES (p_id, v_clinica, p_origem, p_destino, v_ator, 'PENDENTE', v_agora, v_agora + interval '14 days');
  PERFORM set_config('app.transferindo', '', true);
END;
$$;

-- 5b) Aceitar / recusar: chamador = o DESTINO do pedido, PENDENTE e nao vencido, origem ainda desativada,
--     destino ainda ativo. Quem nao e o destino recebe o mesmo P0002 (o pedido nem aparece para ele).
CREATE FUNCTION pedido_transferencia_aceitar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_clinica text := NULLIF(current_setting('app.current_clinica_id', true), '');
  v_ator text := NULLIF(current_setting('app.current_psicologo_id', true), '');
  v_agora timestamp(3) := (now() AT TIME ZONE 'UTC');
  r record;
BEGIN
  PERFORM set_config('app.transferindo', '1', true);
  SELECT * INTO r FROM "PedidoTransferencia" q
    WHERE q."id" = p_id AND q."clinicaId" = v_clinica AND q."destinoId" = v_ator AND q."estado" = 'PENDENTE'
    FOR UPDATE;
  IF NOT FOUND OR r."expiraEm" <= v_agora
     OR transferencia_papel_ativo(v_clinica, v_ator) IS NULL
     OR NOT transferencia_par_valido(v_clinica, r."origemId", r."destinoId") THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE "PedidoTransferencia" SET "estado" = 'ACEITO', "decididoEm" = v_agora, "decididoPorId" = v_ator
    WHERE "id" = p_id;
  PERFORM set_config('app.transferindo', '', true);
END;
$$;

CREATE FUNCTION pedido_transferencia_recusar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_clinica text := NULLIF(current_setting('app.current_clinica_id', true), '');
  v_ator text := NULLIF(current_setting('app.current_psicologo_id', true), '');
  v_agora timestamp(3) := (now() AT TIME ZONE 'UTC');
  r record;
BEGIN
  PERFORM set_config('app.transferindo', '1', true);
  SELECT * INTO r FROM "PedidoTransferencia" q
    WHERE q."id" = p_id AND q."clinicaId" = v_clinica AND q."destinoId" = v_ator AND q."estado" = 'PENDENTE'
    FOR UPDATE;
  IF NOT FOUND OR r."expiraEm" <= v_agora
     OR transferencia_papel_ativo(v_clinica, v_ator) IS NULL
     OR NOT transferencia_par_valido(v_clinica, r."origemId", r."destinoId") THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE "PedidoTransferencia" SET "estado" = 'RECUSADO', "decididoEm" = v_agora, "decididoPorId" = v_ator
    WHERE "id" = p_id;
  PERFORM set_config('app.transferindo', '', true);
END;
$$;

-- 5c) Cancelar: chamador = ADMIN ativo da clinica; pedido PENDENTE (vencido tambem: o ADMIN pode limpar).
CREATE FUNCTION pedido_transferencia_cancelar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_clinica text := NULLIF(current_setting('app.current_clinica_id', true), '');
  v_ator text := NULLIF(current_setting('app.current_psicologo_id', true), '');
  v_agora timestamp(3) := (now() AT TIME ZONE 'UTC');
  r record;
BEGIN
  PERFORM set_config('app.transferindo', '1', true);
  IF transferencia_papel_ativo(v_clinica, v_ator) IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO r FROM "PedidoTransferencia" q
    WHERE q."id" = p_id AND q."clinicaId" = v_clinica AND q."estado" = 'PENDENTE'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE "PedidoTransferencia" SET "estado" = 'CANCELADO', "decididoEm" = v_agora, "decididoPorId" = v_ator
    WHERE "id" = p_id;
  PERFORM set_config('app.transferindo', '', true);
END;
$$;

-- 5d) Listagem: a visibilidade e a da policy (ADMIN ve todos da clinica; outro, so os dirigidos a ele).
--     `total` = pacientes VIVOS ainda na origem (so a contagem). expira_em no passado = vencido (a UI decide).
CREATE FUNCTION pedidos_transferencia_visiveis() RETURNS TABLE(
    id uuid, origem_id text, origem_nome text, destino_id text, destino_nome text, criado_por_id text,
    estado text, criado_em timestamptz, expira_em timestamptz, concluido_em timestamptz, total int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM set_config('app.transferindo', '1', true);
  RETURN QUERY
    SELECT q."id", q."origemId", o."nome", q."destinoId", d."nome", q."criadoPorId", q."estado",
           (q."criadoEm" AT TIME ZONE 'UTC'), (q."expiraEm" AT TIME ZONE 'UTC'),
           (q."concluidoEm" AT TIME ZONE 'UTC'),
           (SELECT count(*)::int FROM "Paciente" x
              WHERE x."psicologoId" = q."origemId" AND x."clinicaId" = q."clinicaId" AND x."excluidoEm" IS NULL)
    FROM "PedidoTransferencia" q
      JOIN "Psicologo" o ON o."id" = q."origemId" AND o."clinicaId" = q."clinicaId"
      JOIN "Psicologo" d ON d."id" = q."destinoId" AND d."clinicaId" = q."clinicaId"
    ORDER BY q."criadoEm" DESC, q."id";
  PERFORM set_config('app.transferindo', '', true);
END;
$$;

-- 5e) Contagens (so ADMIN ativo): para cada psicologo DESATIVADO da clinica, quantos pacientes vivos tem.
CREATE FUNCTION transferencia_contagens() RETURNS TABLE(psicologo_id text, total int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_clinica text := NULLIF(current_setting('app.current_clinica_id', true), '');
  v_ator text := NULLIF(current_setting('app.current_psicologo_id', true), '');
BEGIN
  PERFORM set_config('app.transferindo', '1', true);
  IF transferencia_papel_ativo(v_clinica, v_ator) IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN QUERY
    SELECT o."id", count(x."id")::int
    FROM "Psicologo" o
      LEFT JOIN "Paciente" x ON x."psicologoId" = o."id" AND x."clinicaId" = o."clinicaId" AND x."excluidoEm" IS NULL
    WHERE o."clinicaId" = v_clinica AND o."papel" = 'PSICOLOGO' AND NOT o."ativo"
    GROUP BY o."id"
    ORDER BY o."id";
  PERFORM set_config('app.transferindo', '', true);
END;
$$;

-- 5f) Origem do lote: chamador = o DESTINO de um pedido ACEITO e nao concluido (origem e destino vem do
--     PEDIDO). Trava ate p_lote pacientes VIVOS da origem (ordem criadoEm, id) e devolve so eles, com todos
--     os documentos e as geracoes com cifrado. GeracaoIa PENDENTE em qualquer um = P0001 (nada muda).
--     Guarda o conjunto travado na GUC local `app.transferindo_lote` para transferencia_aplicar conferir.
CREATE FUNCTION transferencia_origem(p_pedido uuid, p_lote int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_clinica text := NULLIF(current_setting('app.current_clinica_id', true), '');
  v_ator text := NULLIF(current_setting('app.current_psicologo_id', true), '');
  v_agora timestamp(3) := (now() AT TIME ZONE 'UTC');
  r record;
  v_id text;
  v_ids text[] := ARRAY[]::text[];
  v_total int;
  v_restantes int;
  v_pacientes jsonb;
  v_documentos jsonb;
  v_geracoes jsonb;
BEGIN
  PERFORM set_config('app.transferindo', '1', true);
  IF p_lote IS NULL OR p_lote < 1 OR p_lote > 50 THEN
    RAISE EXCEPTION 'Lote invalido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO r FROM "PedidoTransferencia" q
    WHERE q."id" = p_pedido AND q."clinicaId" = v_clinica AND q."destinoId" = v_ator
      AND q."estado" = 'ACEITO' AND q."concluidoEm" IS NULL;
  IF NOT FOUND
     OR transferencia_papel_ativo(v_clinica, v_ator) IS NULL
     OR NOT transferencia_par_valido(v_clinica, r."origemId", r."destinoId") THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  -- Trava o lote (vivos, ordem estavel). Concorrente: quem chega depois pula o que ja saiu da origem.
  FOR v_id IN
    SELECT p."id" FROM "Paciente" p
    WHERE p."psicologoId" = r."origemId" AND p."clinicaId" = v_clinica AND p."excluidoEm" IS NULL
    ORDER BY p."criadoEm", p."id"
    LIMIT p_lote
    FOR UPDATE
  LOOP
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  SELECT count(*)::int INTO v_total FROM "Paciente" p
    WHERE p."psicologoId" = r."origemId" AND p."clinicaId" = v_clinica AND p."excluidoEm" IS NULL;
  v_restantes := v_total - cardinality(v_ids);

  IF EXISTS (SELECT 1 FROM "GeracaoIa" g
             WHERE g."psicologoId" = r."origemId" AND g."clinicaId" = v_clinica
               AND g."pacienteId" = ANY(v_ids) AND g."estado" = 'PENDENTE') THEN
    RAISE EXCEPTION 'transferencia bloqueada' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.transferindo_lote', to_jsonb(v_ids)::text, true);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p."id", 'nomeCifrado', p."nomeCifrado", 'nascimentoCifrado', p."nascimentoCifrado",
           'telefoneCifrado', p."telefoneCifrado", 'emailCifrado', p."emailCifrado")
           ORDER BY p."criadoEm", p."id"), '[]'::jsonb)
    INTO v_pacientes
    FROM "Paciente" p
    WHERE p."id" = ANY(v_ids) AND p."psicologoId" = r."origemId" AND p."clinicaId" = v_clinica;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', d."id", 'pacienteId', d."pacienteId", 'conteudoCifrado', d."conteudoCifrado")), '[]'::jsonb)
    INTO v_documentos
    FROM "Documento" d
    WHERE d."pacienteId" = ANY(v_ids) AND d."psicologoId" = r."origemId" AND d."clinicaId" = v_clinica;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', g."id", 'pacienteId', g."pacienteId", 'textoCifrado', g."textoCifrado",
           'mapaCifrado', g."mapaCifrado")), '[]'::jsonb)
    INTO v_geracoes
    FROM "GeracaoIa" g
    WHERE g."pacienteId" = ANY(v_ids) AND g."psicologoId" = r."origemId" AND g."clinicaId" = v_clinica
      AND (g."textoCifrado" IS NOT NULL OR g."mapaCifrado" IS NOT NULL);

  PERFORM set_config('app.transferindo', '', true);
  RETURN jsonb_build_object(
    'origemId', r."origemId", 'destinoId', r."destinoId",
    'pacientes', v_pacientes, 'documentos', v_documentos, 'geracoes', v_geracoes,
    'restantes', v_restantes);
END;
$$;

-- 5g) Aplicar o lote: mesmas validacoes; o payload (novos cifrados) tem que ser EXATAMENTE o conjunto
--     travado por transferencia_origem nesta transacao (pacientes, documentos e geracoes). Falta ou sobra =
--     erro (22023), nada muda. Troca cifrados, cancela convites PENDENTES, muda psicologoId (a cascata leva
--     o resto), e fecha o pedido (concluidoEm) quando nao sobra ninguem.
CREATE FUNCTION transferencia_aplicar(p_pedido uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_clinica text := NULLIF(current_setting('app.current_clinica_id', true), '');
  v_ator text := NULLIF(current_setting('app.current_psicologo_id', true), '');
  v_agora timestamp(3) := (now() AT TIME ZONE 'UTC');
  v_lote text := current_setting('app.transferindo_lote', true);
  r record;
  v_set text[];
  v_pac_ids text[];
  v_doc_ids text[];
  v_ger_ids text[];
  v_x jsonb;
  v_linha record;
  v_n int;
  v_restantes int;
BEGIN
  PERFORM set_config('app.transferindo', COALESCE(v_ator, '1'), true);
  IF v_lote IS NULL OR v_lote = '' THEN
    RAISE EXCEPTION 'Lote nao travado nesta transacao' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(p_payload->'pacientes') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_payload->'documentos') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_payload->'geracoes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload invalido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_set := ARRAY(SELECT jsonb_array_elements_text(v_lote::jsonb));

  SELECT * INTO r FROM "PedidoTransferencia" q
    WHERE q."id" = p_pedido AND q."clinicaId" = v_clinica AND q."destinoId" = v_ator
      AND q."estado" = 'ACEITO' AND q."concluidoEm" IS NULL
    FOR UPDATE;
  IF NOT FOUND
     OR transferencia_papel_ativo(v_clinica, v_ator) IS NULL
     OR NOT transferencia_par_valido(v_clinica, r."origemId", r."destinoId") THEN
    RAISE EXCEPTION 'Pedido nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  -- Conjuntos EXATOS (ordenados, sem duplicata: array diferente = erro).
  v_pac_ids := ARRAY(SELECT x->>'id' FROM jsonb_array_elements(p_payload->'pacientes') x);
  IF (SELECT array_agg(i ORDER BY i) FROM unnest(v_pac_ids) i) IS DISTINCT FROM
     (SELECT array_agg(i ORDER BY i) FROM unnest(v_set) i) THEN
    RAISE EXCEPTION 'Conjunto de pacientes diferente do lote' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_doc_ids := ARRAY(SELECT x->>'id' FROM jsonb_array_elements(p_payload->'documentos') x);
  IF (SELECT array_agg(i ORDER BY i) FROM unnest(v_doc_ids) i) IS DISTINCT FROM
     (SELECT array_agg(d."id" ORDER BY d."id") FROM "Documento" d
        WHERE d."pacienteId" = ANY(v_set) AND d."psicologoId" = r."origemId" AND d."clinicaId" = v_clinica) THEN
    RAISE EXCEPTION 'Conjunto de documentos diferente do lote' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_ger_ids := ARRAY(SELECT x->>'id' FROM jsonb_array_elements(p_payload->'geracoes') x);
  IF (SELECT array_agg(i ORDER BY i) FROM unnest(v_ger_ids) i) IS DISTINCT FROM
     (SELECT array_agg(g."id" ORDER BY g."id") FROM "GeracaoIa" g
        WHERE g."pacienteId" = ANY(v_set) AND g."psicologoId" = r."origemId" AND g."clinicaId" = v_clinica
          AND (g."textoCifrado" IS NOT NULL OR g."mapaCifrado" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Conjunto de geracoes diferente do lote' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (SELECT 1 FROM "GeracaoIa" g
             WHERE g."psicologoId" = r."origemId" AND g."clinicaId" = v_clinica
               AND g."pacienteId" = ANY(v_set) AND g."estado" = 'PENDENTE') THEN
    RAISE EXCEPTION 'transferencia bloqueada' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Pacientes: cifrados novos (mesma forma de nulo que o banco tem).
  FOR v_x IN SELECT value FROM jsonb_array_elements(p_payload->'pacientes') LOOP
    SELECT * INTO v_linha FROM "Paciente" p
      WHERE p."id" = v_x->>'id' AND p."psicologoId" = r."origemId" AND p."clinicaId" = v_clinica
        AND p."excluidoEm" IS NULL
      FOR UPDATE;
    IF NOT FOUND
       OR NOT transferencia_campo_ok(v_x->'nomeCifrado', v_linha."nomeCifrado", false)
       OR NOT transferencia_campo_ok(v_x->'nascimentoCifrado', v_linha."nascimentoCifrado", true)
       OR NOT transferencia_campo_ok(v_x->'telefoneCifrado', v_linha."telefoneCifrado", true)
       OR NOT transferencia_campo_ok(v_x->'emailCifrado', v_linha."emailCifrado", true) THEN
      RAISE EXCEPTION 'Paciente do payload invalido' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE "Paciente" SET
      "nomeCifrado" = v_x->>'nomeCifrado',
      "nascimentoCifrado" = v_x->>'nascimentoCifrado',
      "telefoneCifrado" = v_x->>'telefoneCifrado',
      "emailCifrado" = v_x->>'emailCifrado',
      "atualizadoEm" = v_agora
    WHERE "id" = v_linha."id";
  END LOOP;

  -- 2) Documentos (inclusive APROVADO: so conteudoCifrado muda; a excecao do trigger cobre).
  FOR v_x IN SELECT value FROM jsonb_array_elements(p_payload->'documentos') LOOP
    SELECT * INTO v_linha FROM "Documento" d
      WHERE d."id" = v_x->>'id' AND d."psicologoId" = r."origemId" AND d."clinicaId" = v_clinica
      FOR UPDATE;
    IF NOT FOUND OR NOT transferencia_campo_ok(v_x->'conteudoCifrado', v_linha."conteudoCifrado", false) THEN
      RAISE EXCEPTION 'Documento do payload invalido' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE "Documento" SET "conteudoCifrado" = v_x->>'conteudoCifrado' WHERE "id" = v_linha."id";
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Documento nao atualizado (lote desfeito)' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  -- 3) Geracoes (fora do PRONTO: texto e mapa; o PRONTO nao tem cifrado e so muda de dono pela cascata).
  FOR v_x IN SELECT value FROM jsonb_array_elements(p_payload->'geracoes') LOOP
    SELECT * INTO v_linha FROM "GeracaoIa" g
      WHERE g."id" = v_x->>'id' AND g."psicologoId" = r."origemId" AND g."clinicaId" = v_clinica
      FOR UPDATE;
    IF NOT FOUND
       OR NOT transferencia_campo_ok(v_x->'textoCifrado', v_linha."textoCifrado", true)
       OR NOT transferencia_campo_ok(v_x->'mapaCifrado', v_linha."mapaCifrado", true) THEN
      RAISE EXCEPTION 'Geracao do payload invalida' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE "GeracaoIa" SET "textoCifrado" = v_x->>'textoCifrado', "mapaCifrado" = v_x->>'mapaCifrado'
      WHERE "id" = v_linha."id";
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Geracao nao atualizada (lote desfeito)' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  -- 4) Convites de consentimento PENDENTES dos pacientes do lote viram CANCELADO (como anonimizar).
  UPDATE "ConviteConsentimento" SET "estado" = 'CANCELADO', "usadoEm" = v_agora
    WHERE "pacienteId" = ANY(v_set) AND "psicologoId" = r."origemId" AND "clinicaId" = v_clinica
      AND "estado" = 'PENDENTE';

  -- 5) Dono: a cascata leva Documento, GeracaoIa, Consentimento e Convite para o destino.
  UPDATE "Paciente" SET "psicologoId" = v_ator
    WHERE "id" = ANY(v_set) AND "psicologoId" = r."origemId" AND "clinicaId" = v_clinica
      AND "excluidoEm" IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> cardinality(v_set) THEN
    RAISE EXCEPTION 'Pacientes nao transferidos (lote desfeito)' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*)::int INTO v_restantes FROM "Paciente" p
    WHERE p."psicologoId" = r."origemId" AND p."clinicaId" = v_clinica AND p."excluidoEm" IS NULL;
  IF v_restantes = 0 THEN
    UPDATE "PedidoTransferencia" SET "concluidoEm" = v_agora WHERE "id" = p_pedido;
  END IF;

  PERFORM set_config('app.transferindo', '', true);
  PERFORM set_config('app.transferindo_lote', '', true);
  RETURN jsonb_build_object('transferidos', cardinality(v_set), 'restantes', v_restantes);
END;
$$;

-- 6) Privilegios das funcoes: nada para PUBLIC; EXECUTE so para o runtime.
REVOKE ALL ON FUNCTION pedido_transferencia_criar(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pedido_transferencia_aceitar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION pedido_transferencia_recusar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION pedido_transferencia_cancelar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION pedidos_transferencia_visiveis() FROM PUBLIC;
REVOKE ALL ON FUNCTION transferencia_contagens() FROM PUBLIC;
REVOKE ALL ON FUNCTION transferencia_origem(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION transferencia_aplicar(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION transferencia_papel_ativo(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION transferencia_par_valido(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION pedido_transferencia_criar(uuid, text, text) TO praxis_app;
GRANT EXECUTE ON FUNCTION pedido_transferencia_aceitar(uuid) TO praxis_app;
GRANT EXECUTE ON FUNCTION pedido_transferencia_recusar(uuid) TO praxis_app;
GRANT EXECUTE ON FUNCTION pedido_transferencia_cancelar(uuid) TO praxis_app;
GRANT EXECUTE ON FUNCTION pedidos_transferencia_visiveis() TO praxis_app;
GRANT EXECUTE ON FUNCTION transferencia_contagens() TO praxis_app;
GRANT EXECUTE ON FUNCTION transferencia_origem(uuid, int) TO praxis_app;
GRANT EXECUTE ON FUNCTION transferencia_aplicar(uuid, jsonb) TO praxis_app;
