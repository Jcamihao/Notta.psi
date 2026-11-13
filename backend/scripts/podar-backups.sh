#!/usr/bin/env bash
# Poda de backups (item 52B). Uso: npm run podar-backups -- <pasta> [--dias N] [--dry-run]
# Apaga o par <nome>.enc + <nome>.enc.sha256 cujo .enc tem data de modificacao mais velha que N dias.
# Padrao 30 dias. Ordem de precedencia: --dias, depois PRAXIS_BACKUP_RETENCAO_DIAS, depois 30.
# Regras:
# - So casa o padrao exato de backup.sh (*.enc e *.enc.sha256), so no nivel da pasta: sem recursao
#   e sem seguir link simbolico. Subpastas, links e outros arquivos nunca sao tocados.
# - Nunca apaga o backup MAIS RECENTE da pasta (empate: todos os empatados; data no futuro nao conta), mesmo vencido: se o agendamento parar, o ultimo
#   bom continua la. Pasta com um backup so nao perde nada.
# - Um .sha256 so sai junto com o seu .enc. Um .sha256 sem .enc (sobra) fica como esta: nao tem
#   dado pessoal (so hash e nome).
# - Recusa a pasta `/`, a sua pasta pessoal ($HOME) e a raiz do repositorio.
# - Saida: so nomes de arquivo e contagens, nunca conteudo.
# Codigos de saida: 0 ok; 1 erro de IO; 2 uso ou configuracao (nada e apagado).
set -euo pipefail

PADRAO_DIAS=30
MAXIMO_DIAS=36500

uso() {
  echo "uso: podar-backups.sh <pasta> [--dias N] [--dry-run]" >&2
  echo "  padrao: $PADRAO_DIAS dias; PRAXIS_BACKUP_RETENCAO_DIAS = inteiro de 1 a $MAXIMO_DIAS" >&2
}

PASTA=""
DIAS_FLAG=""
DIAS_FLAG_DEFINIDO=0
SIMULAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      SIMULAR=1
      shift
      ;;
    --dias)
      if [ $# -lt 2 ]; then
        echo "FALHOU: --dias precisa de um valor." >&2
        uso
        exit 2
      fi
      DIAS_FLAG="$2"
      DIAS_FLAG_DEFINIDO=1
      shift 2
      ;;
    --dias=*)
      DIAS_FLAG="${1#--dias=}"
      DIAS_FLAG_DEFINIDO=1
      shift
      ;;
    -*)
      echo "FALHOU: opcao desconhecida." >&2
      uso
      exit 2
      ;;
    *)
      if [ -n "$PASTA" ]; then
        echo "FALHOU: informe uma pasta so." >&2
        uso
        exit 2
      fi
      PASTA="$1"
      shift
      ;;
  esac
done

# Aceita so inteiro de 1 a MAXIMO_DIAS, sem sinal, sem ponto, sem espaco. Vazio e invalido.
dias_validos() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "${#1}" -le 5 ] || return 1
  local n=$((10#$1))
  [ "$n" -ge 1 ] && [ "$n" -le "$MAXIMO_DIAS" ]
}

DIAS=$PADRAO_DIAS
ORIGEM="padrao"
if [ -n "${PRAXIS_BACKUP_RETENCAO_DIAS+x}" ]; then
  if ! dias_validos "$PRAXIS_BACKUP_RETENCAO_DIAS"; then
    echo "FALHOU: PRAXIS_BACKUP_RETENCAO_DIAS invalida (inteiro de 1 a $MAXIMO_DIAS). Nada foi apagado." >&2
    exit 2
  fi
  DIAS=$((10#$PRAXIS_BACKUP_RETENCAO_DIAS))
  ORIGEM="PRAXIS_BACKUP_RETENCAO_DIAS"
fi
if [ "$DIAS_FLAG_DEFINIDO" -eq 1 ]; then
  if ! dias_validos "$DIAS_FLAG"; then
    echo "FALHOU: --dias invalido (inteiro de 1 a $MAXIMO_DIAS). Nada foi apagado." >&2
    exit 2
  fi
  DIAS=$((10#$DIAS_FLAG))
  ORIGEM="--dias"
fi

if [ -z "$PASTA" ]; then
  uso
  exit 2
fi
if [ ! -d "$PASTA" ]; then
  echo "FALHOU: pasta inexistente ou que nao e diretorio. Nada foi apagado." >&2
  exit 2
fi
if ! PASTA_REAL="$(cd -P -- "$PASTA" && pwd -P)"; then
  echo "FALHOU: nao consegui entrar na pasta." >&2
  exit 1
fi

DIR_SCRIPT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
RAIZ_REPO="$(cd -P -- "$DIR_SCRIPT/../.." && pwd -P)"
RECUSADAS=("/" "$RAIZ_REPO")
if [ -n "${HOME:-}" ] && [ -d "$HOME" ]; then
  RECUSADAS+=("$(cd -P -- "$HOME" && pwd -P)")
fi
for r in "${RECUSADAS[@]}"; do
  if [ "$PASTA_REAL" = "$r" ]; then
    echo "FALHOU: pasta recusada (raiz do sistema, pasta pessoal ou raiz do repositorio). Nada foi apagado." >&2
    exit 2
  fi
done

# Imprime o mtime em segundos (GNU ou BSD stat). Falha se nao conseguir ler.
mtime_de() {
  local m
  if m="$(stat -c %Y -- "$1" 2>/dev/null)" || m="$(stat -f %m -- "$1" 2>/dev/null)"; then
    printf '%s\n' "$m"
  else
    return 1
  fi
}

shopt -s nullglob

# Coleta: so arquivos regulares (nao link, nao pasta) com o nome exato *.enc no nivel da pasta.
ENCS=()
for f in "$PASTA_REAL"/*.enc; do
  if [ -f "$f" ] && [ ! -L "$f" ]; then
    ENCS+=("$f")
  fi
done

if [ "${#ENCS[@]}" -eq 0 ]; then
  echo "nenhum backup (*.enc) em $PASTA_REAL. Nada a fazer."
  exit 0
fi

# Le o mtime de cada .enc. Arquivo que sumiu no meio da leitura e pulado (nao e erro).
MT=()
for i in "${!ENCS[@]}"; do
  f="${ENCS[$i]}"
  if m="$(mtime_de "$f")"; then
    MT[i]="$m"
  elif [ -e "$f" ]; then
    echo "FALHOU: nao consegui ler a data de $(basename -- "$f"). Nada foi apagado." >&2
    exit 1
  else
    MT[i]=""
  fi
done

AGORA="$(date +%s)"
CORTE=$((AGORA - DIAS * 86400))

# Backup mais recente = maior mtime que nao esteja no futuro (relogio errado nao pode proteger um
# arquivo falso no lugar do ultimo bom). Todo arquivo com esse mesmo mtime (empate) e mantido.
TOPO=-1
for i in "${!ENCS[@]}"; do
  [ -n "${MT[$i]}" ] || continue
  [ "${MT[$i]}" -le "$AGORA" ] || continue
  if [ "$TOPO" -lt 0 ] || [ "${MT[$i]}" -gt "$TOPO" ]; then
    TOPO=${MT[$i]}
  fi
done

if [ "$TOPO" -lt 0 ]; then
  echo "nenhum backup (*.enc) com data valida em $PASTA_REAL. Nada a fazer."
  exit 0
fi

echo "retencao: $DIAS dias (origem: $ORIGEM); pasta: $PASTA_REAL"
if [ "$SIMULAR" -eq 1 ]; then
  echo "modo --dry-run: nada sera apagado."
fi
for i in "${!ENCS[@]}"; do
  if [ -n "${MT[$i]}" ] && [ "${MT[$i]}" -eq "$TOPO" ]; then
    echo "mantido (mais recente, nunca apagado): $(basename -- "${ENCS[$i]}")"
  fi
done

PARES=0
ARQUIVOS=0
ERROS=0
for i in "${!ENCS[@]}"; do
  [ -n "${MT[$i]}" ] || continue
  [ "${MT[$i]}" -ne "$TOPO" ] || continue
  [ "${MT[$i]}" -lt "$CORTE" ] || continue

  f="${ENCS[$i]}"
  sha="$f.sha256"
  nome="$(basename -- "$f")"
  tem_sha=0
  if [ -f "$sha" ] && [ ! -L "$sha" ]; then
    tem_sha=1
  fi

  if [ "$SIMULAR" -eq 1 ]; then
    if [ "$tem_sha" -eq 1 ]; then
      echo "apagaria: $nome e $nome.sha256"
      ARQUIVOS=$((ARQUIVOS + 2))
    else
      echo "apagaria: $nome"
      ARQUIVOS=$((ARQUIVOS + 1))
    fi
    PARES=$((PARES + 1))
    continue
  fi

  # Ordem: o .enc sai primeiro. So depois de ele sair o .sha256 pode sair.
  if ! rm -f -- "$f"; then
    echo "FALHOU: nao consegui apagar $nome." >&2
    ERROS=$((ERROS + 1))
    continue
  fi
  echo "apagado: $nome"
  ARQUIVOS=$((ARQUIVOS + 1))
  if [ -f "$sha" ] && [ ! -L "$sha" ]; then
    if rm -f -- "$sha"; then
      echo "apagado: $nome.sha256"
      ARQUIVOS=$((ARQUIVOS + 1))
    else
      echo "FALHOU: nao consegui apagar $nome.sha256." >&2
      ERROS=$((ERROS + 1))
    fi
  fi
  PARES=$((PARES + 1))
done

if [ "$SIMULAR" -eq 1 ]; then
  echo "--dry-run: $PARES backup(s) venceram; apagaria $ARQUIVOS arquivo(s). Nada foi apagado."
else
  echo "pronto: $PARES backup(s) vencido(s) apagado(s), $ARQUIVOS arquivo(s) removido(s)."
fi

if [ "$ERROS" -gt 0 ]; then
  echo "FALHOU: $ERROS erro(s) de IO. Veja as linhas acima." >&2
  exit 1
fi
exit 0
