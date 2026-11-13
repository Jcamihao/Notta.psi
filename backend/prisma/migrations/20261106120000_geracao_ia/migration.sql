-- Geracao de documento por IA (itens 19, 20 e 21). Um pedido (GeracaoIa) com estado:
-- PREVIA -> PENDENTE -> PRONTO | FALHOU, e FALHOU retentavel -> PENDENTE de novo (sem limite).
-- Guarda o texto anonimizado e o mapa codigo->original CIFRADOS (AES-256-GCM por clinica,
-- AAD = GeracaoIa|<coluna>|id|psicologoId; o id nasce no app). No PRONTO os dois sao zerados.
-- O documento criado entra em "Documento" como RASCUNHO com "geradoPorIa" = true (imutavel).

-- AlterTable
ALTER TABLE "Documento" ADD COLUMN     "geradoPorIa" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GeracaoIa" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "psicologoId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "origemId" TEXT NOT NULL,
    "tipoDocumento" TEXT NOT NULL,
    "abordagem" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "motivo" TEXT,
    "retentavel" BOOLEAN,
    "avisos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "textoCifrado" TEXT,
    "mapaCifrado" TEXT,
    "documentoId" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "finalizadoEm" TIMESTAMP(3),

    CONSTRAINT "GeracaoIa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeracaoIa_documentoId_key" ON "GeracaoIa"("documentoId");

-- CreateIndex
CREATE INDEX "GeracaoIa_clinicaId_psicologoId_pacienteId_criadoEm_idx" ON "GeracaoIa"("clinicaId", "psicologoId", "pacienteId", "criadoEm");

-- CreateIndex (contagem do limite diario)
CREATE INDEX "GeracaoIa_clinicaId_psicologoId_estado_finalizadoEm_idx" ON "GeracaoIa"("clinicaId", "psicologoId", "estado", "finalizadoEm");

-- AddForeignKey (nota de origem: paciente e dono entram na chave, padrao docs/ACESSO.md)
ALTER TABLE "GeracaoIa" ADD CONSTRAINT "GeracaoIa_origemId_pacienteId_psicologoId_clinicaId_fkey" FOREIGN KEY ("origemId", "pacienteId", "psicologoId", "clinicaId") REFERENCES "Documento"("id", "pacienteId", "psicologoId", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (documento gerado). DEFERRABLE INITIALLY DEFERRED: o executor marca o pedido
-- PRONTO (UPDATE condicional, quem perde a corrida aborta SEM criar documento) e so entao insere o
-- Documento, tudo na mesma transacao; a FK confere no COMMIT.
ALTER TABLE "GeracaoIa" ADD CONSTRAINT "GeracaoIa_documentoId_pacienteId_psicologoId_clinicaId_fkey" FOREIGN KEY ("documentoId", "pacienteId", "psicologoId", "clinicaId") REFERENCES "Documento"("id", "pacienteId", "psicologoId", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- CHECKs (o Prisma trata como text). Motivo: lista fechada, nunca texto vindo da IA.
ALTER TABLE "GeracaoIa" ADD CONSTRAINT "GeracaoIa_tipoDocumento_check" CHECK ("tipoDocumento" IN ('EVOLUCAO', 'ANAMNESE'));
ALTER TABLE "GeracaoIa" ADD CONSTRAINT "GeracaoIa_abordagem_check" CHECK ("abordagem" IN ('SISTEMICA', 'TCC', 'PSICANALISE', 'ACT', 'HUMANISTA', 'OUTRA'));
ALTER TABLE "GeracaoIa" ADD CONSTRAINT "GeracaoIa_estado_check" CHECK ("estado" IN ('PREVIA', 'PENDENTE', 'PRONTO', 'FALHOU'));
ALTER TABLE "GeracaoIa" ADD CONSTRAINT "GeracaoIa_motivo_check" CHECK ("motivo" IS NULL OR "motivo" IN ('DESABILITADA', 'TIMEOUT', 'REDE', 'LIMITE', 'ERRO_DA_IA', 'RESPOSTA_INVALIDA', 'CHAVE_INVALIDA', 'PEDIDO_INVALIDO', 'CONFIG', 'SAIDA_INVALIDA', 'TEMPO_ESGOTADO', 'ERRO_INTERNO'));
-- Forma de cada estado. PRONTO: documento ligado, hora de fim, cifrados ZERADOS, sem motivo.
-- FALHOU: motivo e retentavel, fim, e o texto/mapa PERMANECEM (a retentativa reenvia o mesmo texto).
-- Os demais: sem documento, sem fim, sem motivo, com texto e mapa.
ALTER TABLE "GeracaoIa" ADD CONSTRAINT "GeracaoIa_forma_check" CHECK (
  CASE "estado"
    WHEN 'PRONTO' THEN "documentoId" IS NOT NULL AND "finalizadoEm" IS NOT NULL AND "textoCifrado" IS NULL AND "mapaCifrado" IS NULL AND "motivo" IS NULL AND "retentavel" IS NULL
    WHEN 'FALHOU' THEN "documentoId" IS NULL AND "finalizadoEm" IS NOT NULL AND "motivo" IS NOT NULL AND "retentavel" IS NOT NULL AND "textoCifrado" IS NOT NULL AND "mapaCifrado" IS NOT NULL
    ELSE "documentoId" IS NULL AND "finalizadoEm" IS NULL AND "motivo" IS NULL AND "retentavel" IS NULL AND "textoCifrado" IS NOT NULL AND "mapaCifrado" IS NOT NULL
  END
);

-- No maximo UMA geracao PENDENTE por psicologo, decidido pelo banco (duas confirmacoes
-- simultaneas de pedidos diferentes: uma perde com unique violation).
CREATE UNIQUE INDEX "GeracaoIa_um_pendente_por_psicologo" ON "GeracaoIa"("psicologoId") WHERE "estado" = 'PENDENTE';

-- Privilegios: SELECT, INSERT e UPDATE so nas colunas de andamento. Sem DELETE (retencao: item 52).
REVOKE ALL ON "GeracaoIa" FROM praxis_app;
GRANT SELECT, INSERT ON "GeracaoIa" TO praxis_app;
GRANT UPDATE ("estado", "motivo", "retentavel", "avisos", "textoCifrado", "mapaCifrado", "documentoId", "atualizadoEm", "finalizadoEm") ON "GeracaoIa" TO praxis_app;

-- RLS ENABLE + FORCE, mesmo molde do Documento: policies separadas porque o INSERT exige
-- estado = 'PREVIA' e esse WITH CHECK nao pode valer para UPDATE.
ALTER TABLE "GeracaoIa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GeracaoIa" FORCE ROW LEVEL SECURITY;
CREATE POLICY geracaoia_select_proprio ON "GeracaoIa" FOR SELECT
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));
CREATE POLICY geracaoia_insert_proprio ON "GeracaoIa" FOR INSERT
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), '') AND "estado" = 'PREVIA');
CREATE POLICY geracaoia_update_proprio ON "GeracaoIa" FOR UPDATE
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));
-- So do praxis_owner, so da clinica do contexto: sem elas o FORCE RLS faria o UPDATE do dono
-- afetar 0 linhas e o trigger nunca dispararia (UPDATE), e a limpeza das suites nao apagaria
-- (DELETE). A barreira real e o trigger.
CREATE POLICY geracaoia_dono_update ON "GeracaoIa" FOR UPDATE TO praxis_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));
CREATE POLICY geracaoia_dono_delete ON "GeracaoIa" FOR DELETE TO praxis_owner
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- Trigger BEFORE UPDATE, vale para TODOS os papeis (o dono da tabela inclusive).
--  - identidade imutavel (id, clinica, psicologo, paciente, origem, tipo, abordagem, criadoEm, expiraEm);
--  - PRONTO e final (nem o dono altera);
--  - so as transicoes PREVIA->PENDENTE, FALHOU->PENDENTE, PENDENTE->PRONTO, PENDENTE->FALHOU;
--  - fora do PRONTO, texto e mapa cifrados NAO mudam: sai exatamente o que a previa mostrou.
-- A forma de cada estado (PRONTO com documento e cifrados zerados etc.) e o CHECK acima.
CREATE FUNCTION geracao_ia_barreira() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
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

CREATE TRIGGER geracao_ia_barreira BEFORE UPDATE ON "GeracaoIa"
  FOR EACH ROW EXECUTE FUNCTION geracao_ia_barreira();

-- Documento: "geradoPorIa" e identidade (nao muda depois do INSERT, nem para o dono). O app nao
-- tem UPDATE nessa coluna; o trigger cobre o dono. Mesma funcao de item 44 + uma linha.
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
