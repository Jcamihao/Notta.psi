-- A policy tenant_isolation filtra toda consulta de Psicologo por "clinicaId".
-- O unique (id, clinicaId) comeca por id e nao serve para esse filtro.
CREATE INDEX "Psicologo_clinicaId_idx" ON "Psicologo"("clinicaId");
