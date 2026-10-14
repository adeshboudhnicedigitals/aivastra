import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runConversation } from '../../src/modules/messaging/conversation';
import { createEngineDeps } from '../../src/modules/messaging/deps';
import { decodeReplyId } from '../../src/modules/messaging/engine/reply-id';
import { buildTryonBody } from '../../src/modules/messaging/engine/rules';
import type { InboundEvent, OutboundMessage } from '../../src/modules/messaging/engine/types';
import { CHANNEL_WHATSAPP, connectAccount } from '../../src/modules/messaging/identity';
import { storeGarmentPhoto } from '../../src/modules/messaging/photos';
import { createRun } from '../../src/modules/messaging/runs';
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

describe('messaging conversation (real deps)', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: TestApp['storage']['headObject'];
  // Fill in from your seeding: the ids the steps below tap.
  let seeded: { garmentTypeId: string; lookId: string };
  // Suffixes keep this file's rows distinct from any other file's (integration
  // files share one Postgres process, though each gets a fresh database).
  let phoneCounter = 0;

  beforeAll(async () => {
    c = await startContainers();
    // Recognition off: this test walks the list path, which needs no dispatcher.
    // WEB_URL is passed explicitly: tests build Env directly (test/helpers/api.ts
    // casts, so zod defaults never apply) and deps.ts reads it for its links.
    app = await buildTestApp(c, {
      MESSAGING_WHATSAPP_ENABLED: true,
      WEB_URL: 'http://localhost:3000',
    });
    realHeadObject = app.storage.headObject.bind(app.storage);
    const sfx = `${Date.now()}`;
    // An enabled 2K tier with creditCost 5: the bot always quotes and charges 2K,
    // so the count row reads '1 pose · 5 credits' and one image costs exactly 5.
    // HD stays enabled for the fallback test below.
    await app.redis.set(
      'config:system',
      JSON.stringify({
        resolutions: {
          HD: { enabled: true, creditCost: 5, longEdgePx: 1536 },
          '2K': { enabled: true, creditCost: 5, longEdgePx: 2048 },
        },
      }),
    );
    // users.tier defaults to 'free'; the routing join needs the matching plan row.
    await app.db
      .insert(schema.creditPlans)
      .values({ slug: 'free', name: 'free', credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: `wa-gt-${sfx}`, label: 'Kurti' })
      .returning();
    await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: `WaFace${sfx}`,
        r2Key: `wa-f${sfx}.jpg`,
        thumbnailKey: `wa-f${sfx}.jpg`,
      })
      .returning();
    const [background] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label: `WaBg${sfx}`, r2Key: `wa-b${sfx}.jpg`, thumbnailKey: `wa-b${sfx}.jpg` })
      .returning();
    const [workflow] = await app.db
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
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `WaPose${sfx}`,
        genderSlug: 'women',
        r2Key: `wa-p${sfx}.jpg`,
        thumbnailKey: `wa-p${sfx}.jpg`,
        workflowTemplateId: workflow.id,
      })
      .returning();
    const [template] = await app.db
      .insert(schema.catalogueTemplates)
      .values({ genderSlug: 'women', label: `WaTemplate${sfx}`, sortOrder: 0 })
      .returning();
    const [look] = await app.db
      .insert(schema.catalogueTemplateLooks)
      .values({
        templateId: template.id,
        poseAssetId: pose.id,
        backgroundId: background.id,
        sortOrder: 0,
      })
      .returning();
    const [mapping] = await app.db
      .insert(schema.catalogueTemplateSubcategories)
      .values({ templateId: template.id, subcategoryId: garmentType.id })
      .returning();
    await app.db.insert(schema.catalogueTemplatePoseWorkflows).values({
      mappingId: mapping.id,
      poseAssetId: pose.id,
      workflowTemplateId: workflow.id,
    });
    if (!garmentType || !look) throw new Error('seeding failed');
    // Assign seeded = { garmentTypeId, lookId } (lookId = the catalogue_template_looks.id).
    seeded = { garmentTypeId: garmentType.id, lookId: look.id };
  }, 60_000);

  // createJob's size check heads the object; the test photo is tiny but real.
  beforeEach(() => {
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

  // A connected seller with 100 credits, walked to the look carousel for 1 pose.
  async function walkToPick(tag: string) {
    const { userId } = await createVerifiedUserToken(app, `wa-${tag}-${Date.now()}@example.com`);
    await app.db.insert(schema.userCredits).values({ userId, balance: 100 });
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+91${Date.now().toString().slice(-10)}${phoneCounter++}`,
      userId,
      linkedVia: 'web_code',
    });
    const acct = {
      id: account.id,
      userId,
      channel: account.channel,
      externalId: account.externalId,
    };
    const deps = createEngineDeps(app);
    let n = 0;
    const send = (e: InboundEvent) => runConversation(app, acct, e, `wamid.${tag}.${++n}`, deps);

    const key = await storeGarmentPhoto(app, userId, Buffer.from('fake-jpeg'), 'image/jpeg');
    let msgs = await send({ type: 'image', garmentKey: key });
    msgs = await send(tapIn(msgs, 'gender', 'women'));
    msgs = await send(tapIn(msgs, 'gt', seeded.garmentTypeId));
    const countMsgs = msgs;
    msgs = await send(tapIn(msgs, 'count', '1'));
    return { userId, account, acct, send, msgs, countMsgs };
  }

  const balanceOf = async (userId: string) =>
    (
      await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId))
    )[0]?.balance;

  it('photo → gender → type → count → pick creates one charged job and records the run', async () => {
    const w = await walkToPick('conv');
    const { userId, account, acct, send } = w;
    const count = w.countMsgs.find((m) => m.kind === 'list');
    expect(count && count.kind === 'list' ? count.rows[0].title : '').toBe('1 pose · 5 credits');

    await send(tapIn(w.msgs, 'look', seeded.lookId));
    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    expect(session?.state).toBe('GENERATING');

    const [run] = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.catalogueId, session?.runId as string));
    expect(run).toMatchObject({ messagingAccountId: account.id, userId });
    expect(run.jobIds).toHaveLength(1);

    // D17: the bot is charged exactly what it quoted.
    expect(await balanceOf(userId)).toBe(95);
  });

  it('the same message id never creates a second run', async () => {
    const { userId, account, acct } = await walkToPick('dup');
    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    if (!session) throw new Error('no session');
    // Straight at createRun: after a run starts the session's nonce changes, so a
    // redelivered tap is already stale in the engine. This checks the second
    // guard — the idempotency key — that protects a crash between createJob and
    // the session save.
    const ctx = { userId, accountId: account.id, messageId: 'wamid.dup' };
    const body = buildTryonBody(session, [seeded.lookId]);
    const first = await createRun(app, ctx, body);
    const second = await createRun(app, ctx, body);
    expect(second).toEqual(first);
    const runs = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.messagingAccountId, account.id));
    expect(runs).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(95);
  });

  it('uses 3:4 and 2K for every bot run, whatever the seller saved on the web', async () => {
    // The chat has no picker for these; a fixed, known-good shape beats whatever
    // the seller last chose in the studio (which may be 1:1 or a disabled tier).
    const { userId } = await createVerifiedUserToken(app, `wa-fix-${Date.now()}@example.com`);
    await app.db
      .update(schema.users)
      .set({ defaultResolution: 'HD', defaultAspectRatio: '1:1' })
      .where(eq(schema.users.id, userId));
    expect(await createEngineDeps(app).getUserDefaults(userId)).toEqual({
      aspectRatio: '3:4',
      resolution: '2K',
    });
  });

  it('falls back to another enabled tier when 2K is disabled', async () => {
    // Without the fallback every bot job would fail with 'resolution "2K" is
    // not currently enabled'. Restore this file's config afterwards.
    const saved = await app.redis.get('config:system');
    await app.redis.set(
      'config:system',
      JSON.stringify({
        resolutions: {
          HD: { enabled: true, creditCost: 5, longEdgePx: 1536 },
          '2K': { enabled: false, creditCost: 10, longEdgePx: 2048 },
        },
      }),
    );
    try {
      const { userId } = await createVerifiedUserToken(app, `wa-res-${Date.now()}@example.com`);
      const defaults = await createEngineDeps(app).getUserDefaults(userId);
      expect(defaults).toEqual({ aspectRatio: '3:4', resolution: 'HD' });
    } finally {
      if (saved) await app.redis.set('config:system', saved);
      else await app.redis.del('config:system');
    }
  });
});
