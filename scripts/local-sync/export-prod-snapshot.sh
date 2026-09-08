#!/usr/bin/env bash
# Export a snapshot of production for developer laptops to pull. Run by an
# operator on the VPS, never by CI, never on a laptop (prod Postgres/MinIO's
# internal port aren't reachable from one — see docs/local-dev-snapshot-runbook.md).
#
# Same shape as scripts/staging/sync-from-prod.sh's step 1: production is
# touched READ-ONLY, one pg_dump and one mc mirror source. This script writes
# only to a new, dedicated distribution bucket — never to a live prod
# container, volume, or the live bucket.
#
# Unlike sync-from-prod.sh, which never leaves the VPS's internal Docker
# network, this relays through app.aivastra.com/minio/ (public-facing) so a
# developer's laptop can reach it. Two things compensate for that:
#   - payments/audit_logs row data is excluded from the dump (schema kept,
#     so pg_restore's FK ordering is untouched) — least debugging value,
#     most compliance weight of any two tables in the DB.
#   - the dump is age-encrypted before upload, to every developer's public
#     key in age-recipients.txt. Removing a line there stops that developer
#     from decrypting *future* exports; it does nothing for a copy already
#     pulled — noted here and in the runbook, not oversold.
#
# Usage:
#   scripts/local-sync/export-prod-snapshot.sh            # perform the export
#   scripts/local-sync/export-prod-snapshot.sh --dry-run  # print what would run, change nothing
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROD_ENV="${PROD_ENV_FILE:-$ROOT/.env.production}"
[ -r "$PROD_ENV" ] || { echo "cannot read $PROD_ENV — set PROD_ENV_FILE to the production env file" >&2; exit 1; }

RECIPIENTS_FILE="$ROOT/scripts/local-sync/age-recipients.txt"
[ -r "$RECIPIENTS_FILE" ] || { echo "cannot read $RECIPIENTS_FILE" >&2; exit 1; }
RECIPIENT_COUNT="$(grep -Ev '^\s*#|^\s*$' "$RECIPIENTS_FILE" | wc -l | tr -d ' ')"
[ "$RECIPIENT_COUNT" -gt 0 ] || { echo "no age recipients in $RECIPIENTS_FILE — add at least one developer's public key first (see docs/local-dev-snapshot-runbook.md)" >&2; exit 1; }

DIST_BUCKET="${DEV_SNAPSHOT_BUCKET:-virtual-tryon-dev-snapshot}"
# Deliberately NOT using DEV_SNAPSHOT_ACCESS_KEY_ID/SECRET_ACCESS_KEY here — that
# credential is scoped read-only (s3:GetObject/s3:ListBucket) for developers
# pulling from the bucket, and this step writes to it (mc mb/mirror/cp), which
# a read-only policy correctly rejects with Access Denied. The operator running
# this script already holds MinIO root (PROD_MINIO_USER/PROD_MINIO_PASS, read
# below) for the live-bucket read, so the same credential is reused for the
# distribution-bucket write below — same trust boundary, same MinIO instance.

umask 077
DUMP="$(mktemp /tmp/aivastra-snapshot-XXXXXX.dump)"
ENC="$DUMP.age"
MANIFEST="$(mktemp /tmp/aivastra-manifest-XXXXXX.json)"
trap 'rm -f "$DUMP" "$ENC" "$MANIFEST"' EXIT

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: $*"
  else
    "$@"
  fi
}

env_var() {
  local key="$1" file="$2"
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | tr -d '\r"'
}

PROD_PG_USER="$(env_var POSTGRES_USER "$PROD_ENV")"
PROD_PG_DB="$(env_var POSTGRES_DB "$PROD_ENV")"
PROD_MINIO_USER="$(env_var MINIO_ROOT_USER "$PROD_ENV")"
PROD_MINIO_PASS="$(env_var MINIO_ROOT_PASSWORD "$PROD_ENV")"
PROD_BUCKET="$(env_var R2_BUCKET "$PROD_ENV")"

# 1 ── dump production (read-only), skipping the two highest-sensitivity tables' row data
echo "→ dumping prod database $PROD_PG_DB (payments/audit_logs: schema only)"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY-RUN: docker exec aivastra-prod-postgres pg_dump -Fc -U $PROD_PG_USER --exclude-table-data=payments --exclude-table-data=audit_logs $PROD_PG_DB > $DUMP"
else
  docker exec aivastra-prod-postgres pg_dump -Fc -U "$PROD_PG_USER" \
    --exclude-table-data=payments --exclude-table-data=audit_logs \
    "$PROD_PG_DB" > "$DUMP"
  echo "  dump size: $(du -h "$DUMP" | cut -f1)"
fi

# 2 ── encrypt before it ever leaves the VPS
echo "→ encrypting dump for $RECIPIENT_COUNT recipient(s)"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY-RUN: age -R $RECIPIENTS_FILE -o $ENC $DUMP"
else
  age -R "$RECIPIENTS_FILE" -o "$ENC" "$DUMP"
fi

# 3 ── mirror objects into a dedicated distribution bucket, same exclusions as
# sync-from-prod.sh (see that script for the measured prefix sizes)
MIRROR_EXCLUDES="--exclude inputs/* --exclude outputs/* --exclude merchant-inputs/* --exclude widget-outputs/* --exclude shopify-inputs/*"

echo "→ mirroring MinIO objects into distribution bucket $DIST_BUCKET (~15.6G expected)"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY-RUN: mc mirror prodm/$PROD_BUCKET distm/$DIST_BUCKET $MIRROR_EXCLUDES"
else
  docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -c "
    mc alias set prodm http://127.0.0.1:9000 '$PROD_MINIO_USER' '$PROD_MINIO_PASS' &&
    mc alias set distm http://127.0.0.1:9000 '$PROD_MINIO_USER' '$PROD_MINIO_PASS' &&
    mc mb --ignore-existing distm/$DIST_BUCKET &&
    mc mirror --overwrite $MIRROR_EXCLUDES \
      prodm/$PROD_BUCKET distm/$DIST_BUCKET
  "
fi

# 4 ── upload the encrypted dump + manifest
echo "→ uploading encrypted dump + manifest"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY-RUN: write db/manifest.json (timestamp, row counts, excludedTableData, schema marker)"
  echo "DRY-RUN: mc cp $ENC distm/$DIST_BUCKET/db/latest.dump.age"
  echo "DRY-RUN: mc cp manifest.json distm/$DIST_BUCKET/db/manifest.json"
else
  docker exec aivastra-prod-postgres psql -tAU "$PROD_PG_USER" -d "$PROD_PG_DB" -c "
    select json_build_object(
      'exportedAt', now(),
      'excludedTableData', array['payments','audit_logs'],
      'schemaMarker', (select max(hash) from drizzle.__drizzle_migrations)
    );" > "$MANIFEST"
  docker run --rm --network host \
    -v "$ENC:/tmp/latest.dump.age:ro" \
    -v "$MANIFEST:/tmp/manifest.json:ro" \
    --entrypoint /bin/sh minio/mc:latest -c "
    mc alias set distm http://127.0.0.1:9000 '$PROD_MINIO_USER' '$PROD_MINIO_PASS' &&
    mc cp /tmp/latest.dump.age distm/$DIST_BUCKET/db/latest.dump.age &&
    mc cp /tmp/manifest.json distm/$DIST_BUCKET/db/manifest.json
  "
fi

echo "✓ prod snapshot exported to $DIST_BUCKET"
