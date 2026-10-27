import { schema } from '@aivastra/db';
import {
  GARMENT_RECOGNITION_STREAM,
  type GarmentRecognitionRequest,
  garmentRecognitionResultKey,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recognizeBaskets, typesOfBasket } from '../../src/modules/messaging/classify';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('garment recognition (api side)', () => {
  let c: Containers;
  let app: TestApp;
  let ids: Record<string, string>;
  let tops: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { GARMENT_RECOGNITION_ENABLED: true });
    const [basket] = await app.db
      .insert(schema.whatsappBaskets)
      .values({ genderSlug: 'women', name: 'Tops' })
      .returning({ id: schema.whatsappBaskets.id });
    tops = (basket as { id: string }).id;
    const rows = await app.db
      .insert(schema.garmentSubcategories)
      .values([
        {
          genderSlug: 'women',
          slug: 'fullshirt',
          label: 'Full shirt',
          publicApiSlug: 'wa-full-shirt',
          sortOrder: 1,
          whatsappBasketId: tops,
        },
        {
          genderSlug: 'women',
          slug: 'top',
          label: 'Top',
          publicApiSlug: 'wa-top',
          sortOrder: 2,
          whatsappBasketId: tops,
        },
        { genderSlug: 'women', slug: 'kurti', label: 'Kurti', publicApiSlug: 'wa-kurti' },
        // No public slug: cannot be recognised, only picked from the list.
        { genderSlug: 'women', slug: 'gown', label: 'Gown' },
        // Two images: never offered on WhatsApp at all.
        {
          genderSlug: 'women',
          slug: 'set',
          label: 'Kurti set',
          publicApiSlug: 'wa-set',
          requiresLowerUpload: true,
        },
        // Another gender: never offered for 'women'.
        { genderSlug: 'men', slug: 'kurta', label: 'Kurta', publicApiSlug: 'wa-kurta' },
      ])
      .returning({ id: schema.garmentSubcategories.id, slug: schema.garmentSubcategories.slug });
    ids = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  // Stands in for plan 5's dispatcher: waits for the next request after `since`
  // and answers it. Returns the request so the test can inspect it.
  async function answerNext(
    since: string,
    result: {
      answer: string | null;
      error: 'no_worker' | 'failed' | 'expired' | null;
      ranked?: { slug: string; p: number }[];
    },
  ): Promise<GarmentRecognitionRequest> {
    // Up to 5 s: the first call also builds the options cache for the gender.
    for (let i = 0; i < 100; i++) {
      const entries = await app.redis.xrange(GARMENT_RECOGNITION_STREAM, `(${since}`, '+');
      if (entries.length > 0) {
        const [, fields] = entries[0];
        const request = JSON.parse(fields[1]) as GarmentRecognitionRequest;
        await app.redis.set(
          garmentRecognitionResultKey(request.requestId),
          JSON.stringify({ ...result, ms: 900 }),
          'EX',
          60,
        );
        return request;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('no recognition request arrived');
  }

  const lastId = async () =>
    (await app.redis.xrevrange(GARMENT_RECOGNITION_STREAM, '+', '-', 'COUNT', 1))[0]?.[0] ?? '0-0';

  const KEY = 'inputs/x/garment.jpg';

  it("sends only the gender's single-image types with a public slug, and the gender", async () => {
    const since = await lastId();
    const [, request] = await Promise.all([
      recognizeBaskets(app, KEY, 'women'),
      answerNext(since, { answer: 'wa-kurti', error: null }),
    ]);
    expect(request.garmentKey).toBe(KEY);
    expect(request.gender).toBe('women');
    expect(request.options.map((o) => o.slug).sort()).toEqual([
      'wa-full-shirt',
      'wa-kurti',
      'wa-top',
    ]);
  });

  it('sums a ranking per basket: two weak tops beat one stronger kurti', async () => {
    const since = await lastId();
    const [ranked] = await Promise.all([
      recognizeBaskets(app, KEY, 'women'),
      answerNext(since, {
        answer: 'wa-kurti',
        error: null,
        ranked: [
          { slug: 'wa-kurti', p: 0.4 },
          { slug: 'wa-top', p: 0.35 },
          { slug: 'wa-full-shirt', p: 0.25 },
        ],
      }),
    ]);
    expect(ranked?.map((b) => [b.key, b.name])).toEqual([
      [`b:${tops}`, 'Tops'],
      [`t:${ids.kurti}`, 'Kurti'],
    ]);
    expect(ranked?.[0]?.score).toBeCloseTo(0.6);
  });

  it('a weak top basket is not offered', async () => {
    const since = await lastId();
    const [ranked] = await Promise.all([
      recognizeBaskets(app, KEY, 'women'),
      answerNext(since, {
        answer: 'wa-kurti',
        error: null,
        ranked: [
          { slug: 'wa-kurti', p: 0.45 },
          { slug: 'wa-top', p: 0.3 },
          { slug: 'wa-gone', p: 0.25 },
        ],
      }),
    ]);
    // Tops sums to 0.3 and Kurti is 0.45: neither reaches MIN_BASKET_SCORE.
    expect(ranked).toBeNull();
  });

  it('a backend that cannot rank: the single matched answer is the guess', async () => {
    const since = await lastId();
    const [ranked] = await Promise.all([
      recognizeBaskets(app, KEY, 'women'),
      answerNext(since, { answer: 'WA-Top.', error: null }),
    ]);
    expect(ranked).toEqual([{ key: `b:${tops}`, name: 'Tops', score: 1 }]);
  });

  it('an answer outside the options, a dispatcher error and a timeout are not recognised', async () => {
    const since = await lastId();
    const [unmatched] = await Promise.all([
      recognizeBaskets(app, KEY, 'women'),
      answerNext(since, { answer: 'wa-kurta', error: null }),
    ]);
    expect(unmatched).toBeNull();
    const since2 = await lastId();
    const [errored] = await Promise.all([
      recognizeBaskets(app, KEY, 'women'),
      answerNext(since2, { answer: null, error: 'no_worker' }),
    ]);
    expect(errored).toBeNull();
    const started = Date.now();
    expect(await recognizeBaskets(app, KEY, 'women', { budgetMs: 300 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('typesOfBasket puts the representative first and ignores an inactive basket', async () => {
    expect((await typesOfBasket(app, 'women', `b:${tops}`)).map((t) => t.id)).toEqual([
      ids.fullshirt,
      ids.top,
    ]);
    await app.db
      .update(schema.whatsappBaskets)
      .set({ representativeSubcategoryId: ids.top })
      .where(eq(schema.whatsappBaskets.id, tops));
    expect((await typesOfBasket(app, 'women', `b:${tops}`)).map((t) => t.id)).toEqual([
      ids.top,
      ids.fullshirt,
    ]);
    await app.db
      .update(schema.whatsappBaskets)
      .set({ isActive: false })
      .where(eq(schema.whatsappBaskets.id, tops));
    try {
      expect(await typesOfBasket(app, 'women', `b:${tops}`)).toEqual([]);
      // Its members are now baskets of their own.
      expect(await typesOfBasket(app, 'women', `t:${ids.top}`)).toEqual([
        { id: ids.top, label: 'Top' },
      ]);
    } finally {
      await app.db
        .update(schema.whatsappBaskets)
        .set({ isActive: true })
        .where(eq(schema.whatsappBaskets.id, tops));
    }
  });

  it('with the flag off nothing is requested', async () => {
    const before = await app.redis.xlen(GARMENT_RECOGNITION_STREAM);
    const off = { ...app, env: { ...app.env, GARMENT_RECOGNITION_ENABLED: false } } as TestApp;
    expect(await recognizeBaskets(off, KEY, 'women')).toBeNull();
    expect(await app.redis.xlen(GARMENT_RECOGNITION_STREAM)).toBe(before);
  });
});
