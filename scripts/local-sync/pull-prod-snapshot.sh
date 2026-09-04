#!/usr/bin/env bash
# Pull the latest production snapshot into the local dev stack. Destructive:
# drops and recreates the local Postgres database and mirrors MinIO objects.
# Run by a developer, locally. See docs/local-dev-snapshot-runbook.md for
# one-time setup (age keypair, DEV_SNAPSHOT_* credentials).
#
# KNOWN BROKEN as of 2026-09-03 — every `mc alias set distm '$DIST_ENDPOINT'`
# call below fails. `mc` refuses any endpoint URL with a path component
# ("Invalid URL ... without resource component"), and DEV_SNAPSHOT_ENDPOINT
# is the public app.aivastra.com/minio proxy path, so this fails immediately
# at the very first mc call (downloading the dump), before ever reaching the
# asset-mirror step. Even if mc's URL validation were bypassed, the deeper
# problem is a SigV4 signing mismatch: mc would sign against the same
# conflated path it sends the request to, but Nginx strips /minio before
# MinIO validates the signature, so every request 403s with
# SignatureDoesNotMatch (confirmed against the real distribution bucket).
# apps/api/src/modules/admin/prod-snapshot.routes.ts works around this for
# the single admin-panel download by splitting signEndpoint (no /minio, used
# for signing) from presignBaseUrl (with /minio, used only for the final
# fetch) — but mc has no equivalent mechanism, and neither does a bulk
# multi-object mirror the way this script needs. Fixing this needs a bespoke
# script (e.g. Node + @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner)
# that presigns each list/get individually using that same split, in place
# of every mc call below. Not yet written — do not run this script for real
# until it is.
#
# Usage: scripts/local-sync/pull-prod-snapshot.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"

echo "→ verifying local env before touching anything"
bash "$ROOT/scripts/local-sync/check-local-env.sh" "$ENV_FILE"

env_var() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r"'
}

PG_USER="$(env_var POSTGRES_USER)"
PG_DB="$(env_var POSTGRES_DB)"
MINIO_USER="$(env_var MINIO_ROOT_USER)"
MINIO_PASS="$(env_var MINIO_ROOT_PASSWORD)"
BUCKET="$(env_var R2_BUCKET)"

DIST_BUCKET="${DEV_SNAPSHOT_BUCKET:?set DEV_SNAPSHOT_BUCKET (see .env.example)}"
DIST_ENDPOINT="${DEV_SNAPSHOT_ENDPOINT:?set DEV_SNAPSHOT_ENDPOINT (see .env.example)}"
DIST_ACCESS_KEY="${DEV_SNAPSHOT_ACCESS_KEY_ID:?set DEV_SNAPSHOT_ACCESS_KEY_ID (see .env.example)}"
DIST_SECRET_KEY="${DEV_SNAPSHOT_SECRET_ACCESS_KEY:?set DEV_SNAPSHOT_SECRET_ACCESS_KEY (see .env.example)}"
AGE_IDENTITY="${DEV_SNAPSHOT_AGE_IDENTITY:?set DEV_SNAPSHOT_AGE_IDENTITY to your age private key path (see docs/local-dev-snapshot-runbook.md)}"

command -v age >/dev/null 2>&1 \
  || { echo "age is not installed — see docs/local-dev-snapshot-runbook.md" >&2; exit 1; }
[ -r "$AGE_IDENTITY" ] \
  || { echo "cannot read age identity at $AGE_IDENTITY" >&2; exit 1; }

WORKDIR="$(mktemp -d /tmp/aivastra-pull-XXXXXX)"
umask 077
trap 'rm -rf "$WORKDIR"' EXIT

echo "→ downloading encrypted snapshot from $DIST_BUCKET"
docker run --rm --network host -v "$WORKDIR:/out" --entrypoint /bin/sh minio/mc:latest -c "
  mc alias set distm '$DIST_ENDPOINT' '$DIST_ACCESS_KEY' '$DIST_SECRET_KEY' &&
  mc cp distm/$DIST_BUCKET/db/latest.dump.age /out/latest.dump.age &&
  mc cp distm/$DIST_BUCKET/db/manifest.json /out/manifest.json
"
echo "  manifest: $(cat "$WORKDIR/manifest.json")"

echo "→ decrypting"
if ! age -d -i "$AGE_IDENTITY" -o "$WORKDIR/latest.dump" "$WORKDIR/latest.dump.age" 2>"$WORKDIR/age-error.log"; then
  echo "decrypt failed:" >&2
  cat "$WORKDIR/age-error.log" >&2
  echo "check that DEV_SNAPSHOT_AGE_IDENTITY points at your private key and that your public key is in scripts/local-sync/age-recipients.txt (ask the operator to re-run the export after adding it)" >&2
  exit 1
fi
rm -f "$WORKDIR/latest.dump.age"

echo "→ recreating local database $PG_DB"
docker exec aivastra-postgres dropdb -U "$PG_USER" --if-exists --force "$PG_DB"
docker exec aivastra-postgres createdb -U "$PG_USER" "$PG_DB"
docker exec -i aivastra-postgres pg_restore -U "$PG_USER" -d "$PG_DB" --no-owner --no-acl < "$WORKDIR/latest.dump"
rm -f "$WORKDIR/latest.dump"

echo "→ mirroring assets into local MinIO bucket $BUCKET"
docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -c "
  mc alias set distm '$DIST_ENDPOINT' '$DIST_ACCESS_KEY' '$DIST_SECRET_KEY' &&
  mc alias set localm http://127.0.0.1:9000 '$MINIO_USER' '$MINIO_PASS' &&
  mc mb --ignore-existing localm/$BUCKET &&
  mc mirror --overwrite --exclude 'db/*' distm/$DIST_BUCKET localm/$BUCKET
"

echo "→ applying post-restore safety fixups"
docker exec -i aivastra-postgres psql -U "$PG_USER" -d "$PG_DB" \
  -f - < "$ROOT/scripts/staging/post-restore.sql"

echo "→ applying any migrations not yet in the snapshot"
(cd "$ROOT" && pnpm db:migrate)

echo "→ summary"
docker exec aivastra-postgres psql -tAU "$PG_USER" -d "$PG_DB" -c "
  select 'workers: ' || count(*) from workers
  union all select 'model_faces: ' || count(*) from model_faces
  union all select 'model_poses: ' || count(*) from model_poses
  union all select 'workflow_templates: ' || count(*) from workflow_templates
  union all select 'payments (schema only): ' || count(*) from payments
  union all select 'audit_logs (schema only): ' || count(*) from audit_logs;
"

echo "✓ local snapshot pull complete"
