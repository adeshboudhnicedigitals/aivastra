import { describe, expect, it } from 'vitest';
import { matchesConditions } from './funnel-rules.js';

describe('matchesConditions', () => {
  const product = {
    productType: 'Shirts',
    tags: ['Sale', 'Cotton'],
    vendor: 'Acme Co',
    collections: ['Summer', 'New Arrivals'],
  };

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

  it('matches vendor with equals, case-insensitively', () => {
    expect(
      matchesConditions(product, [{ field: 'vendor', operator: 'equals', value: 'Acme Co' }]),
    ).toBe(true);
    // Merchants type rule values by hand; a case mismatch against the Shopify
    // value silently produced an unassignable product before.
    expect(
      matchesConditions(product, [{ field: 'vendor', operator: 'equals', value: 'acme co' }]),
    ).toBe(true);
    expect(
      matchesConditions(product, [{ field: 'vendor', operator: 'equals', value: 'Other Co' }]),
    ).toBe(false);
  });

  it('matches tags with equals by whole-tag membership', () => {
    expect(matchesConditions(product, [{ field: 'tags', operator: 'equals', value: 'Sale' }])).toBe(
      true,
    );
    expect(matchesConditions(product, [{ field: 'tags', operator: 'equals', value: 'sale' }])).toBe(
      true,
    );
    expect(
      matchesConditions(product, [{ field: 'tags', operator: 'equals', value: 'Clearance' }]),
    ).toBe(false);
    // `equals` stays whole-value: a partial tag must not match.
    expect(matchesConditions(product, [{ field: 'tags', operator: 'equals', value: 'Sal' }])).toBe(
      false,
    );
  });

  it('matches tags with contains by substring of any tag', () => {
    expect(
      matchesConditions(product, [{ field: 'tags', operator: 'contains', value: 'Sale' }]),
    ).toBe(true);
    expect(
      matchesConditions(product, [{ field: 'tags', operator: 'contains', value: 'cot' }]),
    ).toBe(true);
    expect(
      matchesConditions({ ...product, tags: ['Upper Garment'] }, [
        { field: 'tags', operator: 'contains', value: 'upper' },
      ]),
    ).toBe(true);
    expect(
      matchesConditions(product, [{ field: 'tags', operator: 'contains', value: 'denim' }]),
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
      matchesConditions({ productType: null, tags: null, vendor: null, collections: null }, [
        { field: 'product_type', operator: 'equals', value: 'Shirts' },
      ]),
    ).toBe(false);
  });

  it('matches collections with equals by whole-title membership', () => {
    expect(
      matchesConditions(product, [{ field: 'collections', operator: 'equals', value: 'Summer' }]),
    ).toBe(true);
    expect(
      matchesConditions(product, [{ field: 'collections', operator: 'equals', value: 'summer' }]),
    ).toBe(true);
    expect(
      matchesConditions(product, [{ field: 'collections', operator: 'equals', value: 'Winter' }]),
    ).toBe(false);
  });

  it('matches collections with contains by substring of any title', () => {
    expect(
      matchesConditions(product, [
        { field: 'collections', operator: 'contains', value: 'New Arrivals' },
      ]),
    ).toBe(true);
    expect(
      matchesConditions({ ...product, collections: ["Men's Shirts"] }, [
        { field: 'collections', operator: 'contains', value: 'Men' },
      ]),
    ).toBe(true);
    expect(
      matchesConditions(product, [{ field: 'collections', operator: 'contains', value: 'Winter' }]),
    ).toBe(false);
  });

  it('treats an empty array field as no match, not a match-all', () => {
    expect(
      matchesConditions({ productType: 'Shirts', tags: [], vendor: 'Acme Co', collections: [] }, [
        { field: 'tags', operator: 'contains', value: 'upper' },
      ]),
    ).toBe(false);
  });

  it('returns false for collections when the product has no collections', () => {
    expect(
      matchesConditions({ productType: 'Shirts', tags: null, vendor: null, collections: null }, [
        { field: 'collections', operator: 'equals', value: 'Summer' },
      ]),
    ).toBe(false);
  });
});
