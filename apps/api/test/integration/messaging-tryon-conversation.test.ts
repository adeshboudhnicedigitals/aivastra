import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runConversation } from '../../src/modules/messaging/conversation';
import { decodeReplyId } from '../../src/modules/messaging/engine/reply-id';
import type { InboundEvent, OutboundMessage } from '../../src/modules/messaging/engine/types';
import { CHANNEL_WHATSAPP, connectAccount } from '../../src/modules/messaging/identity';
import { storeGarmentPhoto } from '../../src/modules/messaging/photos';
import { loadSession } from '../../src/modules/messaging/session-store';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

function tapIn(msgs: OutboundMessage[], action: string, value?: string): InboundEvent {
  for (const m of msgs) {
    const ids =
      m.kind === 'buttons'
        ? m.buttons.map((b) => b.id)
        : m.kind === 'list'
          ? m.rows.map((r) => r.id)
          : [];
    for (const id of ids) {
      const d = decodeReplyId(id);
      if (d?.action === action && (value === undefined || d.value === value))
        return { type: 'reply', id };
    }
  }
  throw new Error(`${action} not offered: ${JSON.stringify(msgs)}`);
}

describe('whatsapp try-on flow (real deps, WHATSAPP_BOT_FLOW=tryon)', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: TestApp['storage']['headObject'];

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      MESSAGING_WHATSAPP_ENABLED: true,
      WEB_URL: 'http://localhost:3000',
      WHATSAPP_BOT_FLOW: 'tryon',
    });
    realHeadObject = app.storage.headObject.bind(app.storage);
    const sfx = `${Date.now()}`;
    await app.db
      .insert(schema.creditPlans)
      .values({ slug: 'free', name: 'free', credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `tc-wf-${sfx}`,
        label: 'Tryon',
        jsonContent: {},
        workflowType: 'tryon',
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
      })
      .returning();
    const mk = (i: number, shotType: 'full' | 'half') => ({
      label: `TcPose${sfx}-${i}`,
      genderSlug: 'men',
      shotType,
      r2Key: `tc-${sfx}-${i}.jpg`,
      thumbnailKey: `tc-${sfx}-${i}.thumb.jpg`,
      workflowTemplateId: wf.id,
      whatsappPool: true,
    });
    await app.db
      .insert(schema.modelPoseAssets)
      .values([mk(1, 'full'), mk(2, 'full'), mk(3, 'full'), mk(4, 'half'), mk(5, 'half')]);
    // createTryonRun refuses to charge without a healthy try-on worker, so the
    // end-to-end flow needs the dispatcher's registry entry present.
    const workerId = 'tryon-conversation-worker';
    await app.redis.hset(
      'worker:registry',
      workerId,
      JSON.stringify({
        url: 'http://worker.test',
        apiKey: 'test-key',
        status: 'IDLE',
        lastSeen: Date.now(),
        allowedJobTypes: [],
      }),
    );
    await app.redis.setex(`worker:health:${workerId}`, 300, '1');
  }, 60000);
  beforeEach(() => {
    // Both tests start in try-on; the reverse-guard test flips it for one send.
    app.env.WHATSAPP_BOT_FLOW = 'tryon';
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    app.storage.headObject = realHeadObject;
  });
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('photo → Men → 3 poses creates 3 charged jobs under one recorded run', async () => {
    const { userId } = await createVerifiedUserToken(app, `tc-${Date.now()}@example.com`);
    await app.db.insert(schema.userCredits).values({ userId, balance: 100 });
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+91${Date.now().toString().slice(-10)}`,
      userId,
      linkedVia: 'web_code',
    });
    const acct = {
      id: account.id,
      userId,
      channel: account.channel,
      externalId: account.externalId,
    };
    let n = 0;
    const send = (e: InboundEvent) => runConversation(app, acct, e, `wamid.tc.${++n}`);

    const key = await storeGarmentPhoto(app, userId, Buffer.from('fake-jpeg'), 'image/jpeg');
    let msgs = await send({ type: 'image', garmentKey: key });
    msgs = await send(tapIn(msgs, 'gender', 'men'));
    msgs = await send(tapIn(msgs, 'count', '3'));

    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    expect(session?.state).toBe('GENERATING');
    const runId = session?.runs?.[0]?.runId as string;
    const [run] = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.catalogueId, runId));
    expect(run.jobIds).toHaveLength(3);

    const poses = await app.db
      .select({ params: schema.jobInputs.params })
      .from(schema.jobInputs)
      .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobInputs.jobId))
      .where(eq(schema.jobs.catalogueId, runId));
    expect(poses).toHaveLength(3);
    const [credits] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(credits.balance).toBe(85);
  });

  it('switching the flag back to catalogue starts a clean catalogue session', async () => {
    const { userId } = await createVerifiedUserToken(app, `tc-rev-${Date.now()}@example.com`);
    await app.db.insert(schema.userCredits).values({ userId, balance: 100 });
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+91${Date.now().toString().slice(-10)}`,
      userId,
      linkedVia: 'web_code',
    });
    const acct = {
      id: account.id,
      userId,
      channel: account.channel,
      externalId: account.externalId,
    };
    let n = 0;
    const send = (e: InboundEvent) => runConversation(app, acct, e, `wamid.tc.rev.${++n}`);

    const key = await storeGarmentPhoto(app, userId, Buffer.from('fake-jpeg'), 'image/jpeg');
    let msgs = await send({ type: 'image', garmentKey: key });
    msgs = await send(tapIn(msgs, 'gender', 'men'));
    await send(tapIn(msgs, 'count', '3'));
    const before = await app.db
      .select({ catalogueId: schema.messagingRuns.catalogueId })
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.messagingAccountId, account.id));
    expect(before).toHaveLength(1);

    // The try-on session is mid-GENERATING; the catalogue reducer must not drive it.
    // A non-exit word: the catalogue engine is idle at GENERATING for it, so without
    // the flow guard the session would stay GENERATING with flow:'tryon'.
    app.env.WHATSAPP_BOT_FLOW = 'catalogue';
    await send({ type: 'text', text: 'ok' });

    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    expect(session?.state).toBe('MAIN_MENU');
    expect(session?.flow).toBeUndefined();
    const after = await app.db
      .select({ catalogueId: schema.messagingRuns.catalogueId })
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.messagingAccountId, account.id));
    expect(after).toHaveLength(1);
  });
});
