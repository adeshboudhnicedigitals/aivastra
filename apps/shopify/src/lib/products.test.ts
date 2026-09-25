import { describe, expect, it } from 'vitest';
import { CLEARED_FILTER, DEFAULT_SELECTION_FILTER, filterToBody, filterToParams } from './products';

describe('filterToParams', () => {
  it('sends only what is set, repeating a key once per value', () => {
    const params = filterToParams(
      { ...CLEARED_FILTER, q: 'silk', productType: ['Saree', 'Kurta'], status: 'active' },
      { page: 2, pageSize: 20 },
    );
    expect(params.get('q')).toBe('silk');
    expect(params.getAll('productType')).toEqual(['Saree', 'Kurta']);
    expect(params.get('status')).toBe('active');
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe('20');
    expect(params.has('vendor')).toBe(false);
    expect(params.has('enabled')).toBe(false);
  });

  it('serialises the enabled/excluded booleans, including false', () => {
    const params = filterToParams({ ...CLEARED_FILTER, enabled: true, excluded: false });
    expect(params.get('enabled')).toBe('true');
    expect(params.get('excluded')).toBe('false');
  });

  it('omits a blank search', () => {
    expect(filterToParams({ ...CLEARED_FILTER, q: '   ' }).has('q')).toBe(false);
  });
});

describe('filterToBody', () => {
  it('produces the bulk endpoint filter shape and drops empty fields', () => {
    expect(filterToBody({ ...DEFAULT_SELECTION_FILTER, tag: ['silk'], q: ' saree ' })).toEqual({
      status: 'active',
      tag: ['silk'],
      q: 'saree',
    });
  });

  it('is an empty object when nothing is applied', () => {
    expect(filterToBody(CLEARED_FILTER)).toEqual({});
  });
});
