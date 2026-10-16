import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliverPendingForAccount, deliverRun } from '../../src/modules/messaging/delivery';
import { CHANNEL_WHATSAPP, connectAccount } from '../../src/modules/messaging/identity';
import { saveSession } from '../../src/modules/messaging/session-store';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';
import { fakeWhatsapp } from '../helpers/fake-whatsapp';

let seq = 0;
// Unique digits per account so parallel files never share a number.
const waId = () => `91981${String(Date.now()).slice(-6)}${String(++seq).padStart(3, '0')}`;

describe('whatsapp delivery', () => {
  let c: Containers;
  let app: TestApp;
  let appWithTemplate: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      MESSAGING_WHATSAPP_ENABLED: true,
      WEB_URL: 'http://localhost:3000',
    });
    appWithTemplate = await buildTestApp(c, {
      MESSAGING_WHATSAPP_ENABLED: true,
      WEB_URL: 'http://localhost:3000',
      WHATSAPP_RESULTS_TEMPLATE: 'catalog_images_ready',
    });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await appWithTemplate?.close();
    await c?.stop();
  });

  async function seedPose() {
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `WaDelPose${Date.now()}${++seq}`,
        r2Key: `wa-del-p${seq}.jpg`,
        thumbnailKey: `wa-del-p${seq}.jpg`,
      })
      .returning();
    return pose.id;
  }

  // One user, one connected account, two jobs (COMPLETED + FAILED unless told
  // otherwise), pose ids on both inputs, and a messaging_runs row over them.
  async function seedRun(opts?: { secondStatus?: string }) {
    const from = waId();
    const externalId = `+${from}`;
    const { userId } = await createVerifiedUserToken(
      app,
      `wa-del-${seq}-${Date.now()}@example.com`,
    );
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId,
      userId,
      linkedVia: 'chat_link',
    });
    const poseA = await seedPose();
    const poseB = await seedPose();
    const runId = randomUUID();
    const [jobA] = await app.db
      .insert(schema.jobs)
      .values({
        userId,
        catalogueId: runId,
        status: 'COMPLETED',
        creditsCharged: 1,
        source: 'tryon',
      })
      .returning();
    const [jobB] = await app.db
      .insert(schema.jobs)
      .values({
        userId,
        catalogueId: runId,
        status: opts?.secondStatus ?? 'FAILED',
        creditsCharged: 1,
        source: 'tryon',
      })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: jobA.id, poseId: poseA });
    await app.db.insert(schema.jobInputs).values({ jobId: jobB.id, poseId: poseB });
    const resultKey = keys.output(jobA.id);
    await app.storage.putObject(resultKey, Buffer.from('fake-png'), 'image/png');
    await app.db.insert(schema.jobOutputs).values({ jobId: jobA.id, resultKey });
    await app.db.insert(schema.messagingRuns).values({
      catalogueId: runId,
      messagingAccountId: account.id,
      userId,
      jobIds: [jobA.id, jobB.id],
    });
    // A freshly connected account has lastInboundAt null (only processInbound
    // touches it) — the window-open cases need it set; cases 3/4 override it.
    await app.db
      .update(schema.messagingAccounts)
      .set({ lastInboundAt: new Date() })
      .where(eq(schema.messagingAccounts.id, account.id));
    return { from, externalId, userId, account, runId, jobA, jobB };
  }

  // The closing runFinished event only answers when the session is GENERATING
  // with runId = the run (plan 2).
  async function seedGenerating(externalId: string, runId: string) {
    await saveSession(app.redis, CHANNEL_WHATSAPP, externalId, {
      v: 1,
      state: 'GENERATING',
      nonce: `n${++seq}`,
      page: 0,
      aspectRatio: '1:1',
      resolution: 'HD',
      photos: {},
      picked: [],
      runs: [{ runId, images: 2 }],
    });
  }

  const runRow = async (runId: string) =>
    (
      await app.db
        .select()
        .from(schema.messagingRuns)
        .where(eq(schema.messagingRuns.catalogueId, runId))
    )[0];

  const typeOf = (p: Record<string, unknown>) => (p as { type?: string }).type;

  it('window open: sends the finished image, then the runFinished closing', async () => {
    const s = await seedRun();
    await seedGenerating(s.externalId, s.runId);
    const wa = fakeWhatsapp();

    await deliverRun(app, wa.client, s.runId);

    expect(wa.uploads).toHaveLength(1);
    expect(wa.uploads[0]).toMatchObject({ mimeType: 'image/png' });
    expect(wa.sent.filter((m) => typeOf(m.payload) === 'image')).toHaveLength(1);
    expect(wa.texts().join('\n')).toMatch(/1 of 2 images failed/);
    const run = await runRow(s.runId);
    expect(new Set(run.deliveredJobIds)).toEqual(new Set([s.jobA.id, s.jobB.id]));
    expect(run.finishedAt).not.toBeNull();
  });

  it('twice is once: a second deliverRun sends nothing new', async () => {
    const s = await seedRun();
    await seedGenerating(s.externalId, s.runId);
    const wa = fakeWhatsapp();

    await deliverRun(app, wa.client, s.runId);
    const sent = wa.sent.length;
    const uploaded = wa.uploads.length;
    await deliverRun(app, wa.client, s.runId);

    expect(wa.sent).toHaveLength(sent);
    expect(wa.uploads).toHaveLength(uploaded);
  });

  it('window closed: one template, then the image after the window reopens', async () => {
    const s = await seedRun();
    await app.db
      .update(schema.messagingAccounts)
      .set({ lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(schema.messagingAccounts.id, s.account.id));
    const wa = fakeWhatsapp();

    await deliverPendingForAccount(appWithTemplate, wa.client, s.account.id);
    await deliverRun(appWithTemplate, wa.client, s.runId);

    expect(wa.sent.filter((m) => typeOf(m.payload) === 'template')).toHaveLength(1);
    expect(wa.sent.filter((m) => typeOf(m.payload) === 'image')).toHaveLength(0);
    expect(wa.uploads).toHaveLength(0);
    let run = await runRow(s.runId);
    expect(run.readyNoticeSentAt).not.toBeNull();
    expect(run.finishedAt).toBeNull();

    await seedGenerating(s.externalId, s.runId);
    await app.db
      .update(schema.messagingAccounts)
      .set({ lastInboundAt: new Date() })
      .where(eq(schema.messagingAccounts.id, s.account.id));
    await deliverPendingForAccount(appWithTemplate, wa.client, s.account.id);

    expect(wa.sent.filter((m) => typeOf(m.payload) === 'image')).toHaveLength(1);
    expect(wa.texts().join('\n')).toMatch(/1 of 2 images failed/);
    run = await runRow(s.runId);
    expect(run.finishedAt).not.toBeNull();
  });

  it('opted out: nothing is sent, both jobs are accounted for, the run closes', async () => {
    const s = await seedRun();
    await app.db
      .update(schema.messagingAccounts)
      .set({ optedOutAt: new Date() })
      .where(eq(schema.messagingAccounts.id, s.account.id));
    const wa = fakeWhatsapp();

    await deliverRun(app, wa.client, s.runId);

    expect(wa.sent).toHaveLength(0);
    expect(wa.uploads).toHaveLength(0);
    const run = await runRow(s.runId);
    expect(new Set(run.deliveredJobIds)).toEqual(new Set([s.jobA.id, s.jobB.id]));
    expect(run.finishedAt).not.toBeNull();
  });

  it('still running: only the finished job is delivered, the run stays open', async () => {
    const s = await seedRun({ secondStatus: 'PROCESSING' });
    const wa = fakeWhatsapp();

    await deliverRun(app, wa.client, s.runId);

    expect(wa.uploads).toHaveLength(1);
    expect(wa.sent.filter((m) => typeOf(m.payload) === 'image')).toHaveLength(1);
    const run = await runRow(s.runId);
    expect(run.deliveredJobIds).toEqual([s.jobA.id]);
    expect(run.finishedAt).toBeNull();
  });
});
