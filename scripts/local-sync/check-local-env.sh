#!/usr/bin/env bash
# Refuse to run destructive local-sync operations unless .env demonstrably
# points at the local dev stack.
#
# Unlike scripts/staging/check-staging-env.sh, local dev has one .env file,
# not a staging-vs-prod pair to diff — so this checks self-consistency
# against this repo's known local defaults (.env.example) rather than
# comparing two files. pull-prod-snapshot.sh's actual dropdb/pg_restore/mc
# mirror calls hardcode the local container names (aivastra-postgres,
# aivastra-minio) and so can't target a remote host regardless of what .env
# says — this guardrail exists to catch a misconfigured .env before the
# developer draws the wrong conclusion from what lands locally, not to
# protect those calls themselves.
#
# Usage: check-local-env.sh <env-file>
set -euo pipefail

env_file="${1:?usage: check-local-env.sh <env-file>}"
[ -r "$env_file" ] || { echo "guardrail: cannot read $env_file" >&2; exit 1; }

read_var() {
  local key="$1"
  grep -E "^${key}=" "$env_file" | tail -n1 | cut -d= -f2- | tr -d '\r"' || true
}

failed=0
reject() { echo "guardrail: $1" >&2; failed=1; }

[ "$(read_var NODE_ENV)" != "production" ] \
  || reject "NODE_ENV is 'production' in $env_file"

db_url="$(read_var DATABASE_URL)"
case "$db_url" in
  postgres://*@127.0.0.1:*|postgres://*@localhost:*) ;;
  *) reject "DATABASE_URL does not point at 127.0.0.1/localhost: $db_url" ;;
esac

[ "$(read_var POSTGRES_DB)" = "tryon_dev" ] \
  || reject "POSTGRES_DB is not 'tryon_dev' in $env_file"

r2_endpoint="$(read_var R2_ENDPOINT)"
case "$r2_endpoint" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) reject "R2_ENDPOINT does not point at 127.0.0.1/localhost: $r2_endpoint" ;;
esac

[ "$(read_var R2_BUCKET)" = "virtual-tryon-dev" ] \
  || reject "R2_BUCKET is not 'virtual-tryon-dev' in $env_file"

if [ "$failed" -ne 0 ]; then
  echo "guardrail: local snapshot pull aborted; no container was touched" >&2
  exit 1
fi

echo "guardrail: $env_file passed all checks"
