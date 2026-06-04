#!/usr/bin/env bash
# Quick check: can we reach MySQL with read-only queries only? (no writes)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/scripts/.env.migration}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Copy scripts/.env.migration.example → scripts/.env.migration first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

MYSQL_PORT="${MYSQL_PORT:-3306}"

MYSQL_BIN="${MYSQL_BIN:-}"
for p in /usr/local/opt/mysql@8.4/bin/mysql /opt/homebrew/opt/mysql@8.4/bin/mysql mysql; do
  if [[ -x "$p" ]] || command -v "$p" >/dev/null 2>&1; then MYSQL_BIN="$p"; break; fi
done
if [[ -z "$MYSQL_BIN" ]]; then
  echo "Install MySQL 8 client: brew install mysql@8.4"
  exit 1
fi

echo "Read-only checks on ${MYSQL_HOST}/${MYSQL_DATABASE} ..."

"$MYSQL_BIN" -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "
  SELECT 'connection_ok' AS status, DATABASE() AS db, NOW() AS server_time;
  SELECT COUNT(*) AS table_count FROM information_schema.tables
    WHERE table_schema = '${MYSQL_DATABASE}' AND table_type = 'BASE TABLE';
"

echo ""
echo "OK — only SELECT ran on MySQL. No schema or data was changed."
