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
