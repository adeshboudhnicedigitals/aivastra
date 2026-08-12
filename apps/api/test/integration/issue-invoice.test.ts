import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueInvoiceIfNeeded } from '../../src/modules/payments/issue-invoice.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('issueInvoiceIfNeeded', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedPaidPayment(email: string) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, passwordHash: 'x', tier: 'free', emailVerified: true })
      .returning();
    const [payment] = await app.db
      .insert(schema.payments)
      .values({
        userId: user.id,
        planId: 'growth',
        razorpayOrderId: `order_${email}`,
        razorpayPaymentId: `pay_${email}`,
        basePaise: 100000,
        gstPaise: 18000,
        totalPaise: 118000,
        credits: 5000,
        gstin: '27AAPFU0939F1ZV',
        status: 'paid',
        paidAt: new Date(),
      })
      .returning();
    return payment;
  }

  it('issues a sequential invoice number and uploads a PDF to R2', async () => {
    const payment = await seedPaidPayment('issue-invoice-1@x.com');

    const result = await issueInvoiceIfNeeded(app, payment.id);
    expect(result).not.toBeNull();
    expect(result?.invoiceNumber).toMatch(/^INV-\d{4}-\d{2}-\d{6}$/);
    expect(result?.pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const [row] = await app.db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.paymentId, payment.id));
    expect(row).toBeDefined();
    expect(row.invoiceNumber).toBe(result?.invoiceNumber);

    const stored = await app.storage.getObject(row.r2Key);
    expect(stored.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('allocates sequential numbers across two different payments', async () => {
    const p1 = await seedPaidPayment('issue-invoice-seq-1@x.com');
    const p2 = await seedPaidPayment('issue-invoice-seq-2@x.com');

    const r1 = await issueInvoiceIfNeeded(app, p1.id);
    const r2 = await issueInvoiceIfNeeded(app, p2.id);

    const n1 = Number(r1?.invoiceNumber.split('-').pop());
    const n2 = Number(r2?.invoiceNumber.split('-').pop());
    expect(n2).toBe(n1 + 1);
  });

  it('is idempotent — calling twice for the same payment yields exactly one invoices row', async () => {
    const payment = await seedPaidPayment('issue-invoice-idempotent@x.com');

    const first = await issueInvoiceIfNeeded(app, payment.id);
    const second = await issueInvoiceIfNeeded(app, payment.id);

    expect(second?.invoiceNumber).toBe(first?.invoiceNumber);

    const rows = await app.db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.paymentId, payment.id));
    expect(rows).toHaveLength(1);
  });

  it('returns null (never throws) for a payment that is not paid', async () => {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: 'issue-invoice-unpaid@x.com', passwordHash: 'x', tier: 'free' })
      .returning();
    const [payment] = await app.db
      .insert(schema.payments)
      .values({
        userId: user.id,
        planId: 'growth',
        razorpayOrderId: 'order_unpaid',
        basePaise: 100000,
        gstPaise: 18000,
        totalPaise: 118000,
        credits: 5000,
        status: 'created',
      })
      .returning();

    const result = await issueInvoiceIfNeeded(app, payment.id);
    expect(result).toBeNull();
  });
});
