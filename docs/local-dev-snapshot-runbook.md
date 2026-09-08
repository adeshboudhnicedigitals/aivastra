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

`mc admin policy create` needs a real file path for the policy document, not
stdin — write it to a temp file first, mount it into the container, then
clean up:

```bash
cat > /tmp/dev-snapshot-readonly-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:ListBucket"],
    "Resource": [
      "arn:aws:s3:::virtual-tryon-dev-snapshot",
      "arn:aws:s3:::virtual-tryon-dev-snapshot/*"
    ]
  }]
}
EOF

docker run --rm --network host \
  -v /tmp/dev-snapshot-readonly-policy.json:/tmp/policy.json:ro \
  --entrypoint /bin/sh minio/mc:latest -c "
  mc alias set prodm http://127.0.0.1:9000 '<MINIO_ROOT_USER>' '<MINIO_ROOT_PASSWORD>' &&
  mc mb --ignore-existing prodm/virtual-tryon-dev-snapshot &&
  mc admin user add prodm dev-snapshot-reader '<generate a strong password>' &&
  mc admin policy create prodm dev-snapshot-readonly /tmp/policy.json &&
  mc admin policy attach prodm dev-snapshot-readonly --user dev-snapshot-reader
"

rm /tmp/dev-snapshot-readonly-policy.json
```

Hand out the resulting access key / secret to developers out-of-band
(1Password or equivalent) as `DEV_SNAPSHOT_ACCESS_KEY_ID` /
`DEV_SNAPSHOT_SECRET_ACCESS_KEY` — **never commit these, never reuse the live
`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`.**

**The `/minio/` proxy forwarding arbitrary bucket paths was verified against
the real bucket on 2026-09-03** — a plain `curl -sI` returns MinIO's own
`AccessDenied` (via `x-minio-error-code`), not a generic Nginx 404, and an
authenticated request signed correctly (see below) returns `NoSuchKey`
rather than an auth or routing error. Routing itself is not the problem.

**What *is* broken:** any tool that signs a request using the same URL it
sends it to (`mc`, `aws-cli`, and a plain, non-split `S3Client`) fails with
`SignatureDoesNotMatch` through this proxy — Nginx strips `/minio` before
MinIO validates the signature, so the client's signed path never matches
what MinIO receives. `apps/api/src/modules/admin/prod-snapshot.routes.ts`
works around this for the admin-panel download button by signing against
`R2_SIGN_ENDPOINT` (the public host, no `/minio`) and only inserting
`/minio` into the URL string *after* signing, via `R2_PUBLIC_PRESIGN_BASE` —
this is why the button reuses those existing live-bucket values instead of
a separate `DEV_SNAPSHOT_ENDPOINT`. `mc` has no equivalent mechanism, which
is why `pull-prod-snapshot.sh`'s `mc`-based steps are currently broken — see
§4 below.

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

No `DEV_SNAPSHOT_*` env vars need to be exported for this step — the script
reads MinIO root credentials straight out of `.env.production` for both the
live-bucket read and the distribution-bucket write. `DEV_SNAPSHOT_ACCESS_KEY_ID`/
`SECRET_ACCESS_KEY` are scoped read-only and would fail with `Access Denied` if
used here — they're for developers pulling *from* the bucket (§4), never for
the operator writing *to* it.

Once `DEV_SNAPSHOT_*` is set in `.env.production` (see `.env.production.example`),
a superadmin can also grab the DB dump portion via the admin panel — Settings
→ Prod Snapshot → "Download DB snapshot" — instead of `mc`/`scp`. It's the
*same* `db/latest.dump.age` object this export step already produces, still
`age`-encrypted, so the recipient still needs to be onboarded (§2) to decrypt
it. This doesn't replace the export step above, and it never touches the
~15.6G of assets — those still only move via `mc mirror`/`pull-prod-snapshot.sh`.

## 4. Pulling the snapshot (developer, laptop)

**Not yet working** — `scripts/local-sync/pull-prod-snapshot.sh`'s `mc`-based
steps (both downloading `db/latest.dump.age` and mirroring assets) fail
against the public distribution bucket. See the warning comment at the top
of that script for the full explanation; short version: `mc alias set`
outright refuses a URL with a path component (`app.aivastra.com/minio`),
and even a client that tolerated the URL would still fail to sign correctly
through this proxy the way §1 describes. Needs a bespoke script (presigning
each list/get individually, same `signEndpoint`/`presignBaseUrl` split the
admin-panel button uses) in place of `mc` — not written yet.

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
