-- SO DESENVOLVIMENTO: senhas fixas e publicas. Em producao use outras credenciais.
-- Executado pelo postgres:16-alpine no 1o start (docker-entrypoint-initdb.d) e pelo
-- tooling embutido (roles.mjs divide em ponto e virgula: nada de ponto e virgula em string nem bloco DO).
CREATE ROLE notta_owner LOGIN PASSWORD 'notta_owner' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE notta_app LOGIN PASSWORD 'notta_app' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE notta_psi OWNER notta_owner;
GRANT CONNECT ON DATABASE notta_psi TO notta_app;
