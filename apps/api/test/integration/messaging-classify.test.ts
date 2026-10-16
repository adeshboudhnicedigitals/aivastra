import { schema } from '@aivastra/db';
import {
  GARMENT_RECOGNITION_STREAM,
  type GarmentRecognitionRequest,
  garmentRecognitionResultKey,
} from '@aivastra/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recognizeGarment } from '../../src/modules/messaging/classify';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('garment recognition (api side)', () => {
  let c: Containers;
  let app: TestApp;
  let ids: { shirt: string; kurti: string };

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { GARMENT_RECOGNITION_ENABLED: true });
    const rows = await app.db
      .insert(schema.garmentSubcategories)
      .values([
        {
          genderSlug: 'women',
          slug: 'fullshirt',
          label: 'Full shirt',
          publicApiSlug: 'wa-full-shirt',
        },
        { genderSlug: 'women', slug: 'kurti', label: 'Kurti', publicApiSlug: 'wa-kurti' },
        // No public slug: cannot be recognised, only picked from the list.
        { genderSlug: 'women', slug: 'gown', label: 'Gown' },
        // Another gender: never offered for 'women'.
        { genderSlug: 'men', slug: 'kurta', label: 'Kurta', publicApiSlug: 'wa-kurta' },
      ])
      .returning({ id: schema.garmentSubcategories.id, slug: schema.garmentSubcategories.slug });
    const by = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
    ids = { shirt: by.fullshirt, kurti: by.kurti };
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  // Stands in for plan 5's dispatcher: waits for the next request after `since`
  // and answers it. Returns the request so the test can inspect it.
  async function answerNext(
    since: string,
    result: { answer: string | null; error: 'no_worker' | 'failed' | 'expired' | null },
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

  it("asks with that gender's slugged types and maps the answer to the row", async () => {
    const since = await lastId();
    const [hit, request] = await Promise.all([
      recognizeGarment(app, 'inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: 'WA-Kurti.', error: null }),
    ]);
    expect(request.garmentKey).toBe('inputs/x/garment.jpg');
    expect(request.options.map((o) => o.slug).sort()).toEqual(['wa-full-shirt', 'wa-kurti']);
    expect(hit).toEqual({ garmentTypeId: ids.kurti, label: 'Kurti' });
  });

  it('an answer outside the options is not recognised', async () => {
    const since = await lastId();
    const [hit] = await Promise.all([
      recognizeGarment(app, 'inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: 'wa-kurta', error: null }),
    ]);
    expect(hit).toBeNull();
  });

  it('a dispatcher error is not recognised', async () => {
    const since = await lastId();
    const [hit] = await Promise.all([
      recognizeGarment(app, 'inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: null, error: 'no_worker' }),
    ]);
    expect(hit).toBeNull();
  });

  it('no answer within the budget is not recognised', async () => {
    const started = Date.now();
    expect(
      await recognizeGarment(app, 'inputs/x/garment.jpg', 'women', { budgetMs: 300 }),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('with the flag off nothing is requested', async () => {
    const before = await app.redis.xlen(GARMENT_RECOGNITION_STREAM);
    const off = { ...app, env: { ...app.env, GARMENT_RECOGNITION_ENABLED: false } } as TestApp;
    expect(await recognizeGarment(off, 'inputs/x/garment.jpg', 'women')).toBeNull();
    expect(await app.redis.xlen(GARMENT_RECOGNITION_STREAM)).toBe(before);
  });
});
