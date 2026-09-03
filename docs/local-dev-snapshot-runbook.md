# Local Dev Snapshot Runbook

New developers currently hand-build admin-curated data (faces, backgrounds,
poses, garment types, workflow templates, catalog taxonomy) through the admin
panel to get a working local environment — slow, and it never actually
matches production. This runbook covers a periodic, encrypted export of a
production snapshot that a laptop can pull instead.

Same underlying mechanism as `docs/staging-runbook.md`'s sync
(`pg_dump`/`pg_restore` + `mc mirror`), split across the trust boundary that
already exists in this repo: prod Postgres and prod MinIO's internal port are
never reachable from a laptop, by design (`Postgres and Redis bind to
127.0.0.1 only, never 0.0.0.0`). So the flow is: an operator exports on the
VPS into a dedicated distribution bucket, and a developer pulls from that
bucket over the public `/minio/` proxy.

**Scope:** the full production DB, same breadth as staging, except
`payments`/`audit_logs` row data (schema kept, so `pg_restore`'s FK ordering
still works) — the least debugging value and the most compliance weight of
any two tables here. Otherwise unscrubbed, same precedent as staging:
`shopify_stores.access_token` rides along as production ciphertext and
self-heals via the existing reprovision flow (see `scripts/staging/post-restore.sql`);
real users/jobs/credit ledgers pass through as real data.

**Because this relays through a public proxy** (unlike `sync-from-prod.sh`,
which never leaves the VPS's internal Docker network), the dump is encrypted
with [`age`](https://github.com/FiloSottile/age) before it's uploaded, to
every onboarded developer's public key. This is defense in depth, not the
only barrier — the distribution bucket also has its own scoped, read-only
credential, structurally incapable of reading a live customer object because
it's a bucket dedicated to snapshots, not a prefix inside the live one.

## 1. One-time operator setup (VPS)

Run these once, on the VPS, as whoever operates it (mirrors the "one-time
setup" pattern in `docs/staging-runbook.md`).

**Distribution bucket + scoped credential:**

```bash
docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -c "
  mc alias set prodm http://127.0.0.1:9000 '<MINIO_ROOT_USER>' '<MINIO_ROOT_PASSWORD>' &&
  mc mb --ignore-existing prodm/virtual-tryon-dev-snapshot &&
  mc admin user add prodm dev-snapshot-reader '<generate a strong password>' &&
  mc admin policy create prodm dev-snapshot-readonly - <<'POLICY'
{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": [\"s3:GetObject\", \"s3:ListBucket\"],
    \"Resource\": [
      \"arn:aws:s3:::virtual-tryon-dev-snapshot\",
      \"arn:aws:s3:::virtual-tryon-dev-snapshot/*\"
    ]
  }]
}
POLICY
  mc admin policy attach prodm dev-snapshot-readonly --user dev-snapshot-reader
"
```

Hand out the resulting access key / secret to developers out-of-band
(1Password or equivalent) as `DEV_SNAPSHOT_ACCESS_KEY_ID` /
`DEV_SNAPSHOT_SECRET_ACCESS_KEY` — **never commit these, never reuse the live
`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`.**

**Verify the `/minio/` proxy forwards arbitrary bucket paths** before relying
on it — don't assume. The existing Nginx rule was proven for the live
bucket only:

```bash
curl -sI https://app.aivastra.com/minio/virtual-tryon-dev-snapshot/ | head -5
```

If this 403s or 404s in a way that suggests the proxy is hardcoded to one
bucket, the distribution bucket needs its own `location` block — see the
vhost examples in `docs/staging-runbook.md` §6 for the pattern.

**`age` prerequisite** (also needed by every developer):

```bash
sudo apt install age      # Debian/Ubuntu
brew install age          # macOS
```

## 2. Onboarding a developer

1. They generate a keypair locally: `age-keygen -o ~/.config/age/aivastra-dev.key`
   — this prints a `Public key: age1...` line.
2. They send you that public key line (not the file — public keys aren't
   sensitive, but send the file itself and you'd also be sending the private
   half by accident).
3. Add it to `scripts/local-sync/age-recipients.txt` (a comment with their
   name above the key), commit, push through the normal PR flow.
4. Re-run the export (below) — the next snapshot is encrypted to the new
   recipient list. Nothing before this point is retroactively readable by
   them.
5. Give them the `DEV_SNAPSHOT_*` credential out-of-band. They fill in
   `.env`'s `DEV_SNAPSHOT_*` block (see `.env.example`), including
   `DEV_SNAPSHOT_AGE_IDENTITY=~/.config/age/aivastra-dev.key`.

**Offboarding:** delete their two lines from `age-recipients.txt`. This stops
*future* exports from being readable by them — it does nothing for a
snapshot they already pulled and decrypted. There is no revocation for that;
not solved here.

## 3. Regenerating the snapshot (operator, VPS)

```bash
bash scripts/local-sync/export-prod-snapshot.sh --dry-run   # read every line
bash scripts/local-sync/export-prod-snapshot.sh
```

Manual for v1 — no cron yet. Re-run whenever the snapshot drifts too far to
be useful, same disposable-environment philosophy as staging.

Once `DEV_SNAPSHOT_*` is set in `.env.production` (see `.env.production.example`),
a superadmin can also grab the DB dump portion via the admin panel — Settings
→ Prod Snapshot → "Download DB snapshot" — instead of `mc`/`scp`. It's the
*same* `db/latest.dump.age` object this export step already produces, still
`age`-encrypted, so the recipient still needs to be onboarded (§2) to decrypt
it. This doesn't replace the export step above, and it never touches the
~15.6G of assets — those still only move via `mc mirror`/`pull-prod-snapshot.sh`.

## 4. Pulling the snapshot (developer, laptop)

```bash
pnpm docker:up                        # local Postgres/Redis/MinIO must be running
make sync-prod-snapshot
```

This is destructive to your local `tryon_dev` database and `virtual-tryon-dev`
MinIO bucket — it drops and recreates both from the snapshot.
`check-local-env.sh` runs first and refuses if `.env` doesn't demonstrably
point at your local stack.

After it completes: `payments` and `audit_logs` exist with real schema but
zero rows (that's the one deliberate content difference from a full
production copy). `workers` is empty and `shopify_stores.uninstalled_at` is
set on every row — both applied by `scripts/staging/post-restore.sql`,
reused unchanged — so your local dispatcher can never select a live
production GPU, and Shopify tokens self-heal on first use instead of failing
silently.

## 5. Re-sync cadence

Same as staging: whenever your local data drifts too far to be useful. Your
local environment is disposable — fix it by re-running the pull, not by
hand-patching rows.
