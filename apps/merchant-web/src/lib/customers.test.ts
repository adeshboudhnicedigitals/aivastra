import { describe, expect, it } from 'vitest';
import { consentLabel, displayName, EMPTY_FILTERS, filtersToQuery, hasFilters } from './customers';

describe('filtersToQuery', () => {
  it('is empty for no filters', () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toBe('');
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
  });
  it('carries only what is set, and extras', () => {
    expect(
      filtersToQuery(
        { q: ' anu ', marketing: 'yes', minVisits: 3, branchId: 'b1' },
        { limit: 50, cursor: undefined },
      ),
    ).toBe('?q=anu&branchId=b1&marketing=yes&minVisits=3&limit=50');
  });
});

describe('labels', () => {
  it('names consent and blank customers', () => {
    expect(consentLabel(null)).toBe('Not asked');
    expect(consentLabel(true)).toBe('Yes');
    expect(consentLabel(false)).toBe('No');
    expect(displayName('  ')).toBe('Unnamed');
    expect(displayName('Priya')).toBe('Priya');
  });
});
