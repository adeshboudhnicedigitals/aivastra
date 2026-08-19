import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAlertTick } from '../../src/modules/shopify/alert-scheduler.js';
import { buildTestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

let ctx: Containers;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let store: typeof schema.shopifyStores.$inferSelect;
let sent: Array<{ to: string; level: string }>;

const deps = () => ({
  sendEmail: async (_app: unknown, args: { to: string; level: string }) => {
    sent.push({ to: args.to, level: args.level });
  },
});

/** Puts the store at a chosen balance with a burn history that yields `days` of runway. */
async function seedStore(balance: number, creditsSpentInWindow: number, jobCount = 3) {
  await app.db.delete(schema.jobs).where(eq(schema.jobs.shopifyStoreId, store.id));
  await app.db
    .insert(schema.shopifyStoreCredits)
    .values({ storeId: store.id, balance })
    .onConflictDoUpdate({
      target: schema.shopifyStoreCredits.storeId,
      set: { balance },
    });
  if (jobCount > 0) {
    const per = Math.floor(creditsSpentInWindow / jobCount);
    await app.db.insert(schema.jobs).values(
      Array.from({ length: jobCount }, () => ({
        shopifyStoreId: store.id,
        status: 'COMPLETED' as const,
        creditsCharged: per,
      })),
    );
  }
  await app.db
    .update(schema.shopifyStores)
    .set({ lastAlertLevel: null, lastAlertAt: null })
    .where(eq(schema.shopifyStores.id, store.id));
}

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
  [store] = await app.db
    .insert(schema.shopifyStores)
    .values({
      shopDomain: 'alerting-test.myshopify.com',
      shopifyShopId: 55501,
      accessToken: 'enc:token',
      scope: 'read_products',
      shopEmail: 'owner@alerting-test.example',
    })
    .returning();
});

beforeEach(() => {
  sent = [];
});

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('alert scheduler', () => {
  it('emails once when a store first crosses into warning', async () => {
    // 350 credits, 350 spent over the 7-day window = 50/day = 7 days... just under.
    await seedStore(300, 350);
    await runAlertTick(app, deps());
    expect(sent).toHaveLength(1);
    expect(sent[0].level).toBe('warning');
    expect(sent[0].to).toBe('owner@alerting-test.example');
  });

  it('does not email again while the level is unchanged', async () => {
    await seedStore(300, 350);
    await runAlertTick(app, deps());
    expect(sent).toHaveLength(1);

    sent = [];
    await runAlertTick(app, deps());
    expect(sent).toHaveLength(0);
  });

  it('emails again when the level escalates', async () => {
    await seedStore(300, 350);
    await runAlertTick(app, deps());
    expect(sent[0].level).toBe('warning');

    sent = [];
    // Same burn, far less balance — now under two days.
    await app.db
      .update(schema.shopifyStoreCredits)
      .set({ balance: 50 })
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    await runAlertTick(app, deps());
    expect(sent).toHaveLength(1);
    expect(sent[0].level).toBe('critical');
  });

  it('re-arms after a merchant recovers, so a later decline alerts again', async () => {
    await seedStore(300, 350);
    await runAlertTick(app, deps());

    sent = [];
    // Merchant buys a pack.
    await app.db
      .update(schema.shopifyStoreCredits)
      .set({ balance: 5000 })
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    await runAlertTick(app, deps());
    expect(sent).toHaveLength(0);

    const [recovered] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(recovered.lastAlertLevel).toBe('ok');

    // ...then burns back down.
    await app.db
      .update(schema.shopifyStoreCredits)
      .set({ balance: 300 })
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    await runAlertTick(app, deps());
    expect(sent).toHaveLength(1);
  });

  it('never emails a store that has never run a job', async () => {
    await seedStore(25, 0, 0);
    await runAlertTick(app, deps());
    expect(sent).toHaveLength(0);
  });

  it('skips a store with no shop email and does not block the others', async () => {
    const [noEmail] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: 'no-email-test.myshopify.com',
        shopifyShopId: 55502,
        accessToken: 'enc:token',
        scope: 'read_products',
        shopEmail: null,
      })
      .returning();
    await app.db.insert(schema.shopifyStoreCredits).values({ storeId: noEmail.id, balance: 10 });
    await app.db
      .insert(schema.jobs)
      .values({ shopifyStoreId: noEmail.id, status: 'COMPLETED', creditsCharged: 100 });

    await seedStore(300, 350);
    await runAlertTick(app, deps());

    // The email-less store produced no send, but the healthy one still did.
    expect(sent.every((s) => s.to === 'owner@alerting-test.example')).toBe(true);
    expect(sent.length).toBeGreaterThan(0);

    await app.db.delete(schema.shopifyStores).where(eq(schema.shopifyStores.id, noEmail.id));
  });

  it('ignores uninstalled stores', async () => {
    await seedStore(300, 350);
    await app.db
      .update(schema.shopifyStores)
      .set({ uninstalledAt: new Date() })
      .where(eq(schema.shopifyStores.id, store.id));

    await runAlertTick(app, deps());
    expect(sent).toHaveLength(0);

    await app.db
      .update(schema.shopifyStores)
      .set({ uninstalledAt: null })
      .where(eq(schema.shopifyStores.id, store.id));
  });
});
