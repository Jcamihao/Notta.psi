#!/usr/bin/env bash
# Backup cifrado do banco (item 25, parte C). Uso: npm run backup -- <arquivo>
# Grava <arquivo>.enc e <arquivo>.enc.sha256 (o sufixo .enc entra sozinho se faltar).
# Senha: PRAXIS_BACKUP_SENHA no ambiente, >= 24 caracteres. NUNCA e a chave mestra, e nunca vai em argumento.
# Comandos: PGDUMP_CMD (padrao "pg_dump"; ex.: "docker exec -i praxispsi-postgres-1 pg_dump -U postgres").
# Banco: BACKUP_BANCO (padrao praxis_psi). Credencial do banco: PGUSER/PGPASSWORD/PGHOST ou .pgpass.
# O dump nunca toca o disco sem cifra: pg_dump | openssl enc > arquivo.
set -euo pipefail
# Backup e .sha256 so legiveis pelo dono (mesmo cifrado, nao precisa ser lido por ninguem mais).
umask 077

SAIDA="${1:-}"
if [ -z "$SAIDA" ]; then
  echo "uso: backup.sh <arquivo>   (grava <arquivo>.enc)" >&2
  exit 2
fi
case "$SAIDA" in
  *.enc) ;;
  *) SAIDA="$SAIDA.enc" ;;
esac

if [ -z "${PRAXIS_BACKUP_SENHA:-}" ] || [ "${#PRAXIS_BACKUP_SENHA}" -lt 24 ]; then
  echo "FALHOU: PRAXIS_BACKUP_SENHA ausente ou com menos de 24 caracteres. Nada foi gravado." >&2
  exit 1
fi
export PRAXIS_BACKUP_SENHA

if [ -e "$SAIDA" ] || [ -e "$SAIDA.sha256" ]; then
  echo "FALHOU: ja existe $SAIDA (ou o .sha256). Escolha outro nome." >&2
  exit 1
fi

read -ra PGDUMP <<< "${PGDUMP_CMD:-pg_dump}"
BANCO="${BACKUP_BANCO:-praxis_psi}"
PARCIAL="$SAIDA.partial"
# Falha no meio = nao deixa arquivo parcial para tras.
trap 'rm -f "$PARCIAL"' EXIT

"${PGDUMP[@]}" -Fc "$BANCO" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:PRAXIS_BACKUP_SENHA -out "$PARCIAL"
mv "$PARCIAL" "$SAIDA"

(cd "$(dirname "$SAIDA")" && sha256sum "$(basename "$SAIDA")" > "$(basename "$SAIDA").sha256")

echo "backup gravado: $SAIDA ($(wc -c < "$SAIDA") bytes) e $SAIDA.sha256"
