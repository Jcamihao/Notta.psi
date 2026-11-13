
-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ADMIN', 'PSICOLOGO');

-- CreateEnum
CREATE TYPE "Abordagem" AS ENUM ('SISTEMICA', 'TCC', 'PSICANALISE', 'ACT', 'HUMANISTA', 'OUTRA');

-- CreateTable
CREATE TABLE "Clinica" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clinica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Psicologo" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "abordagemPadrao" "Abordagem" NOT NULL,
    "papel" "Papel" NOT NULL DEFAULT 'PSICOLOGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Psicologo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Psicologo_email_key" ON "Psicologo"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Psicologo_id_clinicaId_key" ON "Psicologo"("id", "clinicaId");

-- AddForeignKey
ALTER TABLE "Psicologo" ADD CONSTRAINT "Psicologo_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Isolamento por clinica (RLS). Roda como praxis_owner (dono das tabelas).
-- FORCE: sem ele o dono das tabelas ignora as policies. Com FORCE o owner tambem fica
-- sujeito: migration de DADOS precisa de contexto de clinica (laco com set_config).
ALTER TABLE "Clinica" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Clinica" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Psicologo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Psicologo" FORCE ROW LEVEL SECURITY;

-- NULLIF: depois de um set_config LOCAL a conexao do pool devolve '' (nao NULL).
-- '' vira NULL e nao casa nenhuma linha. Sem contexto = zero linhas, sem erro.
-- WITH CHECK: barra INSERT/UPDATE que grave linha de outra clinica.
CREATE POLICY tenant_isolation ON "Clinica" FOR ALL
  USING ("id" = NULLIF(current_setting('app.current_clinica_id', true), ''))
  WITH CHECK ("id" = NULLIF(current_setting('app.current_clinica_id', true), ''));

CREATE POLICY tenant_isolation ON "Psicologo" FOR ALL
  USING ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''))
  WITH CHECK ("clinicaId" = NULLIF(current_setting('app.current_clinica_id', true), ''));

-- login_lookup: no login o psicologo ainda nao tem clinicaId. So SELECT, so a linha do
-- e-mail posto em app.login_email (apenas TenantPrismaService.runLogin faz isso).
-- SECURITY DEFINER nao resolve: com FORCE o dono tambem passa pela policy.
CREATE POLICY login_lookup ON "Psicologo" FOR SELECT
  USING ("email" = NULLIF(current_setting('app.login_email', true), ''));

-- Runtime (praxis_app) so faz DML: sem TRUNCATE, sem DDL, nao e dono.
-- DEFAULT PRIVILEGES vale para as tabelas futuras criadas pelo praxis_owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO praxis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO praxis_app;
-- O GRANT acima pegou tambem o historico do Prisma: o app nao mexe nele.
REVOKE ALL ON "_prisma_migrations" FROM praxis_app;
