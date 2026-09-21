# Backfill missing invoices — design spec

## Context

A 2026-09-21 support audit (chat-only, no writes — see prompt history) found that
two support tickets asking "why is this user's invoice missing" both trace to
the same root cause: `payments.paid_at` predates 2026-08-12, the date the GST
invoice feature (`docs/superpowers/specs/2026-08-12-gst-invoice-for-credit-purchases-design.md`)
shipped. `issueInvoiceIfNeeded` (`apps/api/src/modules/payments/issue-invoice.ts`)
only ever runs as a side effect of a live payment confirming — nothing back-fills
history, so every payment that reached `status = 'paid'` before that date has no
`invoices` row and never will unless something explicitly issues one.

Across all `payments.status = 'paid'` rows in `tryon_prod`, 8 of 16 have no
invoice, and the gap lines up exactly with the 2026-08-12 launch:
`caf14910`, `5d98f0be`, `91771adb`, `33847856`, `3bf52399`, `d429c741`,
`80a41704` (`creationid2013@gmail.com`), `1fc68653` — all `plan_id = 'starter'`,
all paid before 2026-08-12 13:10 UTC.

CLAUDE.md's production-safety rule forbids ad-hoc `tsx`/`psql` data fixes
against prod, even one-off and deleted afterward — this must ship as a
committed script through the normal deploy pipeline (push → CI/CD), then be
invoked once against the deployed container.

This spec covers a repo-root ops script that closes the gap. It reuses
`issueInvoiceIfNeeded` as-is — no changes to invoice generation, numbering, or
storage logic.

## Goals

- Find every `payments` row that is `status = 'paid'` but has no matching
  `invoices` row, and issue one via the existing, already-tested
  `issueInvoiceIfNeeded`.
- No hardcoded payment-ID list — selection is a live query
  (`payments LEFT JOIN invoices ... WHERE invoices.id IS NULL`), so the same
  script also closes any *future* gap (e.g. a run where `issueInvoiceIfNeeded`
  silently failed and returned `null`), not just this specific historical
  batch.
- Dry-run by default: running with no flags lists what *would* be backfilled
  (payment id, user email, plan, total paise, paid date) and writes nothing.
  `--apply` is required to actually persist.
- Safe to re-run any number of times — rows already invoiced are excluded by
  the query itself, and `issueInvoiceIfNeeded` is independently idempotent
  (checks for an existing `invoices` row first).
- Kept in the repo permanently as a standing ops tool (not deleted after the
  first run), consistent with `check-billing-api-enabled.mts`.

## Non-goals

- **No customer emails.** `apps/catalogues-web`'s Settings → Invoices tab
  (`apps/catalogues-web/src/app/(app)/settings/page.tsx`) already lists every
  payment with a live `invoiceUrl` download link as soon as an `invoices` row
  + R2 PDF exist — the backfilled invoice becomes self-serve discoverable with
  no email required. Re-sending `sendPaymentReceiptEmail` ("Payment
  confirmed — …") for a purchase from weeks ago would read as a confusing
  duplicate notification. A distinct "here's your backfilled invoice" email
  template was considered and rejected as unnecessary scope for a document
  that's already reachable through the product.
- No changes to `issueInvoiceIfNeeded`, invoice numbering, PDF rendering, or
  R2 storage — this script is purely a selection query + loop over existing,
  tested logic.
- No retroactive fix for payments that are `status != 'paid'` (e.g. `failed`,
  `created`) — those never should have an invoice.
- No dedicated automated test for the script itself (see Testing below).
- **No coverage of `unlimited_plan_charges`.** That table also reaches
  `status: 'paid'` with real GST collected
  (`apps/api/src/modules/credits/unlimited-plan-renewal.ts`), but nothing
  calls `issueInvoiceIfNeeded` for it and `invoices.paymentId`'s FK to
  `payments.id` can't represent one — a clean `DONE: N ok, 0 failed` from
  this script does not mean every invoice gap in the system is closed, only
  every gap in `payments`.

## Design

### Selection query

```sql
SELECT payments.*
FROM payments
LEFT JOIN invoices ON invoices.payment_id = payments.id
WHERE payments.status = 'paid' AND invoices.id IS NULL
ORDER BY payments.paid_at ASC;
```

Expressed with Drizzle as a `leftJoin` + `isNull(schema.invoices.id)` filter,
matching the join style already used in
`apps/api/src/modules/payments/routes.ts`'s payment-history endpoint.

An optional `process.argv[2]` lets an operator pass one payment ID to target a
single row — same convention as `shopArg` in
`apps/api/scripts/backfill-shopify-products-create-webhook.mts`.

### Script mechanics

New file: `apps/api/scripts/backfill-missing-invoices.mts`, run via a new root
`package.json` script (`backfill:missing-invoices`), following the existing
`backfill:shopify-products-create-webhook` / `check:billing` convention
(`tsx --env-file=.env apps/api/scripts/backfill-missing-invoices.mts`).

Builds a minimal object satisfying what `issueInvoiceIfNeeded` needs from a
`FastifyInstance`, the same pattern used by the two existing backfill/check
scripts and by `scripts/seed-invoices.mts`:

- `db` — `createDb(process.env.DATABASE_URL)`
- `redis` — `new Redis(process.env.REDIS_URL)` (needed because
  `issueInvoiceIfNeeded` → `readSellerConfig` reads the `config:system` key)
- `storage` — `createR2Provider({ endpoint, accessKeyId, secretAccessKey,
  bucket, publicUrl, forcePathStyle, presignBaseUrl, signEndpoint })` built
  from `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` /
  `R2_BUCKET` / `R2_PUBLIC_URL` / `R2_FORCE_PATH_STYLE` /
  `R2_PUBLIC_PRESIGN_BASE` / `R2_SIGN_ENDPOINT`, each read through a
  `requireEnv` guard that exits with a clear message rather than an
  `undefined`-credentials crash deep inside the S3 client
- `log` — `{ info: console.log, warn: console.warn, error: console.error }`

Cast to `FastifyInstance` via `as never` at the call site, identical to the
two precedent scripts.

### Dry-run / `--apply`

- No flags: query, print a table of affected rows, exit 0. Nothing written.
- `--apply` (or `--apply <paymentId>` combined with the single-ID form):
  for each row, call `issueInvoiceIfNeeded(app, payment.id)`. Since that
  function never throws — it catches internally and returns `null` on any
  failure — the script counts `ok` (non-null result) vs `failed` (null)
  per row, logs which, and prints a final `DONE: N ok, M failed (T total)`
  summary. Exit code 1 if `failed > 0`, exit 0 otherwise. Matches the
  ok/failed accounting style of
  `backfill-shopify-products-create-webhook.mts`.

### Usage comment block

The script's header comment documents, same as the two precedent scripts:
why the gap exists, why it's safe to re-run, the two invocation forms, and
the required env vars (`DATABASE_URL`, `REDIS_URL`, `R2_*`).

## Rollout

1. Commit the script + root `package.json` entry, PR into `dev` per
   `docs/version-control.md`, through the normal deploy pipeline.
2. Promote `dev` → `main` the same way as any other change.
3. **Hard gate — do not skip:** get explicit sign-off from whoever owns GST
   filing before running `--apply`. `issueInvoiceIfNeeded` dates each
   invoice as the payment's original `paidAt` but allocates today's next
   sequential invoice number, so these 8 backfilled invoices will carry
   serial numbers issued after (and numerically higher than) invoices
   already dated later in FY2026-27, and may be dated into a GSTR-1 period
   that's already been filed. This is a known, accepted consequence of
   reusing `issueInvoiceIfNeeded` unchanged — see the script's own header
   comment — not something this script can fix on its own.
4. Run `pnpm backfill:missing-invoices` (no flags) against the deployed
   container — review the printed list matches the expected 8 rows.
5. Run `pnpm backfill:missing-invoices --apply`.
6. Spot-check: log in as `creationid2013@gmail.com` (or query
   `tryon_prod` read-only), confirm Settings → Invoices now shows a download
   link for `order_TMRQUu9OTZ0I7j`.
7. Record the run in `docs/progress.md` — payment IDs touched, ok/failed
   counts — same as the 2026-09-19 PR #384 webhook-backfill entry.

`--apply` now acquires a Postgres advisory lock for its whole write pass, so
only one instance can be applying at a time — a second concurrent `--apply`
prints a message and exits 1 rather than racing the first.

## Testing

No dedicated test file for the script itself, matching the precedent of both
existing backfill/check scripts
(`backfill-shopify-products-create-webhook.mts`, `check-billing-api-enabled.mts`
— neither has one). The logic it calls,`issueInvoiceIfNeeded`, already has
integration coverage in `apps/api/test/integration/issue-invoice.test.ts`;
this script contributes only a selection query and a thin loop over that
already-tested function. Verification is the dry-run list (step 3 above)
plus the post-`--apply` spot-check (step 5), reviewed by a human before and
after the real run — consistent with how the two precedent scripts are
operated.
