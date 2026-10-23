import { describe, expect, it } from 'vitest';
import {
  buildPool,
  buildTryonBody,
  drawLooks,
  POSE_COUNTS,
  poseCountOptions,
  retryLookIds,
} from '../src/modules/messaging/engine/rules';
import type { Session } from '../src/modules/messaging/engine/types';
import { GT_SHIRT, look, POSES } from './helpers/engine-fakes';

// Lower items exist, shoes do not: only a default shoe could fill a shoe slot.
const SUPPLY = { lower: true, shoes: false };

const session = (over: Partial<Session> = {}): Session => ({
  v: 1,
  state: 'ASK_POSE_COUNT',
  nonce: 'n1',
  page: 0,
  aspectRatio: '3:4',
  resolution: '2K',
  photos: {},
  picked: [],
  garmentKey: 'inputs/x/garment.jpg',
  faceId: 'face-1',
  backgroundId: 'bg-1',
  garmentType: GT_SHIRT,
  ...over,
});

describe('buildPool', () => {
  it('keeps only poses the bot can generate, in order', () => {
    const { pool, cards } = buildPool(GT_SHIRT, POSES, SUPPLY);
    // 'd' needs shoes and GT_SHIRT has no default shoe (D49).
    expect(cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(pool.lowerOnly).toBe(false);
  });

  it('is lowerOnly when every pose dresses only the lower body', () => {
    const { pool } = buildPool(GT_SHIRT, [look('j', { hasUpper: false, hasLower: true })], SUPPLY);
    expect(pool.lowerOnly).toBe(true);
  });

  it('drops a pose with no garment slot (no usable workflow)', () => {
    const { cards } = buildPool(GT_SHIRT, [look('x', { hasUpper: false }), look('a')], SUPPLY);
    expect(cards.map((c) => c.id)).toEqual(['a']);
  });

  it('offers a lower or shoe pose only when the type can fill the slot', () => {
    const ids = (supply: { lower: boolean; shoes: boolean }, gt = GT_SHIRT) =>
      buildPool(gt, POSES, supply).cards.map((c) => c.id);
    // Items to draw from fill the slot even with no default on the type.
    expect(ids({ lower: true, shoes: true }, { ...GT_SHIRT, defaultLowerCatalogId: null })).toEqual(
      ['a', 'b', 'c', 'd'],
    );
    // Nothing to draw and no default: those poses are not offered.
    expect(
      ids({ lower: false, shoes: false }, { ...GT_SHIRT, defaultLowerCatalogId: null }),
    ).toEqual(['a', 'c']);
  });

  it('keeps ids and flags only in the session pool, and label + image in the cards', () => {
    const { pool, cards } = buildPool(GT_SHIRT, POSES, SUPPLY);
    expect(pool.looks[1]).toEqual({ id: 'b', hasLower: true, hasShoes: false });
    expect(cards[0]).toEqual({ id: 'a', label: 'Pose a', imageUrl: 'https://img/a.jpg' });
  });
});

describe('buildTryonBody', () => {
  const pool = buildPool(GT_SHIRT, POSES, SUPPLY).pool;

  it('sends custom looks: each pose on the one background, no template mapping', () => {
    const body = buildTryonBody(session({ pool }), ['c', 'a']);
    expect(body.inputs).toMatchObject({
      faceId: 'face-1',
      looks: [
        { poseId: 'c', backgroundId: 'bg-1' },
        { poseId: 'a', backgroundId: 'bg-1' },
      ],
    });
    expect(body.inputs).not.toHaveProperty('catalogueTemplateMappingId');
    expect(body.aspectRatio).toBe('3:4');
    expect(body.resolution).toBe('2K');
  });

  it('sends the run lower only when a chosen look has a lower slot', () => {
    const s = session({ pool, lowerCatalogId: 'lower-1' });
    expect(buildTryonBody(s, ['a']).inputs).not.toHaveProperty('lowerCatalogId');
    expect(buildTryonBody(s, ['b']).inputs.lowerCatalogId).toBe('lower-1');
  });

  it('sends the photo as the lower garment for a lower-only pool', () => {
    const lowerOnly = buildPool(
      GT_SHIRT,
      [look('j', { hasUpper: false, hasLower: true })],
      SUPPLY,
    ).pool;
    const body = buildTryonBody(session({ pool: lowerOnly }), ['j']);
    expect(body.inputs.lowerGarmentKey).toBe(body.inputs.upperGarmentKey);
  });

  it('throws when the session lacks the garment, face or background', () => {
    for (const over of [
      { garmentKey: undefined },
      { faceId: undefined },
      { backgroundId: undefined },
    ]) {
      expect(() => buildTryonBody(session({ pool, ...over }), ['a'])).toThrow('session incomplete');
    }
  });
});

describe('retryLookIds', () => {
  it('is the picked looks whose pose failed, in tap order', () => {
    const s = session({
      picked: ['a', 'e', 'c'],
      runs: [{ runId: 'run-1', images: 3, finished: true, failedPoseIds: ['c', 'e'] }],
    });
    expect(retryLookIds(s)).toEqual(['e', 'c']);
  });

  it('is empty when nothing failed', () => {
    expect(retryLookIds(session({ picked: ['a'], runs: [{ runId: 'r', images: 1 }] }))).toEqual([]);
  });
});

describe('poseCountOptions', () => {
  it('offers 1, 2, 3, 5', () => expect([...POSE_COUNTS]).toEqual([1, 2, 3, 5]));
  it('drops counts above the pool size', () =>
    expect(poseCountOptions(3, 10, 1000)).toEqual([1, 2, 3]));
  it('drops counts the balance cannot cover', () =>
    expect(poseCountOptions(10, 10, 30)).toEqual([1, 2, 3]));
  it('is empty when even one pose is unaffordable', () =>
    expect(poseCountOptions(10, 10, 5)).toEqual([]));
});

describe('drawLooks', () => {
  const identity = (ids: string[]) => ids;
  const reverse = (ids: string[]) => [...ids].reverse();

  it('draws n distinct pool ids through the shuffle', () => {
    expect(drawLooks(['a', 'b', 'c', 'd'], [], 2, reverse)).toEqual({
      ids: ['d', 'c'],
      seen: ['d', 'c'],
    });
  });

  it('avoids looks already seen and remembers the new ones', () => {
    expect(drawLooks(['a', 'b', 'c', 'd'], ['a', 'b'], 2, identity)).toEqual({
      ids: ['c', 'd'],
      seen: ['a', 'b', 'c', 'd'],
    });
  });

  it('tops up from seen looks when the unseen ones run out, and restarts the cycle', () => {
    expect(drawLooks(['a', 'b', 'c'], ['a', 'b'], 3, identity)).toEqual({
      ids: ['c', 'a', 'b'],
      seen: ['c', 'a', 'b'],
    });
  });

  it('returns the whole pool when n exceeds it', () => {
    expect(drawLooks(['a', 'b'], [], 5, identity).ids).toEqual(['a', 'b']);
  });

  it('drops seen ids that left the pool', () => {
    expect(drawLooks(['a', 'b'], ['gone'], 1, identity)).toEqual({ ids: ['a'], seen: ['a'] });
  });
});
