-- Paciente (item 9): identificadores cifrados (nome, nascimento, telefone, e-mail).
-- O id e gerado no app (entra no AAD da cifra). Dono = psicologo (docs/ACESSO.md).

-- CreateTable
CREATE TABLE "Paciente" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "psicologoId" TEXT NOT NULL,
    "nomeCifrado" TEXT NOT NULL,
    "nascimentoCifrado" TEXT,
    "telefoneCifrado" TEXT,
    "emailCifrado" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paciente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Paciente_clinicaId_psicologoId_idx" ON "Paciente"("clinicaId", "psicologoId");

-- CreateIndex
CREATE UNIQUE INDEX "Paciente_id_psicologoId_clinicaId_key" ON "Paciente"("id", "psicologoId", "clinicaId");

-- AddForeignKey
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_psicologoId_clinicaId_fkey" FOREIGN KEY ("psicologoId", "clinicaId") REFERENCES "Psicologo"("id", "clinicaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE + policy psicologo_proprio (bloco sql-psicologo-proprio do docs/ACESSO.md).
ALTER TABLE "Paciente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Paciente" FORCE ROW LEVEL SECURITY;
CREATE POLICY psicologo_proprio ON "Paciente"
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''))
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), '') AND "psicologoId" = NULLIF(current_setting('app.current_psicologo_id', true), ''));

-- Privilegios do notta_app: SELECT e INSERT; UPDATE so das colunas cifradas e de atualizadoEm.
-- Sem DELETE (exclusao e o item 26) e sem UPDATE de id, clinicaId, psicologoId.
REVOKE UPDATE, DELETE ON "Paciente" FROM notta_app;
GRANT UPDATE ("nomeCifrado", "nascimentoCifrado", "telefoneCifrado", "emailCifrado", "atualizadoEm") ON "Paciente" TO notta_app;
