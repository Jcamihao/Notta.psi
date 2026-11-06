#!/usr/bin/env bash
# Verifica um backup (item 25, parte C). Uso: npm run verificar:backup -- <arquivo.enc>
# 1) sha256 contra <arquivo>.enc.sha256; 2) decifra com NOTTA_BACKUP_SENHA;
# 3) restaura num banco temporario notta_restore_<aleatorio>; 4) conta linhas por tabela;
# 5) decifra uma amostra de cada coluna cifrada com as chaves DO AMBIENTE (NOTTA_MASTER_KEY ou
#    NOTTA_MASTER_KEYS + NOTTA_MASTER_KEY_ATUAL). Prova que o par backup + chave funciona.
# Comandos: PGRESTORE_CMD (padrao "pg_restore"), PSQL_CMD (padrao "psql"). Ex. para docker:
#   PGRESTORE_CMD="docker exec -i nottapsi-postgres-1 pg_restore -U postgres"
#   PSQL_CMD="docker exec -i nottapsi-postgres-1 psql -U postgres -v ON_ERROR_STOP=1"
# No fim apaga o banco temporario e o arquivo decifrado, mesmo em falha. Imprime so contagens e OK/FALHOU.
set -euo pipefail
umask 077

ARQ="${1:-}"
if [ -z "$ARQ" ] || [ ! -f "$ARQ" ]; then
  echo "uso: verificar-backup.sh <arquivo.enc>" >&2
  exit 2
fi
if [ -z "${NOTTA_BACKUP_SENHA:-}" ] || [ "${#NOTTA_BACKUP_SENHA}" -lt 24 ]; then
  echo "FALHOU: NOTTA_BACKUP_SENHA ausente ou com menos de 24 caracteres." >&2
  exit 1
fi
export NOTTA_BACKUP_SENHA

DIR="$(cd "$(dirname "$ARQ")" && pwd)"
BASE="$(basename "$ARQ")"
DIRETORIO_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
read -ra PGRESTORE <<< "${PGRESTORE_CMD:-pg_restore}"
read -ra PSQL <<< "${PSQL_CMD:-psql}"

TMPD=""
DUMP=""
BANCO_TEMP=""
limpar() {
  if [ -n "$BANCO_TEMP" ]; then
    "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$BANCO_TEMP\"" </dev/null >/dev/null 2>&1 \
      || echo "AVISO: nao consegui apagar o banco temporario $BANCO_TEMP" >&2
  fi
  [ -n "$DUMP" ] && rm -f "$DUMP"
  [ -n "$TMPD" ] && rmdir "$TMPD" 2>/dev/null || true
}
trap limpar EXIT

falha() {
  echo "FALHOU: $1"
  exit 1
}

# 1) sha256
if [ ! -f "$DIR/$BASE.sha256" ]; then
  falha "sha256 ausente ($BASE.sha256)"
fi
# Compara so o hash: o nome dentro do .sha256 pode nao ser o arquivo atual (renomeado).
ESPERADO="$(awk '{print $1}' "$DIR/$BASE.sha256")"
ATUAL="$(sha256sum "$ARQ" | awk '{print $1}')"
if [ -z "$ESPERADO" ] || [ "$ESPERADO" != "$ATUAL" ]; then
  falha "sha256 nao confere: arquivo alterado ou corrompido"
fi
echo "sha256: OK"

# 2) decifrar
TMPD="$(mktemp -d)"
chmod 700 "$TMPD"
DUMP="$TMPD/dump.pgdump"
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:NOTTA_BACKUP_SENHA -in "$ARQ" -out "$DUMP" 2>/dev/null; then
  falha "nao consegui decifrar (senha de backup errada ou arquivo corrompido)"
fi
echo "decifrar: OK"

# 3) restaurar em banco temporario (nome nunca e o do banco real)
BANCO_TEMP="notta_restore_$(openssl rand -hex 6)"
case "$BANCO_TEMP" in
  notta_restore_*) ;;
  *) falha "nome de banco temporario invalido" ;;
esac
"${PSQL[@]}" -d postgres -c "CREATE DATABASE \"$BANCO_TEMP\"" </dev/null >/dev/null || falha "nao consegui criar o banco temporario"
if ! "${PGRESTORE[@]}" --no-owner --no-privileges -d "$BANCO_TEMP" < "$DUMP" >/dev/null 2>&1; then
  falha "pg_restore terminou com erro"
fi
echo "restaurar em banco temporario: OK"

# 4) contar linhas por tabela
TABELAS="$("${PSQL[@]}" -d "$BANCO_TEMP" -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1" </dev/null)"
while IFS= read -r t; do
  [ -z "$t" ] && continue
  n="$("${PSQL[@]}" -d "$BANCO_TEMP" -At -c "SELECT count(*) FROM \"$t\"" </dev/null)"
  echo "linhas $t: $n"
done <<< "$TABELAS"

# 5) amostra decifrada com as chaves do ambiente (uma coluna cifrada por bloco)
COLUNAS=("Paciente nomeCifrado" "Paciente nascimentoCifrado" "Paciente telefoneCifrado" "Paciente emailCifrado" "Documento conteudoCifrado" "GeracaoIa textoCifrado" "GeracaoIa mapaCifrado")
SQL=""
for par in "${COLUNAS[@]}"; do
  read -r t c <<< "$par"
  bloco="(SELECT '$t', '$c', \"clinicaId\", \"id\", \"psicologoId\", \"$c\" FROM \"$t\" WHERE \"$c\" IS NOT NULL LIMIT 5)"
  SQL="${SQL:+$SQL UNION ALL }$bloco"
done
set +e
"${PSQL[@]}" -d "$BANCO_TEMP" -At -F $'\t' -c "$SQL" \
  | node "$DIRETORIO_SCRIPT/verificar-amostra.mjs"
STATUS_AMOSTRA=$?
set -e
case "$STATUS_AMOSTRA" in
  0) echo "decifrar amostra: OK" ;;
  3) falha "nenhuma coluna cifrada com dado: nada provado (backup de banco vazio?)" ;;
  *) falha "amostra nao decifrou com as chaves do ambiente" ;;
esac

echo "VERIFICACAO OK: $BASE"
