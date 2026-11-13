-- SO DESENVOLVIMENTO: senhas fixas e publicas. Em producao use outras credenciais.
-- Executado pelo postgres:16-alpine no 1o start (docker-entrypoint-initdb.d) e pelo
-- tooling embutido (roles.mjs divide em ponto e virgula: nada de ponto e virgula em string nem bloco DO).
CREATE ROLE praxis_owner LOGIN PASSWORD 'praxis_owner' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE praxis_app LOGIN PASSWORD 'praxis_app' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE praxis_psi OWNER praxis_owner;
GRANT CONNECT ON DATABASE praxis_psi TO praxis_app;
