#!/bin/sh
# SO DESENVOLVIMENTO (docker). Roda como superuser no 1o start, depois do 01-roles.sql
# (que cria o banco praxis_psi). Mesmo conteudo de backend/prisma/bootstrap/endurecer-banco.sql.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname praxis_psi <<'SQL'
REVOKE EXECUTE ON FUNCTION lo_create(oid), lo_creat(integer) FROM PUBLIC;
SQL
