-- Item 62/57: senha provisoria (criada pelo ADMIN, troca obrigatoria no 1o acesso)
-- e versao do token (claim `tv` do JWT; trocar a senha incrementa e revoga os tokens antigos).
-- Linhas existentes: senha definitiva (false) e versao 0.
ALTER TABLE "Psicologo" ADD COLUMN "senhaProvisoria" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "tokenVersao" INTEGER NOT NULL DEFAULT 0;

-- O app altera as duas colunas na troca de senha, so na PROPRIA linha (policy
-- psicologo_update_proprio). Soma ao GRANT por coluna anterior (nome, abordagemPadrao,
-- senhaHash). papel, email, clinicaId e id seguem imutaveis para o praxis_app.
GRANT UPDATE ("senhaProvisoria", "tokenVersao") ON "Psicologo" TO praxis_app;
