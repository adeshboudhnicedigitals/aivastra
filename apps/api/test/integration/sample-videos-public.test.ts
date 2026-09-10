import { schema } from '@aivastra/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const CONFIG_KEY = 'config:system';

describe('GET /v1/models/sample-videos', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  // Prevent the custom pricing config seeded below from leaking into any
  // other test that shares this Redis instance (same pattern as
  // admin-config.test.ts).
  afterEach(async () => {
    await app.redis.del(CONFIG_KEY);
  });
  async function authHeader() {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `svpub-${Date.now()}@x.com`, emailVerified: true })
      .returning();
    const token = await signAccess(
      new TextEncoder().encode(app.env.JWT_SECRET),
      user.id,
      { kind: 'access' },
      app.env.JWT_EXPIRY,
    );
    return { authorization: `Bearer ${token}` };
  }
  it('returns only active, non-deleted sample videos ordered by sortOrder, each with its own creditCost', async () => {
    const [active1] = await app.db
      .insert(schema.sampleVideos)
      .values({
        title: 'B',
        videoR2Key: 'sample-videos/a.mp4',
        thumbnailR2Key: 'sample-videos/a.thumb.jpg',
        prompt: 'p',
        sortOrder: 2,
        duration: 8,
        quality: '720p',
      })
      .returning();
    const [active2] = await app.db
      .insert(schema.sampleVideos)
      .values({
        title: 'A',
        videoR2Key: 'sample-videos/b.mp4',
        thumbnailR2Key: 'sample-videos/b.thumb.jpg',
        prompt: 'p',
        sortOrder: 1,
        duration: 15,
        quality: '1080p',
      })
      .returning();
    await app.db.insert(schema.sampleVideos).values({
      title: 'Inactive',
      videoR2Key: 'sample-videos/c.mp4',
      thumbnailR2Key: 'sample-videos/c.thumb.jpg',
      prompt: 'p',
      isActive: false,
    });
    // Seed a non-default pricing config with distinct per-tier bases and a
    // non-zero perSecondRate. Under the default config (qualityBase=150 flat,
    // perSecondRate=0) every tier resolves to the same 150 regardless of
    // duration/quality, so a test asserting against those defaults couldn't
    // tell correct per-row wiring apart from a bug that hoists/swaps/hardcodes
    // a single duration+quality across all items — every tier would still
    // coincidentally cost 150. Distinct bases + a per-second rate force
    // active1 (8s/720p) and active2 (15s/1080p) to distinct, independently
    // computed costs, so the assertions below actually prove each item's cost
    // is derived from its own row.
    await app.redis.set(
      CONFIG_KEY,
      JSON.stringify({
        pixverseVideoPricing: {
          perSecondRate: 5,
          qualityBase: { '360p': 10, '540p': 20, '720p': 30, '1080p': 50 },
        },
      }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/sample-videos',
      headers: await authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty('creditCost');
    const items = body.items as Array<{
      id: string;
      thumbnailUrl: string;
      previewVideoUrl: string;
      creditCost: number;
    }>;
    expect(items.map((i) => i.id)).toEqual([active2.id, active1.id]);
    // active1: duration 8, quality '720p' -> 30 + 8*5 = 70
    // active2: duration 15, quality '1080p' -> 50 + 15*5 = 125
    // Distinct, exactly-computed values per item — this is what actually
    // proves creditCost is driven by each row's own duration/quality rather
    // than a shared or hoisted value.
    expect(items[0].creditCost).toBe(125);
    expect(items[1].creditCost).toBe(70);
    expect(items[0].thumbnailUrl).toContain('sample-videos/b.thumb.jpg');
    expect(items[0].previewVideoUrl).toContain('sample-videos/b.mp4');
    expect(items[0].thumbnailUrl).toContain('X-Amz-Signature');
    expect(items[0].previewVideoUrl).toContain('X-Amz-Signature');
  });

  it('also returns the resolved pixverseVideoPricing config, merged with defaults', async () => {
    await app.redis.set(
      CONFIG_KEY,
      JSON.stringify({
        pixverseVideoPricing: {
          perSecondRate: 3,
          // Only 720p overridden — 360p/540p/1080p must fall back to the
          // default qualityBase (150) rather than come back undefined.
          qualityBase: { '720p': 40 },
        },
      }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/sample-videos',
      headers: await authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pixverseVideoPricing).toEqual({
      perSecondRate: 3,
      qualityBase: { '360p': 150, '540p': 150, '720p': 40, '1080p': 150 },
    });
  });
});
