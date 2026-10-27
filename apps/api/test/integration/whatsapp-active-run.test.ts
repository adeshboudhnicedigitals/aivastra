import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHANNEL_WHATSAPP, connectAccount } from '../../src/modules/messaging/identity';
import { ACTIVE_RUN_MAX_MS, activeRun } from '../../src/modules/messaging/runs';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

let seq = 0;

// The generating lock reads this, so it is tested against a real database: the
// session cannot be trusted to remember a run.
describe('whatsapp activeRun', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { MESSAGING_WHATSAPP_ENABLED: true });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedAccount() {
    const n = ++seq;
    const { userId } = await createVerifiedUserToken(
      app,
      `wa-active-${n}-${Date.now()}@example.com`,
    );
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+9198200${String(Date.now()).slice(-5)}${n}`,
      userId,
      linkedVia: 'chat_link',
    });
    return { userId, accountId: account.id };
  }

  // One run over jobs in the given statuses, created `ageMs` ago.
  async function seedRun(s: { userId: string; accountId: string }, statuses: string[], ageMs = 0) {
    const runId = randomUUID();
    const jobs = await app.db
      .insert(schema.jobs)
      .values(
        statuses.map((status) => ({
          userId: s.userId,
          catalogueId: runId,
          status,
          creditsCharged: 1,
          source: 'tryon',
        })),
      )
      .returning();
    await app.db.insert(schema.messagingRuns).values({
      catalogueId: runId,
      messagingAccountId: s.accountId,
      userId: s.userId,
      jobIds: jobs.map((j) => j.id),
      createdAt: new Date(Date.now() - ageMs),
    });
    return runId;
  }

  it('is null when the chat has no runs', async () => {
    const s = await seedAccount();
    expect(await activeRun(app, s.accountId)).toBeNull();
  });

  it('counts a run with unfinished jobs, and only its own progress', async () => {
    const s = await seedAccount();
    await seedRun(s, ['COMPLETED', 'QUEUED', 'PROCESSING']);
    expect(await activeRun(app, s.accountId)).toEqual({ finished: 1, total: 3 });
  });

  it('is null once every job is COMPLETED, FAILED or CANCELLED', async () => {
    const s = await seedAccount();
    await seedRun(s, ['COMPLETED', 'FAILED', 'CANCELLED']);
    expect(await activeRun(app, s.accountId)).toBeNull();
  });

  it('adds up several unfinished runs and ignores a finished one', async () => {
    const s = await seedAccount();
    await seedRun(s, ['COMPLETED', 'COMPLETED']);
    await seedRun(s, ['COMPLETED', 'QUEUED']);
    await seedRun(s, ['QUEUED', 'QUEUED', 'QUEUED']);
    expect(await activeRun(app, s.accountId)).toEqual({ finished: 1, total: 5 });
  });

  it('lets go of a run older than the cutoff, so a stuck run cannot lock the chat', async () => {
    const s = await seedAccount();
    await seedRun(s, ['QUEUED'], ACTIVE_RUN_MAX_MS + 60_000);
    expect(await activeRun(app, s.accountId)).toBeNull();
    // ...and still holds just inside it.
    await seedRun(s, ['QUEUED'], ACTIVE_RUN_MAX_MS - 60_000);
    expect(await activeRun(app, s.accountId)).toEqual({ finished: 0, total: 1 });
  });

  it("never counts another chat's run", async () => {
    const mine = await seedAccount();
    const theirs = await seedAccount();
    await seedRun(theirs, ['QUEUED']);
    expect(await activeRun(app, mine.accountId)).toBeNull();
  });

  it('releases as soon as the last job finishes', async () => {
    const s = await seedAccount();
    const runId = await seedRun(s, ['QUEUED']);
    expect(await activeRun(app, s.accountId)).not.toBeNull();
    await app.db
      .update(schema.jobs)
      .set({ status: 'COMPLETED' })
      .where(eq(schema.jobs.catalogueId, runId));
    expect(await activeRun(app, s.accountId)).toBeNull();
  });
});
