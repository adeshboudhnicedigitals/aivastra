import { schema } from '@aivastra/db';
import {
  GARMENT_RECOGNITION_STREAM,
  type GarmentRecognitionRequest,
  garmentRecognitionResultKey,
} from '@aivastra/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  recognizeKind,
  resolveRecognition,
  startRecognition,
  typeForKind,
} from '../../src/modules/messaging/classify';
import type { Gender } from '../../src/modules/messaging/engine/types';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('garment recognition (api side)', () => {
  let c: Containers;
  let app: TestApp;
  let ids: { shirt: string; kurti: string; kurtiMen: string };

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
        // Same kind as the women's Kurti: one option for the model, a row per gender.
        { genderSlug: 'men', slug: 'kurti-m', label: 'Kurti', publicApiSlug: 'wa-kurti-men' },
      ])
      .returning({ id: schema.garmentSubcategories.id, slug: schema.garmentSubcategories.slug });
    const by = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
    ids = { shirt: by.fullshirt, kurti: by.kurti, kurtiMen: by['kurti-m'] };
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

  // Both halves back to back, as the engine does across the gender question.
  async function recognize(key: string, gender: Gender, opts: { budgetMs?: number } = {}) {
    const ticket = await startRecognition(app, key, opts);
    return ticket ? resolveRecognition(app, ticket, gender) : null;
  }

  it('recognizeKind returns the kind label, one option per label across genders', async () => {
    const since = await lastId();
    const [kind, request] = await Promise.all([
      recognizeKind(app, 'inputs/x/garment.jpg'),
      answerNext(since, { answer: 'WA-Kurti.', error: null }),
    ]);
    expect(kind).toEqual({ label: 'Kurti' });
    expect(request.options.map((o) => o.slug).sort()).toEqual([
      'wa-full-shirt',
      'wa-kurta',
      'wa-kurti',
    ]);
  });

  it('typeForKind maps a kind to the tapped gender row, or null when that gender lacks it', async () => {
    expect(await typeForKind(app, 'kurti', 'women')).toEqual({
      garmentTypeId: ids.kurti,
      label: 'Kurti',
    });
    expect(await typeForKind(app, 'Kurti', 'men')).toEqual({
      garmentTypeId: ids.kurtiMen,
      label: 'Kurti',
    });
    expect(await typeForKind(app, 'Kurta', 'women')).toBeNull();
  });

  it('recognizeKind returns null when disabled, on an error answer, and on no match', async () => {
    const off = { ...app, env: { ...app.env, GARMENT_RECOGNITION_ENABLED: false } } as TestApp;
    expect(await recognizeKind(off, 'inputs/x/garment.jpg')).toBeNull();
    const since = await lastId();
    const [errored] = await Promise.all([
      recognizeKind(app, 'inputs/x/garment.jpg'),
      answerNext(since, { answer: null, error: 'no_worker' }),
    ]);
    expect(errored).toBeNull();
    const since2 = await lastId();
    const [unmatched] = await Promise.all([
      recognizeKind(app, 'inputs/x/garment.jpg'),
      answerNext(since2, { answer: 'wa-nonsense', error: null }),
    ]);
    expect(unmatched).toBeNull();
  });

  const lastId = async () =>
    (await app.redis.xrevrange(GARMENT_RECOGNITION_STREAM, '+', '-', 'COUNT', 1))[0]?.[0] ?? '0-0';

  it('asks with one option per kind across genders and maps the answer to the tapped gender', async () => {
    const since = await lastId();
    const [hit, request] = await Promise.all([
      recognize('inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: 'WA-Kurti.', error: null }),
    ]);
    expect(request.garmentKey).toBe('inputs/x/garment.jpg');
    // The men's Kurti shares the women's label: one option, not two.
    expect(request.options.map((o) => o.slug).sort()).toEqual([
      'wa-full-shirt',
      'wa-kurta',
      'wa-kurti',
    ]);
    expect(hit).toEqual({ garmentTypeId: ids.kurti, label: 'Kurti' });
  });

  it("the same answer resolves to the other gender's own row", async () => {
    const since = await lastId();
    const [hit] = await Promise.all([
      recognize('inputs/x/garment.jpg', 'men'),
      answerNext(since, { answer: 'wa-kurti', error: null }),
    ]);
    expect(hit).toEqual({ garmentTypeId: ids.kurtiMen, label: 'Kurti' });
  });

  it('a kind the tapped gender does not have is not recognised', async () => {
    const since = await lastId();
    const [hit] = await Promise.all([
      recognize('inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: 'wa-kurta', error: null }),
    ]);
    expect(hit).toBeNull();
  });

  it('an answer outside the options is not recognised', async () => {
    const since = await lastId();
    const [hit] = await Promise.all([
      recognize('inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: 'wa-nonsense', error: null }),
    ]);
    expect(hit).toBeNull();
  });

  it('a dispatcher error is not recognised', async () => {
    const since = await lastId();
    const [hit] = await Promise.all([
      recognize('inputs/x/garment.jpg', 'women'),
      answerNext(since, { answer: null, error: 'no_worker' }),
    ]);
    expect(hit).toBeNull();
  });

  it('no answer within the budget is not recognised', async () => {
    const started = Date.now();
    expect(await recognize('inputs/x/garment.jpg', 'women', { budgetMs: 300 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('with the flag off nothing is requested', async () => {
    const before = await app.redis.xlen(GARMENT_RECOGNITION_STREAM);
    const off = { ...app, env: { ...app.env, GARMENT_RECOGNITION_ENABLED: false } } as TestApp;
    expect(await startRecognition(off, 'inputs/x/garment.jpg')).toBeNull();
    expect(await app.redis.xlen(GARMENT_RECOGNITION_STREAM)).toBe(before);
  });
});
