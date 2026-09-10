#!/usr/bin/env bash
# Fixture-driven tests for check-local-env.sh. No Docker, no network — safe
# to run in CI like any other unit-style check. Same pattern as
# scripts/staging/check-staging-env.test.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/local-sync/check-local-env.sh"

TMPDIR="$(mktemp -d /tmp/aivastra-check-local-env-test-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

pass=0
fail=0

expect_pass() {
  local name="$1" file="$2"
  if bash "$CHECK" "$file" >/dev/null 2>&1; then
    echo "ok   - $name"
    pass=$((pass + 1))
  else
    echo "FAIL - $name (expected pass, got reject)"
    fail=$((fail + 1))
  fi
}

expect_fail() {
  local name="$1" file="$2"
  if bash "$CHECK" "$file" >/dev/null 2>&1; then
    echo "FAIL - $name (expected reject, got pass)"
    fail=$((fail + 1))
  else
    echo "ok   - $name"
    pass=$((pass + 1))
  fi
}

base_env() {
  cat <<'EOF'
NODE_ENV=development
DATABASE_URL=postgres://tryon:tryon_dev_pw@127.0.0.1:5432/tryon_dev
POSTGRES_DB=tryon_dev
R2_ENDPOINT=http://127.0.0.1:9000
R2_BUCKET=virtual-tryon-dev
EOF
}

clean="$TMPDIR/clean.env"
base_env > "$clean"
expect_pass "clean local .env passes" "$clean"

non_loopback_db="$TMPDIR/non_loopback_db.env"
base_env | sed 's#127.0.0.1:5432/tryon_dev#staging-app.aivastra.com:5432/tryon_dev#' > "$non_loopback_db"
expect_fail "non-loopback DATABASE_URL rejected" "$non_loopback_db"

non_loopback_r2="$TMPDIR/non_loopback_r2.env"
base_env | sed 's#http://127.0.0.1:9000#https://app.aivastra.com/minio#' > "$non_loopback_r2"
expect_fail "non-loopback R2_ENDPOINT rejected" "$non_loopback_r2"

wrong_pg_db="$TMPDIR/wrong_pg_db.env"
base_env | sed 's/POSTGRES_DB=tryon_dev/POSTGRES_DB=tryon_prod/' > "$wrong_pg_db"
expect_fail "wrong POSTGRES_DB rejected" "$wrong_pg_db"

wrong_bucket="$TMPDIR/wrong_bucket.env"
base_env | sed 's/R2_BUCKET=virtual-tryon-dev/R2_BUCKET=virtual-tryon-prod/' > "$wrong_bucket"
expect_fail "wrong R2_BUCKET rejected" "$wrong_bucket"

prod_node_env="$TMPDIR/prod_node_env.env"
base_env | sed 's/NODE_ENV=development/NODE_ENV=production/' > "$prod_node_env"
expect_fail "NODE_ENV=production rejected" "$prod_node_env"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
