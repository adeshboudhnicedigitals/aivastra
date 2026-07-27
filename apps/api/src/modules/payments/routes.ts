import { createHmac, timingSafeEqual } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendPaymentReceiptEmail } from '../../lib/mailer.js';

const GST_RATE = 0.18;

async function createRazorpayOrder(
  keyId: string,
  keySecret: string,
  amountPaise: number,
  receipt: string,
): Promise<{ id: string }> {
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Razorpay order creation failed: ${body}`);
  }
  return res.json() as Promise<{ id: string }>;
}

// Shared helper — send receipt email non-fatally after a successful credit grant
async function maybeSendReceipt(
  app: FastifyInstance,
  userId: string,
  payment: {
    planId: string;
    credits: number;
    basePaise: number;
    gstPaise: number;
    totalPaise: number;
    razorpayOrderId: string;
    razorpayPaymentId: string | null;
    paidAt: Date | null;
  },
): Promise<void> {
  try {
    const [user] = await app.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) return;
    if (!user.email) return;

    const [plan] = await app.db
      .select({ name: schema.creditPlans.name })
      .from(schema.creditPlans)
      .where(eq(schema.creditPlans.slug, payment.planId));

    await sendPaymentReceiptEmail(app.env.RESEND_API_KEY, app.env.EMAIL_FROM, user.email, {
      planName: plan?.name ?? payment.planId,
      credits: payment.credits,
      basePaise: payment.basePaise,
      gstPaise: payment.gstPaise,
      totalPaise: payment.totalPaise,
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: payment.razorpayPaymentId ?? '',
      paidAt: payment.paidAt ?? new Date(),
    });
  } catch (err) {
    app.log.warn({ err, userId }, 'receipt email failed — non-fatal');
  }
}

export async function paymentsRoutes(app: FastifyInstance) {
  // GET /v1/payments/plans — public, no auth required
  app.get('/v1/payments/plans', async () => {
    return app.db
      .select()
      .from(schema.creditPlans)
      .where(and(eq(schema.creditPlans.isActive, true), ne(schema.creditPlans.slug, 'free')))
      .orderBy(asc(schema.creditPlans.sortOrder));
  });

  // GET /v1/payments/history — user's own paid payment records
  app.get('/v1/payments/history', { preHandler: app.requireUser }, async (req) => {
    const rows = await app.db
      .select({
        id: schema.payments.id,
        planId: schema.payments.planId,
        planName: schema.creditPlans.name,
        credits: schema.payments.credits,
        basePaise: schema.payments.basePaise,
        gstPaise: schema.payments.gstPaise,
        totalPaise: schema.payments.totalPaise,
        razorpayOrderId: schema.payments.razorpayOrderId,
        razorpayPaymentId: schema.payments.razorpayPaymentId,
        status: schema.payments.status,
        createdAt: schema.payments.createdAt,
        paidAt: schema.payments.paidAt,
      })
      .from(schema.payments)
      .leftJoin(schema.creditPlans, eq(schema.creditPlans.slug, schema.payments.planId))
      .where(eq(schema.payments.userId, req.userId))
      .orderBy(desc(schema.payments.createdAt))
      .limit(100);
    return { payments: rows };
  });

  // POST /v1/payments/orders — create a Razorpay order server-side
  app.post(
    '/v1/payments/orders',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({ planId: z.string().min(1) }),
      },
    },
    async (req) => {
      const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = app.env;
      if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        throw new AppError('NOT_CONFIGURED', 503, 'payments not configured');
      }

      const { planId } = req.body as { planId: string };
      const [plan] = await app.db
        .select()
        .from(schema.creditPlans)
        .where(and(eq(schema.creditPlans.slug, planId), eq(schema.creditPlans.isActive, true)));
      if (!plan) throw new AppError('NOT_FOUND', 404, 'plan not found or inactive');

      const gstPaise = Math.round(plan.basePaise * GST_RATE);
      const totalPaise = plan.basePaise + gstPaise;

      const rzpOrder = await createRazorpayOrder(
        RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET,
        totalPaise,
        `aivastra_${req.userId.slice(0, 8)}`,
      );

      await app.db.insert(schema.payments).values({
        userId: req.userId,
        planId: plan.slug,
        razorpayOrderId: rzpOrder.id,
        basePaise: plan.basePaise,
        gstPaise,
        totalPaise,
        credits: plan.credits,
        status: 'created',
      });

      return {
        orderId: rzpOrder.id,
        amount: totalPaise,
        currency: 'INR',
        keyId: RAZORPAY_KEY_ID,
        credits: plan.credits,
        label: plan.name,
      };
    },
  );

  // POST /v1/payments/verify — verify Razorpay signature + credit user
  app.post(
    '/v1/payments/verify',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          razorpayOrderId: z.string().min(1),
          razorpayPaymentId: z.string().min(1),
          razorpaySignature: z.string().min(1),
        }),
      },
    },
    async (req) => {
      const { RAZORPAY_KEY_SECRET } = app.env;
      if (!RAZORPAY_KEY_SECRET) {
        throw new AppError('NOT_CONFIGURED', 503, 'payments not configured');
      }

      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
        razorpayOrderId: string;
        razorpayPaymentId: string;
        razorpaySignature: string;
      };

      // Verify HMAC-SHA256 signature (constant-time to avoid a timing oracle)
      const expected = createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      const expectedBuf = Buffer.from(expected);
      const signatureBuf = Buffer.from(razorpaySignature);
      const signatureValid =
        expectedBuf.length === signatureBuf.length && timingSafeEqual(expectedBuf, signatureBuf);
      if (!signatureValid) {
        throw new AppError('INVALID_SIGNATURE', 400, 'payment signature invalid');
      }

      // Load the pending payment row — must belong to this user
      const [payment] = await app.db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.razorpayOrderId, razorpayOrderId));

      if (!payment) throw new AppError('NOT_FOUND', 404, 'order not found');
      if (payment.userId !== req.userId) throw new AppError('FORBIDDEN', 403, 'forbidden');
      if (payment.status === 'paid') return { ok: true, alreadyCredited: true };

      // Mark paid + credit user + promote tier atomically.
      // The UPDATE filters on status='created' so only one concurrent caller wins;
      // if updated.length === 0, another call already claimed it.
      let credited = false;
      await app.db.transaction(async (tx) => {
        const updated = await tx
          .update(schema.payments)
          .set({
            status: 'paid',
            razorpayPaymentId,
            razorpaySignature,
            paidAt: new Date(),
          })
          .where(
            and(
              eq(schema.payments.razorpayOrderId, razorpayOrderId),
              eq(schema.payments.status, 'created'),
            ),
          )
          .returning({ id: schema.payments.id });

        if (updated.length === 0) return; // concurrent call already credited — skip

        credited = true;

        await tx
          .insert(schema.userCredits)
          .values({ userId: req.userId, balance: payment.credits })
          .onConflictDoUpdate({
            target: schema.userCredits.userId,
            set: {
              balance: sql`${schema.userCredits.balance} + ${payment.credits}`,
              updatedAt: new Date(),
            },
          });

        await tx.insert(schema.creditLedger).values({
          userId: req.userId,
          delta: payment.credits,
          reason: 'PAYMENT',
          adminId: null,
        });

        // Promote the user's tier to this plan's slug so job queue priority kicks in.
        await tx
          .update(schema.users)
          .set({ tier: payment.planId, updatedAt: new Date() })
          .where(eq(schema.users.id, req.userId));
      });

      if (!credited) return { ok: true, alreadyCredited: true };

      const [bal] = await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, req.userId));

      void maybeSendReceipt(app, req.userId, {
        ...payment,
        razorpayPaymentId,
        paidAt: new Date(),
      });

      return { ok: true, alreadyCredited: false, balance: bal?.balance ?? payment.credits };
    },
  );

  // POST /v1/payments/webhook — Razorpay server-to-server event delivery
  // Must receive the raw request body for HMAC-SHA256 signature verification.
  // Registered in a scoped sub-plugin so the buffer content-type parser doesn't
  // affect any other route.
  await app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });

    sub.post('/v1/payments/webhook', async (req, reply) => {
      const { RAZORPAY_WEBHOOK_SECRET } = app.env;
      if (!RAZORPAY_WEBHOOK_SECRET) {
        // Webhook secret not configured — acknowledge to avoid Razorpay retries,
        // but log a warning so ops can detect the misconfiguration.
        app.log.warn('RAZORPAY_WEBHOOK_SECRET not set — webhook received but not verified');
        reply.code(200).send({ ok: true });
        return;
      }

      const rawBody = req.body as Buffer;
      const signature = (req.headers['x-razorpay-signature'] as string) ?? '';

      // Verify HMAC-SHA256 over the raw body bytes
      const expected = createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

      const expectedBuf = Buffer.from(expected, 'hex');
      const signatureBuf = Buffer.from(signature, 'hex');
      const valid =
        expectedBuf.length === signatureBuf.length && timingSafeEqual(expectedBuf, signatureBuf);

      if (!valid) {
        app.log.warn({ signature }, 'razorpay webhook signature mismatch');
        // Return 200 so Razorpay doesn't keep retrying — this is a bad actor request,
        // not a transient failure.
        reply.code(200).send({ ok: false, reason: 'invalid signature' });
        return;
      }

      let event: {
        event: string;
        payload: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } };
      };
      try {
        event = JSON.parse(rawBody.toString('utf-8'));
      } catch {
        app.log.warn('razorpay webhook: failed to parse body as JSON');
        reply.code(200).send({ ok: false, reason: 'invalid json' });
        return;
      }

      const eventType = event.event;
      const paymentEntity = event.payload?.payment?.entity;
      const razorpayPaymentId = paymentEntity?.id;
      const razorpayOrderId = paymentEntity?.order_id;

      app.log.info({ eventType, razorpayOrderId, razorpayPaymentId }, 'razorpay webhook received');

      if (eventType === 'payment.captured' && razorpayOrderId && razorpayPaymentId) {
        const [payment] = await app.db
          .select()
          .from(schema.payments)
          .where(eq(schema.payments.razorpayOrderId, razorpayOrderId));

        if (!payment) {
          app.log.error({ razorpayOrderId }, 'razorpay webhook: order not found in DB');
          reply.code(200).send({ ok: true }); // ack regardless to prevent retries
          return;
        }

        if (payment.status === 'paid') {
          app.log.info({ razorpayOrderId }, 'razorpay webhook: already credited — skipping');
          reply.code(200).send({ ok: true });
          return;
        }

        // Idempotent credit grant — conditional UPDATE races safely with /verify.
        let webhookCredited = false;
        await app.db.transaction(async (tx) => {
          const updated = await tx
            .update(schema.payments)
            .set({
              status: 'paid',
              razorpayPaymentId,
              paidAt: new Date(),
            })
            .where(
              and(
                eq(schema.payments.razorpayOrderId, razorpayOrderId),
                eq(schema.payments.status, 'created'),
              ),
            )
            .returning({ id: schema.payments.id });

          if (updated.length === 0) return; // /verify already credited — skip

          webhookCredited = true;

          await tx
            .insert(schema.userCredits)
            .values({ userId: payment.userId, balance: payment.credits })
            .onConflictDoUpdate({
              target: schema.userCredits.userId,
              set: {
                balance: sql`${schema.userCredits.balance} + ${payment.credits}`,
                updatedAt: new Date(),
              },
            });

          await tx.insert(schema.creditLedger).values({
            userId: payment.userId,
            delta: payment.credits,
            reason: 'PAYMENT',
            adminId: null,
          });

          await tx
            .update(schema.users)
            .set({ tier: payment.planId, updatedAt: new Date() })
            .where(eq(schema.users.id, payment.userId));
        });

        if (webhookCredited) {
          app.log.info(
            {
              razorpayOrderId,
              razorpayPaymentId,
              credits: payment.credits,
              userId: payment.userId,
            },
            'razorpay webhook: credits granted',
          );
          void maybeSendReceipt(app, payment.userId, {
            ...payment,
            razorpayPaymentId,
            paidAt: new Date(),
          });
        } else {
          app.log.info(
            { razorpayOrderId },
            'razorpay webhook: already credited by /verify — skipping',
          );
        }
      } else if (eventType === 'payment.failed' && razorpayOrderId) {
        await app.db
          .update(schema.payments)
          .set({ status: 'failed' })
          .where(
            and(
              eq(schema.payments.razorpayOrderId, razorpayOrderId),
              eq(schema.payments.status, 'created'),
            ),
          );
        app.log.info({ razorpayOrderId }, 'razorpay webhook: payment marked failed');
      }

      reply.code(200).send({ ok: true });
    });
  });
}
