import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('refund requests — customer API and gates', () => {
  let c: Containers;
  let app: TestApp;
  let seq = 0;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function registerUser(label: string) {
    seq += 1;
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `refund-${label}-${seq}@x.com`, emailVerified: true, tier: 'free' })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const token = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);
    return { token, userId: user.id, auth: { authorization: `Bearer ${token}` } };
  }

  async function seedJob(
    userId: string,
    o: {
      status?: string;
      creditsCharged?: number;
      downloadedAt?: Date | null;
      shopifyStoreId?: string;
      // The ledger row the charge wrote. Defaults to the debit atomicDeduct writes
      // for creditsCharged; null skips it (a free job writes nothing to refund).
      ledger?: { delta: number; reason: string } | null;
    } = {},
  ) {
    const creditsCharged = o.creditsCharged ?? 10;
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        userId,
        status: o.status ?? 'COMPLETED',
        creditsCharged,
        shopifyStoreId: o.shopifyStoreId,
      })
      .returning();
    const ledger =
      o.ledger === undefined
        ? creditsCharged > 0
          ? { delta: -creditsCharged, reason: 'JOB_DISPATCH' }
          : null
        : o.ledger;
    if (ledger) {
      await app.db.insert(schema.creditLedger).values({ userId, jobId: job.id, ...ledger });
    }
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: 'x' });
    await app.db.insert(schema.jobOutputs).values({
      jobId: job.id,
      resultKey: `outputs/${job.id}.png`,
      downloadedAt: o.downloadedAt ?? null,
    });
    return job.id as string;
  }

  // The harness keeps rate limiting on and the route allows 10/min per IP, so each
  // caller gets its own RFC 5737 test IP.
  const ipByAuth = new Map<string, string>();
  const ipFor = (auth: Record<string, string>) => {
    const key = auth.authorization;
    if (!ipByAuth.has(key)) ipByAuth.set(key, `198.51.100.${ipByAuth.size + 1}`);
    return ipByAuth.get(key) as string;
  };

  const post = (jobId: string, auth: Record<string, string>, payload: unknown) =>
    app.inject({
      method: 'POST',
      remoteAddress: ipFor(auth),
      url: `/v1/jobs/${jobId}/refund-request`,
      headers: auth,
      payload: payload as object,
    });

  describe('POST /v1/jobs/:id/refund-request', () => {
    it('requires authentication', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/jobs/${randomUUID()}/refund-request`,
        payload: { reasonCode: 'OTHER' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('creates a PENDING request that snapshots the job credits', async () => {
      const u = await registerUser('ok');
      const jobId = await seedJob(u.userId, { creditsCharged: 7 });
      const res = await post(jobId, u.auth, { reasonCode: 'FACE_MISMATCH', note: ' wrong face ' });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({
        jobId,
        status: 'PENDING',
        credits: 7,
        reasonCode: 'FACE_MISMATCH',
        note: 'wrong face',
      });
      const [row] = await app.db
        .select()
        .from(schema.refundRequests)
        .where(eq(schema.refundRequests.jobId, jobId));
      expect(row.userId).toBe(u.userId);
    });

    it("404s for another user's job and for a missing job", async () => {
      const owner = await registerUser('owner');
      const thief = await registerUser('thief');
      const jobId = await seedJob(owner.userId);
      expect((await post(jobId, thief.auth, { reasonCode: 'OTHER' })).statusCode).toBe(404);
      expect((await post(randomUUID(), thief.auth, { reasonCode: 'OTHER' })).statusCode).toBe(404);
    });

    it('409s when the job is not COMPLETED', async () => {
      const u = await registerUser('notdone');
      const jobId = await seedJob(u.userId, { status: 'RUNNING' });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('NOT_READY');
    });

    it('409s for a free job (creditsCharged 0)', async () => {
      const u = await registerUser('free');
      const jobId = await seedJob(u.userId, { creditsCharged: 0 });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('NOT_REFUNDABLE');
    });

    it('409s for an unlimited-plan job: creditsCharged is set but the ledger debited 0', async () => {
      const u = await registerUser('unlimited');
      const jobId = await seedJob(u.userId, {
        creditsCharged: 10,
        ledger: { delta: 0, reason: 'UNLIMITED_PLAN_USAGE' },
      });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('NOT_REFUNDABLE');

      const status = await app.inject({
        method: 'GET',
        url: `/v1/jobs/refund-status?jobIds=${jobId}`,
        headers: u.auth,
      });
      expect(status.json().items).toEqual([{ jobId, eligible: false, request: null }]);
    });

    it('snapshots the ledger debit, not creditsCharged, when they differ', async () => {
      const u = await registerUser('ledger-amount');
      const jobId = await seedJob(u.userId, {
        creditsCharged: 10,
        ledger: { delta: -7, reason: 'JOB_DISPATCH' },
      });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(201);
      expect(res.json().credits).toBe(7);
    });

    it('409s for a Shopify store job', async () => {
      const u = await registerUser('shopify');
      const [store] = await app.db
        .insert(schema.shopifyStores)
        .values({
          shopDomain: `refund-${seq}.myshopify.com`,
          shopifyShopId: 910000000 + seq,
          accessToken: 'enc:token',
          scope: 'read_products',
        })
        .returning();
      const jobId = await seedJob(u.userId, { shopifyStoreId: store.id });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('NOT_REFUNDABLE');
    });

    it('409s when the result was already downloaded', async () => {
      const u = await registerUser('dl');
      const jobId = await seedJob(u.userId, { downloadedAt: new Date() });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ALREADY_DOWNLOADED');
    });

    it('409s on a second request for the same job, even after rejection', async () => {
      const u = await registerUser('dup');
      const jobId = await seedJob(u.userId);
      expect((await post(jobId, u.auth, { reasonCode: 'OTHER' })).statusCode).toBe(201);
      await app.db
        .update(schema.refundRequests)
        .set({ status: 'REJECTED' })
        .where(eq(schema.refundRequests.jobId, jobId));
      const again = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe('REFUND_ALREADY_REQUESTED');
    });

    it('400s on an unknown reason code or an over-long note', async () => {
      const u = await registerUser('bad');
      const jobId = await seedJob(u.userId);
      expect((await post(jobId, u.auth, { reasonCode: 'NOPE' })).statusCode).toBe(400);
      expect(
        (await post(jobId, u.auth, { reasonCode: 'OTHER', note: 'x'.repeat(301) })).statusCode,
      ).toBe(400);
    });
  });

  describe('GET /v1/jobs/refund-status', () => {
    it('reports eligibility and request state, omitting jobs the caller does not own', async () => {
      const u = await registerUser('status');
      const other = await registerUser('status-other');
      const fresh = await seedJob(u.userId);
      const requested = await seedJob(u.userId);
      const downloaded = await seedJob(u.userId, { downloadedAt: new Date() });
      const foreign = await seedJob(other.userId);
      await post(requested, u.auth, { reasonCode: 'POOR_QUALITY' });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/refund-status?jobIds=${[fresh, requested, downloaded, foreign].join(',')}`,
        headers: u.auth,
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items as {
        jobId: string;
        eligible: boolean;
        request: { status: string } | null;
      }[];
      const byId = new Map(items.map((i) => [i.jobId, i]));
      expect(byId.get(fresh)).toMatchObject({ eligible: true, request: null });
      expect(byId.get(requested)).toMatchObject({
        eligible: false,
        request: { status: 'PENDING' },
      });
      expect(byId.get(downloaded)).toMatchObject({ eligible: false, request: null });
      expect(byId.has(foreign)).toBe(false);
    });

    it('400s on a malformed or oversized id list', async () => {
      const u = await registerUser('status-bad');
      const bad = await app.inject({
        method: 'GET',
        url: '/v1/jobs/refund-status?jobIds=not-a-uuid',
        headers: u.auth,
      });
      expect(bad.statusCode).toBe(400);
      const many = Array.from({ length: 51 }, () => randomUUID()).join(',');
      const tooMany = await app.inject({
        method: 'GET',
        url: `/v1/jobs/refund-status?jobIds=${many}`,
        headers: u.auth,
      });
      expect(tooMany.statusCode).toBe(400);
    });
  });

  describe('gates while a request is open', () => {
    async function pendingJob() {
      const u = await registerUser('gate');
      const jobId = await seedJob(u.userId);
      await post(jobId, u.auth, { reasonCode: 'OTHER' });
      return { u, jobId };
    }

    it('blocks regenerate while PENDING and APPROVED, allows it after REJECTED', async () => {
      const { u, jobId } = await pendingJob();
      const regen = () =>
        app.inject({
          method: 'POST',
          url: `/v1/jobs/${jobId}/regenerate`,
          headers: u.auth,
          payload: { reason: 'try again' },
        });

      const pending = await regen();
      expect(pending.statusCode).toBe(409);
      expect(pending.json().error.code).toBe('REFUND_REQUESTED');

      await app.db
        .update(schema.refundRequests)
        .set({ status: 'APPROVED' })
        .where(eq(schema.refundRequests.jobId, jobId));
      expect((await regen()).json().error.code).toBe('REFUND_REQUESTED');

      await app.db
        .update(schema.refundRequests)
        .set({ status: 'REJECTED' })
        .where(eq(schema.refundRequests.jobId, jobId));
      // REJECTED releases the job. Migration 0184 seeds an active regeneration workflow
      // into every fresh database, so the regeneration goes all the way through.
      const after = await regen();
      expect(after.statusCode).toBe(201);
      const children = await app.db
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.parentJobId, jobId));
      expect(children).toHaveLength(1);
    });

    it('blocks the download while PENDING and APPROVED without stamping downloadedAt, and allows it after REJECTED', async () => {
      const { u, jobId } = await pendingJob();
      const download = () =>
        app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/download`, headers: u.auth });
      const blockedDownloadedAt = async () => {
        const [o] = await app.db
          .select({ downloadedAt: schema.jobOutputs.downloadedAt })
          .from(schema.jobOutputs)
          .where(eq(schema.jobOutputs.jobId, jobId));
        return o.downloadedAt;
      };

      const blocked = await download();
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe('REFUND_REQUESTED');
      expect(await blockedDownloadedAt()).toBeNull();

      // Approved credits went back, so the image stays locked for good.
      await app.db
        .update(schema.refundRequests)
        .set({ status: 'APPROVED' })
        .where(eq(schema.refundRequests.jobId, jobId));
      const approved = await download();
      expect(approved.statusCode).toBe(409);
      expect(approved.json().error.code).toBe('REFUND_REQUESTED');
      expect(await blockedDownloadedAt()).toBeNull();

      await app.db
        .update(schema.refundRequests)
        .set({ status: 'REJECTED' })
        .where(eq(schema.refundRequests.jobId, jobId));
      expect((await download()).statusCode).toBe(200);
      expect(await blockedDownloadedAt()).not.toBeNull();
    });

    it('keeps GET /result open so a pending image can still be viewed', async () => {
      const { u, jobId } = await pendingJob();
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}/result`,
        headers: u.auth,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
