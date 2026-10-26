import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runConversation } from '../../src/modules/messaging/conversation';
import { createEngineDeps } from '../../src/modules/messaging/deps';
import { COPY } from '../../src/modules/messaging/engine/copy';
import { decodeReplyId } from '../../src/modules/messaging/engine/reply-id';
import type { InboundEvent, OutboundMessage } from '../../src/modules/messaging/engine/types';
import { CHANNEL_WHATSAPP, connectAccount } from '../../src/modules/messaging/identity';
import { notifyConnected, notifyCreditsAdded } from '../../src/modules/messaging/notify';
import { storeGarmentPhoto } from '../../src/modules/messaging/photos';
import { INBOUND_STREAM } from '../../src/modules/messaging/webhook.routes';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';
import { fakeWhatsapp } from '../helpers/fake-whatsapp';

// processInbound is stubbed for the consumer ordering test only: it records
// calls with timestamps, and sender A's first message waits 1 s to prove B1
// processes while A1 is still in flight.
const inboundMocks = vi.hoisted(() => ({ processInbound: vi.fn() }));
vi.mock('../../src/modules/messaging/inbound.js', () => ({
  processInbound: inboundMocks.processInbound,
}));

// createAppWhatsappClient is stubbed to return a per-test fake, while the real
// consumer/delivery starters are kept (importOriginal) so the ordering test
// exercises the real loop.
const waHolder = vi.hoisted(() => ({ current: null as { client: unknown } | null }));
vi.mock('../../src/modules/messaging/inbound-consumer.js', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('../../src/modules/messaging/inbound-consumer.js')>();
  return {
    ...mod,
    createAppWhatsappClient: () => (waHolder.current ? (waHolder.current.client as never) : null),
  };
});

const { startWhatsappInboundConsumer } = await import(
  '../../src/modules/messaging/inbound-consumer.js'
);

let seq = 0;
const waId = () => `91982${String(Date.now()).slice(-6)}${String(++seq).padStart(3, '0')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tapIn(msgs: OutboundMessage[], action: string, value?: string): InboundEvent {
  for (const m of msgs) {
    const ids =
      m.kind === 'buttons'
        ? m.buttons.map((b) => b.id)
        : m.kind === 'list'
          ? m.rows.map((r) => r.id)
          : m.kind === 'cards'
            ? m.cards.map((c) => c.id)
            : [];
    for (const id of ids) {
      const d = decodeReplyId(id);
      if (d?.action === action && (value === undefined || d.value === value))
        return { type: 'reply', id };
    }
  }
  throw new Error(`${action} not offered: ${JSON.stringify(msgs)}`);
}

const payloadType = (p: Record<string, unknown>) => (p as { type?: string }).type;

describe('whatsapp hooks', () => {
  let c: Containers;
  let app: TestApp;
  let appOff: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      MESSAGING_WHATSAPP_ENABLED: true,
      WEB_URL: 'http://localhost:3000',
    });
    appOff = await buildTestApp(c, { WEB_URL: 'http://localhost:3000' });
    await seedCatalog(app);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await appOff?.close();
    await c?.stop();
  });

  // Catalog seeding for the quote/template path (same recipe as
  // messaging-conversation.test.ts): one garment type, face, background,
  // workflow, pose assigned to the type, and an HD cost of 5 per image.
  async function seedCatalog(a: TestApp) {
    const sfx = `hooks${Date.now()}${++seq}`;
    await a.redis.set(
      'config:system',
      JSON.stringify({ resolutions: { HD: { enabled: true, creditCost: 5, longEdgePx: 1536 } } }),
    );
    await a.db
      .insert(schema.creditPlans)
      .values({ slug: 'free', name: 'free', credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
    const [garmentType] = await a.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: `wa-gt-${sfx}`, label: 'Kurti' })
      .returning();
    await a.db.insert(schema.modelFaces).values({
      gender: 'women',
      label: `WaFace${sfx}`,
      r2Key: `wa-f${sfx}.jpg`,
      thumbnailKey: `wa-f${sfx}.jpg`,
    });
    const [background] = await a.db
      .insert(schema.modelBackgrounds)
      .values({ label: `WaBg${sfx}`, r2Key: `wa-b${sfx}.jpg`, thumbnailKey: `wa-b${sfx}.jpg` })
      .returning();
    const [workflow] = await a.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `wa-wf-${sfx}`,
        label: 'Wa workflow',
        jsonContent: {},
        faceNodeId: '1',
        poseNodeId: '2',
        bgNodeId: '3',
        upperNodeIds: ['4'],
        facePhasePromptNode: '5',
        garmentPhasePromptNode: '6',
      })
      .returning();
    const [pose] = await a.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `WaPose${sfx}`,
        genderSlug: 'women',
        r2Key: `wa-p${sfx}.jpg`,
        thumbnailKey: `wa-p${sfx}.jpg`,
        workflowTemplateId: workflow.id,
      })
      .returning();
    // The bot reads the studio's pose list: a pose shows for a type when it has
    // a pose_garment_configs row.
    await a.db
      .insert(schema.poseGarmentConfigs)
      .values({ poseAssetId: pose.id, subcategoryId: garmentType.id });
    if (!garmentType || !background) throw new Error('seeding failed');
    return { garmentTypeId: garmentType.id };
  }

  async function connectRecent() {
    const { userId } = await createVerifiedUserToken(
      app,
      `wa-hook-${seq}-${Date.now()}@example.com`,
    );
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+${waId()}`,
      userId,
      linkedVia: 'chat_link',
    });
    await app.db
      .update(schema.messagingAccounts)
      .set({ lastInboundAt: new Date() })
      .where(eq(schema.messagingAccounts.id, account.id));
    return { userId, account };
  }

  it('notifyConnected sends Connected + menu when the window is open', async () => {
    const { account } = await connectRecent();
    const wa = fakeWhatsapp();
    waHolder.current = wa;
    try {
      await notifyConnected(app, account.id);
    } finally {
      waHolder.current = null;
    }
    expect(wa.texts()[0]).toMatch(/^Connected ✅/);
    expect(wa.texts().at(-1)).toBe(COPY.menu);
  });

  it('notifyConnected sends nothing when the window is closed or the number opted out', async () => {
    const { account } = await connectRecent();
    await app.db
      .update(schema.messagingAccounts)
      .set({ lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(schema.messagingAccounts.id, account.id));
    const waClosed = fakeWhatsapp();
    waHolder.current = waClosed;
    try {
      await notifyConnected(app, account.id);
    } finally {
      waHolder.current = null;
    }
    expect(waClosed.sent).toHaveLength(0);

    await app.db
      .update(schema.messagingAccounts)
      .set({ lastInboundAt: new Date(), optedOutAt: new Date() })
      .where(eq(schema.messagingAccounts.id, account.id));
    const waOut = fakeWhatsapp();
    waHolder.current = waOut;
    try {
      await notifyConnected(app, account.id);
    } finally {
      waHolder.current = null;
    }
    expect(waOut.sent).toHaveLength(0);
  });

  it('notifyCreditsAdded on a NO_CREDITS session sends credits-added + the pose-count question', async () => {
    const { userId } = await createVerifiedUserToken(
      app,
      `wa-cred-${seq}-${Date.now()}@example.com`,
    );
    // A balance below one image's price (5): the pose-count step lands in NO_CREDITS.
    await app.db.insert(schema.userCredits).values({ userId, balance: 3 });
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+${waId()}`,
      userId,
      linkedVia: 'chat_link',
    });
    await app.db
      .update(schema.messagingAccounts)
      .set({ lastInboundAt: new Date() })
      .where(eq(schema.messagingAccounts.id, account.id));
    const acct = {
      id: account.id,
      userId,
      channel: account.channel,
      externalId: account.externalId,
    };
    const deps = createEngineDeps(app);
    let n = 0;
    const send = (e: InboundEvent) => runConversation(app, acct, e, `wamid.cred.${++n}`, deps);
    const key = await storeGarmentPhoto(app, userId, Buffer.from('fake-jpeg'), 'image/jpeg');
    let msgs = await send({ type: 'image', garmentKey: key });
    msgs = await send(tapIn(msgs, 'gender', 'women'));
    // The garment-type list carries real ids; tap the first type offered.
    const gtTap = (() => {
      for (const m of msgs) {
        if (m.kind !== 'list') continue;
        for (const row of m.rows) {
          const d = decodeReplyId(row.id);
          if (d?.action === 'gt') return { type: 'reply', id: row.id } as InboundEvent;
        }
      }
      throw new Error('no garment type offered');
    })();
    msgs = await send(gtTap);
    // The count question has no affordable option at 3 credits, so the type tap lands in NO_CREDITS.
    expect(msgs.map((m) => ('text' in m ? m.text : '')).join('\n')).toMatch(/pricing/);

    // The webhook that calls notifyCreditsAdded has already granted the credits;
    // the count question re-reads the balance, so mirror that here.
    await app.db
      .update(schema.userCredits)
      .set({ balance: 103 })
      .where(eq(schema.userCredits.userId, userId));
    const wa = fakeWhatsapp();
    waHolder.current = wa;
    try {
      await notifyCreditsAdded(app, userId, 100);
    } finally {
      waHolder.current = null;
    }
    expect(wa.texts()).toContain('100 credits added.');
    expect(wa.sent.some((s) => payloadType(s.payload) === 'interactive')).toBe(true);
    // Back at the pose-count question, which goes out as a list message.
    const countList = wa.sent.find(
      (s) => (s.payload as { interactive?: { type?: string } }).interactive?.type === 'list',
    );
    expect(countList).toBeDefined();
  });

  it('notifyCreditsAdded sends nothing with the flag off', async () => {
    const { userId } = await createVerifiedUserToken(
      appOff,
      `wa-cred-off-${seq}-${Date.now()}@example.com`,
    );
    const { account } = await connectAccount(appOff.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+${waId()}`,
      userId,
      linkedVia: 'chat_link',
    });
    await appOff.db
      .update(schema.messagingAccounts)
      .set({ lastInboundAt: new Date() })
      .where(eq(schema.messagingAccounts.id, account.id));
    const wa = fakeWhatsapp();
    waHolder.current = wa;
    try {
      await notifyCreditsAdded(appOff, userId, 100);
    } finally {
      waHolder.current = null;
    }
    expect(wa.sent).toHaveLength(0);
  });
});

describe('whatsapp inbound consumer ordering', () => {
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

  it('processes different senders in parallel while keeping one sender in order', async () => {
    // Unique senders per run: the leased test Redis index is not flushed
    // between runs, and a stale per-sender lock (60 s TTL) from an earlier run
    // would otherwise make this run's messages time out waiting for it.
    const senderA = `senderA-${Date.now()}-${++seq}`;
    const senderB = `senderB-${Date.now()}-${seq}`;
    // A stale stream (with a group whose last-delivered-id predates this run)
    // would hide this run's entries from '>' reads; start from a clean key.
    await app.redis.del(INBOUND_STREAM);
    const done: { id: string; from: string; start: number; end: number }[] = [];
    inboundMocks.processInbound.mockReset();
    inboundMocks.processInbound.mockImplementation(async (_a: unknown, _w: unknown, m: never) => {
      const msg = m as { messageId: string; from: string };
      const start = Date.now();
      // Sender A's first message holds the worker for 1 s (a recognition wait).
      if (msg.from === senderA && msg.messageId === 'A1') await sleep(1000);
      done.push({ id: msg.messageId, from: msg.from, start, end: Date.now() });
    });

    const wa = fakeWhatsapp();
    const stop = startWhatsappInboundConsumer(app, wa.client);
    try {
      await sleep(500); // let the loop create the consumer group first (it starts at '$')
      const entry = (messageId: string, from: string) =>
        JSON.stringify({
          messageId,
          from,
          profileName: null,
          content: { kind: 'text', text: 'hi' },
        });
      await app.redis.xadd(INBOUND_STREAM, '*', 'msg', entry('A1', senderA));
      await app.redis.xadd(INBOUND_STREAM, '*', 'msg', entry('A2', senderA));
      await app.redis.xadd(INBOUND_STREAM, '*', 'msg', entry('B1', senderB));

      const deadline = Date.now() + 15_000;
      while (done.length < 3 && Date.now() < deadline) await sleep(50);
      expect(done).toHaveLength(3);

      const byId = new Map(done.map((d) => [d.id, d]));
      const A1 = byId.get('A1');
      const A2 = byId.get('A2');
      const B1 = byId.get('B1');
      expect(A1).toBeDefined();
      expect(A2).toBeDefined();
      expect(B1).toBeDefined();
      if (!A1 || !A2 || !B1) throw new Error('missing consumer call');
      // B1 finished while A1 was still in flight: real parallelism, not sequence.
      expect(A1.start).toBeLessThanOrEqual(B1.end);
      expect(B1.end).toBeLessThan(A1.end);
      // Same sender stays in order: A2 only starts once A1 is done.
      expect(A2.start).toBeGreaterThanOrEqual(A1.end);

      // processInbound finishes just before handleOne XACKs, so wait for the
      // consumer's acknowledgement instead of racing its final Redis command.
      const ackDeadline = Date.now() + 2_000;
      let pendingCount = -1;
      while (pendingCount !== 0 && Date.now() < ackDeadline) {
        const pending = (await app.redis.xpending(
          INBOUND_STREAM,
          'messaging-inbound-cg',
        )) as unknown[];
        pendingCount = Number(pending[0]);
        if (pendingCount !== 0) await sleep(25);
      }
      expect(pendingCount).toBe(0);
    } finally {
      stop();
    }
  });
});
