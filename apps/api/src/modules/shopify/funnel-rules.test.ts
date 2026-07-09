import { describe, expect, it } from 'vitest';
import { matchesConditions } from './funnel-rules.js';

describe('matchesConditions', () => {
  const product = { productType: 'Shirts', tags: ['Sale', 'Cotton'], vendor: 'Acme Co' };

  it('returns false for an empty conditions array', () => {
    expect(matchesConditions(product, [])).toBe(false);
  });

  it('matches product_type with equals', () => {
    expect(
      matchesConditions(product, [{ field: 'product_type', operator: 'equals', value: 'Shirts' }]),
    ).toBe(true);
    expect(
      matchesConditions(product, [{ field: 'product_type', operator: 'equals', value: 'Pants' }]),
    ).toBe(false);
  });

  it('matches product_type with contains, case-insensitive', () => {
    expect(
      matchesConditions(product, [{ field: 'product_type', operator: 'contains', value: 'shirt' }]),
    ).toBe(true);
  });

  it('matches vendor with equals', () => {
    expect(
      matchesConditions(product, [{ field: 'vendor', operator: 'equals', value: 'Acme Co' }]),
    ).toBe(true);
    expect(
      matchesConditions(product, [{ field: 'vendor', operator: 'equals', value: 'acme co' }]),
    ).toBe(false);
  });

  it('matches tags by array membership, ignoring operator', () => {
    expect(matchesConditions(product, [{ field: 'tags', operator: 'equals', value: 'Sale' }])).toBe(
      true,
    );
    expect(
      matchesConditions(product, [{ field: 'tags', operator: 'contains', value: 'Sale' }]),
    ).toBe(true);
    expect(
      matchesConditions(product, [{ field: 'tags', operator: 'equals', value: 'Clearance' }]),
    ).toBe(false);
  });

  it('AND-combines multiple conditions — all must match', () => {
    expect(
      matchesConditions(product, [
        { field: 'product_type', operator: 'equals', value: 'Shirts' },
        { field: 'vendor', operator: 'equals', value: 'Acme Co' },
      ]),
    ).toBe(true);
    expect(
      matchesConditions(product, [
        { field: 'product_type', operator: 'equals', value: 'Shirts' },
        { field: 'vendor', operator: 'equals', value: 'Wrong Vendor' },
      ]),
    ).toBe(false);
  });

  it('returns false when the product field is null', () => {
    expect(
      matchesConditions({ productType: null, tags: null, vendor: null }, [
        { field: 'product_type', operator: 'equals', value: 'Shirts' },
      ]),
    ).toBe(false);
  });
});
