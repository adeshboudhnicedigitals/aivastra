import { describe, expect, it } from 'vitest';
import {
  type BasketDef,
  type BasketType,
  basketChoices,
  basketMembers,
  rankBaskets,
  whatsappIneligibleReason,
} from '../src/modules/messaging/baskets';

const type = (id: string, basketId: string | null, slug: string | null = id): BasketType => ({
  id,
  label: id[0]?.toUpperCase() + id.slice(1),
  slug,
  sortOrder: 0,
  basketId,
});

const TYPES: BasketType[] = [
  type('tanktop', 'upper'),
  type('vest', 'upper'),
  type('shirt', 'upper'),
  type('trouser', 'lower'),
  type('jeans', 'lower'),
  type('kurta', null),
  type('noslug', null, null),
];
const BASKETS: BasketDef[] = [
  { id: 'upper', name: 'Men upper', representativeSubcategoryId: 'shirt', sortOrder: 0 },
  { id: 'lower', name: 'Men lower', representativeSubcategoryId: null, sortOrder: 1 },
];

describe('rankBaskets', () => {
  it('sums member probabilities so a split between look-alikes still wins', () => {
    // No single type beats kurta, but the upper basket does.
    const ranked = rankBaskets(
      [
        { slug: 'kurta', p: 0.34 },
        { slug: 'tanktop', p: 0.3 },
        { slug: 'vest', p: 0.26 },
        { slug: 'trouser', p: 0.1 },
      ],
      TYPES,
      BASKETS,
    );
    expect(ranked.map((b) => b.key)).toEqual(['b:upper', 't:kurta', 'b:lower']);
    expect(ranked[0]).toMatchObject({ name: 'Men upper' });
    expect(ranked[0]?.score).toBeCloseTo(0.56);
    // A type in no basket is offered under its own label.
    expect(ranked[1]).toMatchObject({ name: 'Kurta', score: 0.34 });
  });

  it('ignores slugs that are not offered types and leaves unscored baskets out', () => {
    const ranked = rankBaskets(
      [
        { slug: 'unknown', p: 0.9 },
        { slug: 'jeans', p: 0.1 },
      ],
      TYPES,
      BASKETS,
    );
    expect(ranked).toEqual([{ key: 'b:lower', name: 'Men lower', score: 0.1 }]);
  });

  it('breaks a tie by admin order', () => {
    const ranked = rankBaskets(
      [
        { slug: 'jeans', p: 0.5 },
        { slug: 'shirt', p: 0.5 },
      ],
      TYPES,
      BASKETS,
    );
    expect(ranked.map((b) => b.key)).toEqual(['b:upper', 'b:lower']);
  });
});

describe('basketMembers', () => {
  it('puts the representative first, then the rest in order', () => {
    expect(basketMembers('b:upper', TYPES, BASKETS).map((m) => m.id)).toEqual([
      'shirt',
      'tanktop',
      'vest',
    ]);
  });

  it('without a representative keeps sort order', () => {
    expect(basketMembers('b:lower', TYPES, BASKETS).map((m) => m.id)).toEqual(['trouser', 'jeans']);
  });

  it('a singleton key is its own type; anything unknown is empty', () => {
    expect(basketMembers('t:kurta', TYPES, BASKETS)).toEqual([{ id: 'kurta', label: 'Kurta' }]);
    // A basketed type cannot be reached through a singleton key.
    expect(basketMembers('t:vest', TYPES, BASKETS)).toEqual([]);
    expect(basketMembers('b:gone', TYPES, BASKETS)).toEqual([]);
    expect(basketMembers('x:kurta', TYPES, BASKETS)).toEqual([]);
  });
});

describe('whatsappIneligibleReason', () => {
  const flags = {
    requiresLowerUpload: false,
    requiresThirdUpload: false,
    allowsFourthUpload: false,
    requiresMannequinStep: false,
  };

  it('allows a single-image type and names the first extra upload otherwise', () => {
    expect(whatsappIneligibleReason(flags)).toBeNull();
    expect(whatsappIneligibleReason({ ...flags, requiresLowerUpload: true })).toBe('lower_upload');
    expect(whatsappIneligibleReason({ ...flags, requiresThirdUpload: true })).toBe('third_upload');
    // Optional, but still a second image.
    expect(whatsappIneligibleReason({ ...flags, allowsFourthUpload: true })).toBe('fourth_upload');
    expect(whatsappIneligibleReason({ ...flags, requiresMannequinStep: true })).toBe(
      'mannequin_step',
    );
  });
});

describe('basketChoices', () => {
  it('lists baskets with an offerable member, then loose types, in order', () => {
    const offered = new Set(['vest', 'kurta', 'noslug']);
    expect(basketChoices(TYPES, BASKETS, offered)).toEqual([
      { key: 'b:upper', name: 'Men upper' },
      // Men lower has no offerable member, so it is not a dead-end row.
      { key: 't:kurta', name: 'Kurta' },
      // A type without a public slug is never guessed but can still be picked.
      { key: 't:noslug', name: 'Noslug' },
    ]);
  });
});
