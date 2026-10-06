#!/usr/bin/env bash
# Rebuilds a throwaway Postgres database from the migrations + seed and runs the
# core business-rule tests against it. Needs a local Postgres you can reach with psql.
#
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/test-db.sh
#
# Supabase's own `supabase db reset` + `supabase test db` work too once the CLI is installed;
# this script exists so CI and machines without Docker can run the same checks.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${TEST_DB:-giftora_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -t)

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/tests/local/supabase_shim.sql
for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f"
done
"${PSQL[@]}" -d "$DB" -f supabase/seed.sql
for t in supabase/tests/database/*_test.sql; do
  echo "== $t"
  "${PSQL[@]}" -d "$DB" -f "$t" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
done
