-- Rodar UMA vez por banco, como SUPERUSER (nao e migration: lo_create e lo_creat sao do
-- superuser e o notta_owner nao consegue revogar o EXECUTE de PUBLIC; o comando "funciona" e
-- nao muda nada). Idempotente.
--   psql -U postgres -d notta_psi -f prisma/bootstrap/endurecer-banco.sql
-- M-11 da 2a revisao: sem isto, qualquer papel (inclusive notta_app) cria large objects,
-- que ficam fora de RLS e ocupam disco.
REVOKE EXECUTE ON FUNCTION lo_create(oid), lo_creat(integer) FROM PUBLIC;
