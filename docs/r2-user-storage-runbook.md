# R2 user storage — runbook

End-user inputs and outputs move to Cloudflare R2; admin assets and merchant
library content stay on the VPS's self-hosted MinIO. This runbook covers
setting it up per environment, testing it, the production cutover, the copy of
existing objects, and rollback.

Decided 2026-10-15. Code: `packages/storage/src/routing.ts` (which prefix goes
where), `routed.ts` (the router), `user-storage-config.ts` (env → config).

## What goes where

Routing is by the key's first path segment — `routing.ts` is the source of
truth, and `packages/storage/test/routing.test.ts` pins every `keys.*` builder
to a backend.

| R2 (`user`) | MinIO (`asset`) |
|---|---|
| `inputs/`, `outputs/`, `widget-outputs/` | `models/`, `catalog/`, `demo-catalog/` |
| `user-backgrounds/`, `extension/`, `dev/` | `tryon/`, `saree/`, `saree-styles/` |
| `merchant-inputs/` (kiosk shopper photos) | `merchant-catalog/` (merchant try-on library) |
| `shopify-inputs/`, `shopify-garments/`, `shopify-catalog-garments/` (legacy) | `merchant-logo/`, `merchant-loading-video/` |
| `support/`, `invoices/` | `shopify/` (baskets), `sample-videos/`, `fabric-garment-types/`, `config/`, `wordpress-plugin-releases/` |

A key whose prefix isn't in the table: **writes throw** (`UnroutableKeyError`),
**reads and deletes go to MinIO** with a `storage key has no routing rule`
warning — anything under an unknown shape can only predate the split.

## Configuration

Same variables for `apps/api` and `apps/dispatcher` (both read the whole env
file in every compose file, so nothing to add there):

| Var | |
|---|---|
| `USER_STORAGE_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` — no bucket in the path |
| `USER_STORAGE_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | R2 API token, **Object Read & Write, scoped to this one bucket** |
| `USER_STORAGE_BUCKET` | `aivastra-user-dev` / `aivastra-user-staging` / `aivastra-user-prod` |
| `USER_STORAGE_PUBLIC_URL` | optional — nothing reads it (user objects are always presigned) |
| `USER_STORAGE_READ_FALLBACK` | `true` = an R2 miss on a user key is retried on MinIO. Literal `'true'` only |

Modes:

- **Off** — the four required vars blank/unset. Every key on MinIO, exactly as
  before the split. Default for local dev and staging.
- **Split** — vars set, fallback off. User keys live only in R2.
- **Split + fallback** — the migration window. New user objects go to R2;
  reads that miss in R2 are served from MinIO and counted in
  `storage_read_fallback_total{service,op}`; deletes remove both copies.

Setting only some of the four required vars fails startup on purpose.

**One bucket and one token per environment, never shared.** Every environment
runs the upload sweeper, which deletes `inputs/` objects its own database
doesn't reference — a staging or local stack holding production's bucket
would delete production uploads. Two guardrails enforce part of this:
`scripts/staging/check-staging-env.sh` rejects a staging bucket or access key
matching production's, and `scripts/local-sync/check-local-env.sh` rejects a
local bucket named like `*prod*`. The token scoping is what actually prevents it.

## Cloudflare setup (per environment)

Dashboard state — record each bucket, token (name only) and rule in
`docs/progress.md` when created.

1. **R2 → Create bucket** `aivastra-user-<env>`. Keep it private (no public
   access, no r2.dev subdomain).
2. **R2 → Manage API tokens → Create** — permission *Object Read & Write*,
   *Apply to specific buckets only* → this bucket.
3. **Bucket → Settings → CORS policy.** Browsers PUT uploads and load results
   straight from R2 via presigned URLs, and the Shopify widget / WordPress
   plugin do so from merchants' own domains — so origins can't be an
   allow-list. The presigned signature is the access control.

   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. Lifecycle rule for `support/` — **not yet**, see Deferred below.

## Testing

### Locally

1. Create the `aivastra-user-dev` bucket + scoped token (steps above).
2. Fill the `USER_STORAGE_*` block in your root `.env` (see `.env.example`),
   with `USER_STORAGE_READ_FALLBACK=true` — local objects from a production
   snapshot stay on local MinIO and are served through the fallback.
3. `pnpm --filter @aivastra/api check:storage` — must print `all checks passed`.
4. `pnpm dev`, then run a Studio try-on, a kiosk try-on and a Shopify widget
   try-on end to end. The api and dispatcher each log
   `storage routing configured` with the bucket name at startup.
5. Confirm in the R2 dashboard that the new `inputs/` and `outputs/` objects
   landed there, and that `models/…` objects did not.

### Staging

1. Create `aivastra-user-staging` + its own token.
2. Add the vars to `.env.staging` on the VPS (fallback `true`); redeploy.
   `check-staging-env.sh` runs as part of the deploy.
3. `docker exec -w /app/apps/api aivastra-staging-api pnpm check:storage`
4. Same end-to-end flows as local, on `staging-app` / `staging-admin`, plus
   one Shopify storefront upload (exercises CORS from a foreign origin).
5. Watch logs for `user storage read fell back to MinIO` (expected for
   pre-existing objects) and `storage key has no routing rule` (not expected —
   investigate each).

`check:storage` touches only objects under a unique `__storage-check-*`
segment and deletes them on exit, so it is also safe to run in production.

## Production cutover

1. **Deploy the code with `USER_STORAGE_*` unset.** Behaviour is unchanged
   (everything on MinIO) — this separates "new code" from "new storage".
2. Create `aivastra-user-prod` + token + CORS rule.
3. Set the vars in the production env with `USER_STORAGE_READ_FALLBACK=true`;
   restart api and dispatcher.
4. `pnpm check:storage` in the prod api container.
5. Smoke-test the main flows; watch error rates and
   `storage_read_fallback_total`.
6. **Copy existing user objects MinIO → R2** (next section).

### Copying existing objects — MinIO is never emptied

Use `rclone copy` only — **never `sync`, `move`, `delete` or `purge`**.
`copy` adds and updates on the destination and never deletes anything on
either side. MinIO keeps its full copy of every user object until the owner
explicitly signs off on R2; there is no step in this runbook that removes it.

Remotes (`rclone config`), both type `s3`: `minio` (provider `Minio`,
MinIO's S3 endpoint as reachable from where rclone runs) and `r2` (provider
`Cloudflare`, the prod R2 token).

```bash
SRC=minio:<R2_BUCKET value — the MinIO bucket>
DST=r2:aivastra-user-prod
for p in inputs outputs widget-outputs user-backgrounds merchant-inputs \
         shopify-inputs shopify-garments shopify-catalog-garments \
         extension dev support invoices; do
  rclone copy "$SRC/$p" "$DST/$p" --update --transfers 16 --checkers 32 --dry-run
done
# review the dry run, then repeat without --dry-run
```

`--update` is what makes this safe while live: some keys are overwritten in
place (a re-synced `shopify-garments/…/garment.jpg`, a regenerated
`outputs/<jobId>/result.png`), so R2 may already hold a newer version than
MinIO. Plain `copy` overwrites on any size/modtime difference; `--update` skips
any file that is newer on the destination.

After the copy, `storage_read_fallback_total` should flatten to ~zero. Only
then, and only with the owner's go-ahead, set
`USER_STORAGE_READ_FALLBACK=false`. Even then the MinIO copies stay until
separately approved.

### What still deletes MinIO copies during the window

Per-object deletes the application already performs — Shopify retention,
GDPR redaction, the upload sweeper's orphan cleanup, admin "delete job
assets" — remove **both** copies while the fallback is on. That is required
(GDPR erasure must not leave a copy behind) and is the same deletion that
would have happened without R2. Nothing deletes MinIO data in bulk.

## Rollback — point everything back at MinIO

Objects created after the cutover exist **only in R2**, so copy them back
first, then switch:

1. Copy R2 → MinIO, same prefix loop as above with `SRC`/`DST` swapped
   (`rclone copy --update`, dry run first).
2. Blank the four required `USER_STORAGE_*` vars; restart api and dispatcher.
   Startup logs `storage routing configured` with `userStorage: "off"`.
3. Re-run step 1 once more to pick up anything written during the restart.

Presigned R2 URLs already handed to browsers keep working until they expire
(≤ 1 h), since the R2 bucket itself is untouched.

## Deferred

- **Support-attachment 30-day TTL** (decided 2026-10-15, option "A + B", to be
  built on its own branch): an R2 lifecycle rule expiring `support/` after 30
  days, plus an api sweeper that deletes expired attachments and nulls
  `chatbot_messages.attachment_key` / `contact_requests.attachment_key` so the
  admin inbox (`apps/admin-web/src/pages/ChatInboxPage.tsx`,
  `apps/api/src/modules/admin/contact.routes.ts`) shows "attachment expired"
  instead of a dead link.
- **Kiosk shopper photos** (`merchant-inputs/`) have no retention at all,
  unlike Shopify's — worth a product decision.
- **Scripts** under `scripts/` (seeding, `backfill-thumbnails.mts`) build
  their own MinIO providers and don't route; fine for seeding admin assets,
  wrong for anything touching user prefixes once production is split.
- **Local prod snapshot** (`make sync-prod-snapshot`) copies only MinIO; once
  production is split, newer user objects won't be in it (the fallback hides
  this for anything older than the cutover).
