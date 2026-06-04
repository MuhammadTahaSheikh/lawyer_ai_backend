#!/usr/bin/env bash
# One-way copy: MySQL (read-only) → Supabase PostgreSQL (write target only).
# Does NOT modify schema or data on the old MySQL server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/scripts/.env.migration}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
elif [[ -n "${MYSQL_PASSWORD:-}" && -n "${SUPABASE_MIGRATION_URL:-}" ]]; then
  MYSQL_HOST="${MYSQL_HOST:-casesdb.cluster-cy05fj2evp1i.us-east-1.rds.amazonaws.com}"
  MYSQL_PORT="${MYSQL_PORT:-3306}"
  MYSQL_USER="${MYSQL_USER:-admin}"
  MYSQL_DATABASE="${MYSQL_DATABASE:-casesdb}"
else
  echo "Missing $ENV_FILE or exported MYSQL_PASSWORD + SUPABASE_MIGRATION_URL"
  echo "Run: ./scripts/setup-and-migrate.sh"
  exit 1
fi

for var in MYSQL_HOST MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE SUPABASE_MIGRATION_URL; do
  if [[ -z "${!var:-}" ]]; then
    echo "Set $var in $ENV_FILE"
    exit 1
  fi
done

MYSQL_PORT="${MYSQL_PORT:-3306}"

# pgloader often fails SSL to Supabase on macOS — Node migrator is the default
if [[ "${USE_PGLOADER:-}" == "1" ]] && command -v pgloader >/dev/null 2>&1; then
  :
else
  echo "Using Node migrator (read-only on MySQL)..."
  exec node "$ROOT/scripts/migrate-node.mjs"
fi

echo "=============================================="
echo " MySQL → Supabase migration (READ-ONLY source)"
echo "=============================================="
echo " Source (read only): ${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}"
echo " Target (write):     Supabase PostgreSQL"
echo ""
echo " MySQL will NOT be altered. Only SELECT/metadata reads run on source."
echo " Supabase public schema tables may be DROP/CREATE on TARGET if they exist."
echo "=============================================="
read -r -p "Continue? [y/N] " confirm
confirm_lower="$(echo "$confirm" | tr '[:upper:]' '[:lower:]')"
if [[ "$confirm_lower" != "y" ]]; then
  echo "Cancelled."
  exit 0
fi

LOAD_FILE="$(mktemp /tmp/pgloader-lawyerai.XXXXXX.load)"
trap 'rm -f "$LOAD_FILE"' EXIT

# URL-encode MySQL password (* and other chars break pgloader WITH clauses)
MYSQL_PASS_ENC="$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$MYSQL_PASSWORD")"

PG_TARGET="$SUPABASE_MIGRATION_URL"
if [[ "$PG_TARGET" != *"sslmode="* ]]; then
  if [[ "$PG_TARGET" == *"?"* ]]; then
    PG_TARGET="${PG_TARGET}&sslmode=require"
  else
    PG_TARGET="${PG_TARGET}?sslmode=require"
  fi
fi

cat > "$LOAD_FILE" <<EOF
/*
  READ-ONLY on MySQL: pgloader introspects and SELECTs from source only.
  All DROP/CREATE happens on Supabase (target) only.
*/
LOAD DATABASE
     FROM mysql://${MYSQL_USER}:${MYSQL_PASS_ENC}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}
     INTO ${PG_TARGET}

WITH
     create tables,
     create indexes,
     reset sequences,
     workers = 4,
     concurrency = 1,
     batch rows = 1000,
     batch size = 20MB

CAST
     type datetime to timestamptz drop default drop not null using zero-dates-to-null,
     type date drop not null drop default using zero-dates-to-null,
     type tinyint to boolean using tinyint-to-boolean,
     type year to integer

ALTER SCHEMA '${MYSQL_DATABASE}' RENAME TO 'public';
EOF

echo ""
echo "Running pgloader (this may take several minutes)..."
pgloader "$LOAD_FILE"

echo ""
echo "Done. Verify in Supabase → Table Editor that tables and row counts look right."
echo "Then set SUPABASE_DB_URL in .env (session pooler URI) and run: node -e \"require('./db')\""
