#!/usr/bin/env bash
# Interactive one-way copy: MySQL (read-only) → Supabase lawyerAi (twoadfuhzukurkixjycn)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_REF="twoadfuhzukurkixjycn"

MYSQL_HOST="${MYSQL_HOST:-casesdb.cluster-cy05fj2evp1i.us-east-1.rds.amazonaws.com}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-admin}"
MYSQL_DATABASE="${MYSQL_DATABASE:-casesdb}"

if [[ -z "${MYSQL_PASSWORD:-}" ]]; then
  read -r -s -p "MySQL password (admin@${MYSQL_HOST}, read-only): " MYSQL_PASSWORD
  echo ""
fi

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo "Supabase DB password (Project Settings → Database, or set when you created lawyerAi):"
  read -r -s -p "Password: " SUPABASE_DB_PASSWORD
  echo ""
fi

# pgloader needs direct connection, not pooler
SUPABASE_MIGRATION_URL="postgresql://postgres:${SUPABASE_DB_PASSWORD}@db.${PROJECT_REF}.supabase.co:5432/postgres"
SUPABASE_APP_URL="postgresql://postgres.${PROJECT_REF}:${SUPABASE_DB_PASSWORD//\@/%40}@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

export MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE
export SUPABASE_MIGRATION_URL

MYSQL_BIN="${MYSQL_BIN:-}"
if [[ -z "$MYSQL_BIN" ]]; then
  for p in /usr/local/opt/mysql@8.4/bin/mysql /opt/homebrew/opt/mysql@8.4/bin/mysql mysql; do
    if [[ -x "$p" ]] || command -v "$p" >/dev/null 2>&1; then
      MYSQL_BIN="$p"
      break
    fi
  done
fi

echo ""
echo "Checking MySQL (SELECT only, no changes)..."
"$MYSQL_BIN" -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e \
  "SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema='${MYSQL_DATABASE}' AND table_type='BASE TABLE';"

if ! command -v pgloader >/dev/null 2>&1; then
  echo "Install pgloader: brew install pgloader"
  exit 1
fi

echo ""
echo "Starting migration → Supabase (${PROJECT_REF})..."
echo "MySQL will NOT be modified."
bash "$ROOT/scripts/migrate-mysql-to-supabase.sh" <<< "y"

# Offer to patch main .env SUPABASE_DB_URL (session pooler for the app)
ENV_MAIN="$ROOT/.env"
if [[ -f "$ENV_MAIN" ]] && grep -q '^SUPABASE_DB_URL=$' "$ENV_MAIN" 2>/dev/null; then
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^SUPABASE_DB_URL=.*|SUPABASE_DB_URL=${SUPABASE_APP_URL}|" "$ENV_MAIN" 2>/dev/null || true
  else
    sed -i "s|^SUPABASE_DB_URL=.*|SUPABASE_DB_URL=${SUPABASE_APP_URL}|" "$ENV_MAIN" 2>/dev/null || true
  fi
  if grep -q '^SUPABASE_DB_URL=$' "$ENV_MAIN"; then
    echo "SUPABASE_DB_URL=${SUPABASE_APP_URL}" >> "$ENV_MAIN"
  fi
  echo "Updated SUPABASE_DB_URL in .env (session pooler)."
fi

echo ""
echo "Test backend: cd $ROOT && node -e \"require('./db')\""
