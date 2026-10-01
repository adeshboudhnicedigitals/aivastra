# Backfill Missing Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a permanent, idempotent ops script that finds every `payments` row that is `status = 'paid'` with no matching `invoices` row, and issues one via the existing `issueInvoiceIfNeeded`, closing the gap found in the 2026-09-21 support audit (8 pre-2026-08-12 payments with no GST invoice).

**Architecture:** One new repo-root-invoked script (`apps/api/scripts/backfill-missing-invoices.mts`) that builds a minimal Fastify-instance-shaped object (`db`, `redis`, `storage`, `log`) and calls the already-tested `issueInvoiceIfNeeded` in a loop over a dynamic LEFT JOIN selection query. Dry-run by default; `--apply` required to write. No email is sent — `apps/catalogues-web`'s Settings → Invoices tab already surfaces a download link once the `invoices` row + R2 PDF exist.

**Tech Stack:** tsx (ESM, run via `--env-file=.env`), Drizzle ORM (`@aivastra/db`), `@aivastra/storage`'s `createR2Provider`, `ioredis`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-21-backfill-missing-invoices-design.md`.
- No new/changed logic in `issueInvoiceIfNeeded`, invoice numbering, PDF rendering, or R2 storage — this script only selects rows and calls existing code.
- No hardcoded payment-ID list — selection must be a live query (`payments LEFT JOIN invoices ... WHERE invoices.id IS NULL`, `status = 'paid'`), so the script also catches any future gap.
- No customer email is sent by this script.
- Dry-run is the default; `--apply` is required to persist anything.
- The script must be safe to re-run any number of times (idempotent).
- Kept permanently in the repo — do not delete it after the first production run.
- No dedicated automated test file for the script (matches `apps/api/scripts/backfill-shopify-products-create-webhook.mts` and `apps/api/scripts/check-billing-api-enabled.mts`, neither of which has one — the logic it calls is already covered by `apps/api/test/integration/issue-invoice.test.ts`).
- ESM only (`"type": "module"`), Node ≥20.11 — matches root `package.json`.
- `console.log`/`console.error` for output is correct here (not a CLAUDE.md violation) — ops scripts under `apps/api/scripts/` deliberately use `console` instead of the pino logger, per the existing convention documented inline in `check-billing-api-enabled.mts` ("this is an ops script read by a human at a terminal").
- Never print `DATABASE_URL`, `REDIS_URL`, or any `R2_*` secret value.
- No schema or data changes against production outside the normal deploy pipeline (CLAUDE.md "Production safety") — this task only touches local dev Docker Postgres/MinIO for verification.

---

### Task 1: `backfill-missing-invoices.mts` script + pnpm entry

**Files:**
- Create: `apps/api/scripts/backfill-missing-invoices.mts`
- Modify: `package.json:27-28` (root) — add one script entry next to the two existing backfill/check entries

**Interfaces:**
- Consumes: `issueInvoiceIfNeeded(app: FastifyInstance, paymentId: string): Promise<{ invoiceNumber: string; pdfBuffer: Buffer } | null>` from `apps/api/src/modules/payments/issue-invoice.ts` (imported lazily by relative path, same convention as `backfill-shopify-products-create-webhook.mts`'s lazy import of `getValidAccessToken`).
- Consumes: `createDb(url: string): { db, close }`, `eq`, `isNull`, `asc`, `and`, `schema` from `@aivastra/db`.
- Consumes: `createR2Provider(cfg: R2Config): StorageProvider` from `@aivastra/storage`.
- Produces: `pnpm backfill:missing-invoices` (repo-root command). No other task in this plan depends on it.

- [ ] **Step 1: Write the script**

Create `apps/api/scripts/backfill-missing-invoices.mts`:

```ts
/**
 * Permanent, idempotent ops script: finds every payments row that is
 * status='paid' but has no matching invoices row, and issues one via the
 * existing issueInvoiceIfNeeded (apps/api/src/modules/payments/issue-invoice.ts).
 *
 * Why this is needed: issueInvoiceIfNeeded only ever runs as a side effect of
 * a live payment confirming (apps/api/src/modules/payments/routes.ts's
 * maybeSendReceipt). It never ran retroactively, so every payment that
 * reached 'paid' before the GST-invoice feature shipped (2026-08-12) has no
 * invoice and never will unless something explicitly issues one. The
 * selection query below has no date filter, so this also closes any future
 * gap — e.g. a run where issueInvoiceIfNeeded silently failed (it never
 * throws; it catches internally and returns null on any error).
 *
 * Sends no email. apps/catalogues-web's Settings > Invoices tab
 * (GET /v1/payments history + GET /v1/payments/:id/invoice) already lists
 * every payment with a download link as soon as an invoices row + R2 PDF
 * exist, so a backfilled invoice is self-serve discoverable without
 * resending a "payment confirmed" notification for a purchase from weeks
 * earlier.
 *
 * Safe to re-run: the selection query (LEFT JOIN invoices ... WHERE
 * invoices.id IS NULL) excludes rows once they're invoiced, and
 * issueInvoiceIfNeeded is independently idempotent (checks for an existing
 * invoices row first). Kept in the repo permanently, not deleted after use —
 * same convention as check-billing-api-enabled.mts.
 *
 * Usage:
 *   pnpm backfill:missing-invoices                     # dry run — lists affected payments, writes nothing
 *   pnpm backfill:missing-invoices --apply              # issues invoices for every affected payment
 *   pnpm backfill:missing-invoices <paymentId> --apply  # target one payment
 *
 * Requires env: DATABASE_URL, REDIS_URL, R2_ENDPOINT, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL. Optional: R2_FORCE_PATH_STYLE,
 * R2_PUBLIC_PRESIGN_BASE, R2_SIGN_ENDPOINT.
 */

import { and, asc, createDb, eq, isNull, schema } from '@aivastra/db';
import { createR2Provider } from '@aivastra/storage';
import Redis from 'ioredis';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const paymentIdArg = args.find((a) => !a.startsWith('--'));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const { db, close } = createDb(process.env.DATABASE_URL ?? '');

try {
  const whereClause = paymentIdArg
    ? and(
        eq(schema.payments.id, paymentIdArg),
        eq(schema.payments.status, 'paid'),
        isNull(schema.invoices.id),
      )
    : and(eq(schema.payments.status, 'paid'), isNull(schema.invoices.id));

  const rows = await db
    .select({
      id: schema.payments.id,
      planId: schema.payments.planId,
      totalPaise: schema.payments.totalPaise,
      paidAt: schema.payments.paidAt,
      email: schema.users.email,
    })
    .from(schema.payments)
    .innerJoin(schema.users, eq(schema.users.id, schema.payments.userId))
    .leftJoin(schema.invoices, eq(schema.invoices.paymentId, schema.payments.id))
    .where(whereClause)
    .orderBy(asc(schema.payments.paidAt));

  if (rows.length === 0) {
    console.log(
      paymentIdArg
        ? `No missing invoice found for payment ${paymentIdArg} (already invoiced, not paid, or does not exist).`
        : 'No paid payments are missing an invoice.',
    );
    process.exit(0);
  }

  console.log(`Found ${rows.length} paid payment(s) missing an invoice:\n`);
  for (const r of rows) {
    const rupees = (r.totalPaise / 100).toFixed(2);
    const paidAt = r.paidAt ? r.paidAt.toISOString() : 'unknown';
    console.log(`  ${r.id}  ${r.email}  ${r.planId}  ₹${rupees}  paid ${paidAt}`);
  }

  if (!apply) {
    console.log('\nDry run — no changes made. Re-run with --apply to issue these invoices.');
    process.exit(0);
  }

  const storage = createR2Provider({
    endpoint: requireEnv('R2_ENDPOINT'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    bucket: requireEnv('R2_BUCKET'),
    publicUrl: requireEnv('R2_PUBLIC_URL'),
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE === 'true',
    presignBaseUrl: process.env.R2_PUBLIC_PRESIGN_BASE,
    signEndpoint: process.env.R2_SIGN_ENDPOINT,
  });

  // Imported lazily and by path, same as backfill-shopify-products-create-webhook.mts:
  // this is an ops tool run from the repo root, and pulling in the api module
  // graph at the top would make a missing env var fail before the friendlier
  // checks above ever run.
  const { issueInvoiceIfNeeded } = await import('../src/modules/payments/issue-invoice.js');

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  const app = {
    db,
    redis,
    storage,
    log: { info: console.log, warn: console.warn, error: console.error },
  } as never;

  let ok = 0;
  let failed = 0;
  console.log('');
  try {
    for (const r of rows) {
      const result = await issueInvoiceIfNeeded(app, r.id);
      if (result) {
        console.log(`  issued ${result.invoiceNumber} for payment ${r.id} (${r.email})`);
        ok++;
      } else {
        console.error(`  FAILED to issue invoice for payment ${r.id} (${r.email})`);
        failed++;
      }
    }
  } finally {
    redis.disconnect();
  }

  console.log(`\nDONE: ${ok} ok, ${failed} failed (${rows.length} total)`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await close();
}
```

- [ ] **Step 2: Add the pnpm script entry**

In `package.json` (repo root), the `scripts` block currently has (around line 27-28):

```json
    "check:billing": "tsx --env-file=.env apps/api/scripts/check-billing-api-enabled.mts",
    "backfill:shopify-products-create-webhook": "tsx --env-file=.env apps/api/scripts/backfill-shopify-products-create-webhook.mts",
```

Add a new line directly after it:

```json
    "backfill:missing-invoices": "tsx --env-file=.env apps/api/scripts/backfill-missing-invoices.mts",
```

- [ ] **Step 3: Ensure the local dev stack is up and migrated**

```bash
pnpm docker:up
pnpm db:migrate
pnpm db:seed
```

Expected: all three exit 0. `pnpm db:seed` prints `→ login with admin@aivastra.dev / ...` — this creates the `users` row this task's verification will attach a payment to. If the stack is already running and seeded from earlier work, these are no-ops (migrate/seed are idempotent) — safe to run regardless.

- [ ] **Step 4: Insert a synthetic "paid, no invoice" payment for verification**

```bash
docker exec -i aivastra-postgres psql -U tryon -d tryon_dev -c "
INSERT INTO payments (user_id, plan_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, base_paise, gst_paise, total_paise, credits, status, paid_at)
SELECT id, 'starter', 'order_test_backfill_1', 'pay_test_backfill_1', 'test_sig', 250000, 45000, 295000, 2500, 'paid', now() - interval '60 days'
FROM users WHERE email = 'admin@aivastra.dev'
RETURNING id;
"
```

Expected: `INSERT 0 1` and the new payment's UUID printed. This mirrors exactly the situation the script targets — a `status = 'paid'` row with no `invoices` row — without needing to touch production data. `starter` is guaranteed to exist (seeded by migration `0029_credit_plans_seed.sql`, not by `db:seed`).

- [ ] **Step 5: Run the dry run and verify the listing**

```bash
pnpm backfill:missing-invoices
```

Expected output includes:
```
Found 1 paid payment(s) missing an invoice:

  <uuid>  admin@aivastra.dev  starter  ₹2950.00  paid <60-days-ago ISO timestamp>

Dry run — no changes made. Re-run with --apply to issue these invoices.
```
Exit code 0. Confirm no `invoices` row was created:
```bash
docker exec -i aivastra-postgres psql -U tryon -d tryon_dev -c "SELECT count(*) FROM invoices WHERE payment_id = (SELECT id FROM payments WHERE razorpay_order_id = 'order_test_backfill_1');"
```
Expected: `0`.

- [ ] **Step 6: Run with `--apply` and verify the invoice is issued**

```bash
pnpm backfill:missing-invoices --apply
```

Expected output includes:
```
Found 1 paid payment(s) missing an invoice:

  <uuid>  admin@aivastra.dev  starter  ₹2950.00  paid <timestamp>

  issued INV-2026-27-000001 for payment <uuid> (admin@aivastra.dev)

DONE: 1 ok, 0 failed (1 total)
```
(The exact `INV-` number depends on what else has been issued in this dev DB — any `INV-...` value with `0 failed` is a pass.) Exit code 0 — confirm with `echo $?`.

Confirm the row now exists and has a non-null `r2_key` (proof the R2/MinIO `putObject` succeeded — `issueInvoiceIfNeeded` would have returned `null`, counted as `failed`, if it hadn't):
```bash
docker exec -i aivastra-postgres psql -U tryon -d tryon_dev -c "SELECT invoice_number, r2_key IS NOT NULL AS has_r2_key FROM invoices WHERE payment_id = (SELECT id FROM payments WHERE razorpay_order_id = 'order_test_backfill_1');"
```
Expected: one row, `has_r2_key = t`.

- [ ] **Step 7: Verify idempotency**

```bash
pnpm backfill:missing-invoices
```
Expected: `No paid payments are missing an invoice.` and exit code 0 — the synthetic row is now excluded by the `LEFT JOIN ... IS NULL` filter, proving a second run is a safe no-op.

```bash
pnpm backfill:missing-invoices --apply
```
Expected: same message, same exit code 0 — `--apply` with nothing to do also doesn't error or loop.

- [ ] **Step 8: Verify the single-payment-ID form**

```bash
docker exec -i aivastra-postgres psql -U tryon -d tryon_dev -c "
INSERT INTO payments (user_id, plan_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, base_paise, gst_paise, total_paise, credits, status, paid_at)
SELECT id, 'starter', 'order_test_backfill_2', 'pay_test_backfill_2', 'test_sig', 250000, 45000, 295000, 2500, 'paid', now() - interval '10 days'
FROM users WHERE email = 'admin@aivastra.dev'
RETURNING id;
"
```
Note the returned UUID as `$PID`, then:
```bash
pnpm backfill:missing-invoices $PID --apply
```
Expected: `Found 1 paid payment(s) missing an invoice:` (only the row matching `$PID`, not any other gap), then `DONE: 1 ok, 0 failed (1 total)`, exit 0.

- [ ] **Step 9: Clean up the synthetic test rows**

```bash
docker exec -i aivastra-postgres psql -U tryon -d tryon_dev -c "DELETE FROM payments WHERE razorpay_order_id IN ('order_test_backfill_1', 'order_test_backfill_2');"
```
Expected: `DELETE 2` — the `invoices` rows cascade-delete automatically (`invoices.paymentId` has `onDelete: 'cascade'` in `packages/db/src/schema/credits.ts:196-198`). The two backfilled PDFs remain as harmless orphaned objects in local dev MinIO; no cleanup needed there (not production storage).

- [ ] **Step 10: Commit**

```bash
git add apps/api/scripts/backfill-missing-invoices.mts package.json
git commit -m "$(cat <<'EOF'
chore: add backfill-missing-invoices ops script

Finds every paid payment missing an invoice (LEFT JOIN, no date filter) and
issues one via the existing issueInvoiceIfNeeded. Dry-run by default, --apply
to write, no email sent. Closes the gap found in the 2026-09-21 support audit
for 8 pre-launch payments, and stays as a permanent safety-net tool.
EOF
)"
```

---

## Rollout (after this task is reviewed and merged — not part of this plan's implementation, tracked here for continuity with the spec)

1. PR `chore/backfill-missing-invoices` into `dev` per `docs/version-control.md`; promote `dev` → `main` the normal way.
2. Run `pnpm backfill:missing-invoices` (no flags) against the deployed container; confirm the printed list matches the 8 expected payment IDs from the audit (`caf14910…`, `5d98f0be…`, `91771adb…`, `33847856…`, `3bf52399…`, `d429c741…`, `80a41704…` / `creationid2013@gmail.com`, `1fc68653…`).
3. Run `pnpm backfill:missing-invoices --apply`.
4. Spot-check Settings → Invoices for `creationid2013@gmail.com` shows a download link for `order_TMRQUu9OTZ0I7j`.
5. Record the run in `docs/progress.md` (payment IDs touched, ok/failed counts) — same shape as the 2026-09-19 PR #384 entry.

## Self-Review Notes

- **Spec coverage:** dynamic LEFT JOIN selection (Step 1) ✓; dry-run default / `--apply` (Step 1, verified Steps 5-6) ✓; no email (Step 1 has none, confirmed by reading the script — no mailer import) ✓; permanent/idempotent (Step 1 query design, verified Step 7) ✓; single-payment-ID form (Step 1, verified Step 8) ✓; pnpm entry (Step 2) ✓; no new test file (Global Constraints, matches precedent) ✓; rollout steps mirrored from spec (Rollout section) ✓.
- **Placeholder scan:** none found — every step has literal code/commands and literal expected output.
- **Type consistency:** `issueInvoiceIfNeeded(app, paymentId)` signature matches `apps/api/src/modules/payments/issue-invoice.ts:41-44` exactly (`app: FastifyInstance`, `paymentId: string`, returns `Promise<{ invoiceNumber: string; pdfBuffer: Buffer } | null>`); `createR2Provider` config keys (`endpoint`, `accessKeyId`, `secretAccessKey`, `bucket`, `publicUrl`, `forcePathStyle`, `presignBaseUrl`, `signEndpoint`) match `packages/storage/src/r2.ts:12-24`'s `R2Config` interface and `apps/api/src/plugins/storage.ts`'s construction call.
