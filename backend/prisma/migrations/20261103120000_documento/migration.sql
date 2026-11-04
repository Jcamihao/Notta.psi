-- Documento clinico (item 12): nota bruta, evolucao ou anamnese, texto cifrado (AES-256-GCM por
-- clinica, AAD = Documento|conteudoCifrado|id|psicologoId; o id nasce no app). Filha de Paciente:
-- FK composta com o dono (docs/ACESSO.md). Nasce RASCUNHO. O notta_app so le e insere: UPDATE
-- (edicao, item 14) e aprovacao (item 15) entram em migration propria; DELETE nao existe.

-- CreateTable
CREATE TABLE "Documento" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "psicologoId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "dataSessao" DATE,
    "conteudoCifrado" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Documento_clinicaId_psicologoId_pacienteId_criadoEm_idx" ON "Documento"("clinicaId", "psicologoId", "pacienteId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Documento_id_psicologoId_clinicaId_key" ON "Documento"("id", "psicologoId", "clinicaId");

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_pacienteId_psicologoId_clinicaId_fkey" FOREIGN KEY ("pacienteId", "psicologoId", "clinicaId") REFERENCES "Paciente"("id", "psicologoId", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs: valores fixos no banco (o Prisma trata como text).
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_tipo_check" CHECK ("tipo" IN ('NOTA_BRUTA', 'EVOLUCAO', 'ANAMNESE'));
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_status_check" CHECK ("status" IN ('RASCUNHO', 'APROVADO'));

-- Privilegios: so SELECT e INSERT (tira o que o DEFAULT PRIVILEGES deu).
REVOKE ALL ON "Documento" FROM notta_app;
GRANT SELECT, INSERT ON "Documento" TO notta_app;

-- RLS ENABLE + FORCE, policy psicologo_proprio (bloco sql-psicologo-proprio do docs/ACESSO.md).
-- Unica diferenca: o WITH CHECK tambem exige status = 'RASCUNHO' (ninguem insere ja aprovado).
-- O USING nao filtra status: documento aprovado continua legivel pelo dono. O item 15 troca esta
-- policy para permitir a aprovacao.
ALTER TABLE "Documento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Documento" FORCE ROW LEVEL SECURITY;
CREATE POLICY psicologo_proprio ON "Documento"
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), '') AND "status" = 'RASCUNHO');
