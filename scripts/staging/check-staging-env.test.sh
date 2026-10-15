#!/usr/bin/env bash
# Fixture-driven tests for check-staging-env.sh. No Docker, no network.
set -uo pipefail

SCRIPT="$(dirname "$0")/check-staging-env.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

# A production env file to compare against.
cat > "$TMP/prod.env" <<'EOF'
COMPOSE_PROJECT_NAME=aivastra-prod
SHOPIFY_API_KEY=prodshopifykey123
EMAIL_FROM=no-reply@aivastra.com
RAZORPAY_KEY_ID=rzp_live_abc123
USER_STORAGE_BUCKET=aivastra-user-prod
USER_STORAGE_ACCESS_KEY_ID=prodr2key
EOF

# A staging env file that should pass every check.
good_env() {
  cat > "$TMP/staging.env" <<'EOF'
AIVASTRA_ENV=staging
COMPOSE_PROJECT_NAME=aivastra-staging
SHOPIFY_API_KEY=stagingshopifykey456
EMAIL_FROM=staging@staging.aivastra.com
RAZORPAY_KEY_ID=rzp_test_abc123
USER_STORAGE_BUCKET=aivastra-user-staging
USER_STORAGE_ACCESS_KEY_ID=stagingr2key
EOF
}

check() {
  local name="$1" expected="$2"
  bash "$SCRIPT" "$TMP/staging.env" "$TMP/prod.env" >/dev/null 2>"$TMP/err"
  local actual=$?
  if [ "$actual" = "$expected" ]; then
    echo "ok   - $name"
    pass=$((pass + 1))
  else
    echo "FAIL - $name (expected exit $expected, got $actual)"
    echo "       stderr: $(cat "$TMP/err")"
    fail=$((fail + 1))
  fi
}

good_env
check "clean staging env passes" 0

good_env
sed -i '/^AIVASTRA_ENV=/d' "$TMP/staging.env"
check "missing AIVASTRA_ENV marker is rejected" 1

good_env
sed -i 's/^AIVASTRA_ENV=.*/AIVASTRA_ENV=production/' "$TMP/staging.env"
check "AIVASTRA_ENV=production is rejected" 1

# The highest-consequence case: a COMPOSE_PROJECT_NAME left at production's value
# makes every staging compose command act on the production stack.
good_env
sed -i 's/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=aivastra-prod/' "$TMP/staging.env"
check "COMPOSE_PROJECT_NAME pointing at prod is rejected" 1

good_env
sed -i '/^COMPOSE_PROJECT_NAME=/d' "$TMP/staging.env"
check "missing COMPOSE_PROJECT_NAME is rejected" 1

good_env
sed -i 's/^RAZORPAY_KEY_ID=.*/RAZORPAY_KEY_ID=rzp_live_abc123/' "$TMP/staging.env"
check "live Razorpay key is rejected" 1

good_env
sed -i 's/^SHOPIFY_API_KEY=.*/SHOPIFY_API_KEY=prodshopifykey123/' "$TMP/staging.env"
check "Shopify key matching prod is rejected" 1

good_env
sed -i 's|^EMAIL_FROM=.*|EMAIL_FROM=no-reply@aivastra.com|' "$TMP/staging.env"
check "EMAIL_FROM matching prod is rejected" 1

# Staging's sweepers delete objects its own DB doesn't reference — aimed at
# prod's bucket they would delete production uploads.
good_env
sed -i 's/^USER_STORAGE_BUCKET=.*/USER_STORAGE_BUCKET=aivastra-user-prod/' "$TMP/staging.env"
check "R2 user bucket matching prod is rejected" 1

good_env
sed -i 's/^USER_STORAGE_ACCESS_KEY_ID=.*/USER_STORAGE_ACCESS_KEY_ID=prodr2key/' "$TMP/staging.env"
check "R2 access key matching prod is rejected" 1

good_env
sed -i '/^USER_STORAGE_/d' "$TMP/staging.env"
check "staging without R2 configured passes" 0

echo
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
