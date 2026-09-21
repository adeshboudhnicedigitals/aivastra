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
 * BACKDATED-INVOICE WARNING: issueInvoiceIfNeeded stamps the invoice's
 * "Invoice Date" as the payment's original paidAt, but allocates the NEXT
 * sequential invoice number as of when this script actually runs — so a
 * backfilled invoice can carry a serial number issued after (and higher
 * than) invoices already dated later in the same financial year, and can be
 * dated into a GST filing period (GSTR-1) that's already been filed. This is
 * a deliberate, out-of-scope consequence of reusing issueInvoiceIfNeeded
 * unchanged (see docs/superpowers/specs/2026-09-21-backfill-missing-invoices-design.md).
 * GET SIGN-OFF FROM WHOEVER OWNS GST FILING BEFORE RUNNING --apply AGAINST
 * PRODUCTION.
 *
 * Concurrency: --apply acquires a Postgres advisory lock
 * ('backfill-missing-invoices') for the whole write pass via
 * @aivastra/db's withAdvisoryLock, so a second concurrent --apply run backs
 * off immediately (prints a message, exits 1, writes nothing) instead of
 * racing the first — two concurrent runs could otherwise allocate two
 * different invoice numbers for the same gap and leave the DB's
 * invoice_number disagreeing with whichever PDF actually landed in R2 last.
 *
 * Safe to re-run (sequentially, or exclusively via the lock above): the
 * selection query (LEFT JOIN invoices ... WHERE invoices.id IS NULL)
 * excludes rows once they're invoiced, and issueInvoiceIfNeeded is
 * independently idempotent (checks for an existing invoices row first).
 * Kept in the repo permanently, not deleted after use — same convention as
 * check-billing-api-enabled.mts.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (paymentIdArg && !UUID_RE.test(paymentIdArg)) {
  console.error(
    `"${paymentIdArg}" does not look like a payment UUID — expected payments.id, not e.g. a Razorpay order id.`,
  );
  process.exit(1);
}

const { db, close, withAdvisoryLock } = createDb(requireEnv('DATABASE_URL'));

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
  let lockAcquired = true;
  console.log('');
  try {
    const outcome = await withAdvisoryLock('backfill-missing-invoices', async () => {
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
      // withAdvisoryLock returns T | undefined, and undefined also means "lock
      // not acquired" — the callback must return something other than
      // undefined so a successful, lock-held run is distinguishable below
      // from a run that never got the lock at all.
      return true;
    });
    if (outcome === undefined) {
      lockAcquired = false;
      console.error(
        '\nAnother instance of backfill-missing-invoices appears to be running (could not acquire the advisory lock) — aborting without writing anything.',
      );
      process.exitCode = 1;
    }
  } finally {
    redis.disconnect();
  }

  if (lockAcquired) {
    console.log(`\nDONE: ${ok} ok, ${failed} failed (${rows.length} total)`);
    if (failed > 0) process.exitCode = 1;
  }
} finally {
  await close();
}
