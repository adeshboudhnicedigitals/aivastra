import { describe, expect, it } from 'vitest';
import {
  type BasketMatchTarget,
  type BasketRuleSet,
  matchesCondition,
  resolveBasketFrom,
} from '../src/modules/shopify/funnel-resolution.js';

const SAREE = 'b-saree';
const UPPER = 'b-upper';
const FALLBACK = 'b-fallback';

function baskets(overrides: Partial<Record<string, boolean>> = {}) {
  return new Map([
    [
      SAREE,
      {
        id: SAREE,
        label: 'Saree',
        workflowTemplateId: 'wf-saree',
        workflowTemplateVersion: 3,
        isActive: overrides[SAREE] ?? true,
      },
    ],
    [
      UPPER,
      {
        id: UPPER,
        label: 'Upper',
        workflowTemplateId: 'wf-upper',
        workflowTemplateVersion: 1,
        isActive: overrides[UPPER] ?? true,
      },
    ],
    [
      FALLBACK,
      {
        id: FALLBACK,
        label: 'Default',
        workflowTemplateId: 'wf-default',
        workflowTemplateVersion: null,
        isActive: overrides[FALLBACK] ?? true,
      },
    ],
  ]);
}

function ruleSet(partial: Partial<BasketRuleSet> = {}): BasketRuleSet {
  return {
    storeRules: [],
    globalRules: [],
    baskets: baskets(),
    defaultBasketId: FALLBACK,
    ...partial,
  };
}

function product(partial: Partial<BasketMatchTarget> = {}): BasketMatchTarget {
  return {
    funnelTemplateId: null,
    productType: null,
    tags: null,
    vendor: null,
    collections: null,
    ...partial,
  };
}

describe('matchesCondition', () => {
  it('matches product_type case-insensitively on equals', () => {
    const target = product({ productType: 'Shirt' });
    expect(
      matchesCondition({ field: 'product_type', operator: 'equals', value: 'shirt' }, target),
    ).toBe(true);
    expect(
      matchesCondition({ field: 'product_type', operator: 'equals', value: 'shirtz' }, target),
    ).toBe(false);
  });

  it('trims whitespace around equals comparisons', () => {
    expect(
      matchesCondition(
        { field: 'product_type', operator: 'equals', value: ' shirt ' },
        product({ productType: 'Shirt' }),
      ),
    ).toBe(true);
  });

  it('matches product_type on substring for contains', () => {
    const target = product({ productType: 'Silk Saree' });
    expect(
      matchesCondition({ field: 'product_type', operator: 'contains', value: 'saree' }, target),
    ).toBe(true);
  });

  it('matches vendor case-insensitively', () => {
    expect(
      matchesCondition(
        { field: 'vendor', operator: 'equals', value: 'acme' },
        product({ vendor: 'ACME' }),
      ),
    ).toBe(true);
  });

  it('matches any tag for equals and contains', () => {
    const target = product({ tags: ['Festive', 'Saree'] });
    expect(matchesCondition({ field: 'tags', operator: 'equals', value: 'saree' }, target)).toBe(
      true,
    );
    expect(matchesCondition({ field: 'tags', operator: 'equals', value: 'sar' }, target)).toBe(
      false,
    );
    expect(matchesCondition({ field: 'tags', operator: 'contains', value: 'sar' }, target)).toBe(
      true,
    );
  });

  it('matches any collection', () => {
    const target = product({ collections: ['Festive Sarees'] });
    expect(
      matchesCondition({ field: 'collections', operator: 'contains', value: 'saree' }, target),
    ).toBe(true);
  });

  it('never matches and never throws on null or empty columns', () => {
    const empty = product({ tags: [], collections: [] });
    expect(
      matchesCondition({ field: 'product_type', operator: 'contains', value: 'x' }, empty),
    ).toBe(false);
    expect(matchesCondition({ field: 'vendor', operator: 'equals', value: 'x' }, empty)).toBe(
      false,
    );
    expect(matchesCondition({ field: 'tags', operator: 'contains', value: 'x' }, empty)).toBe(
      false,
    );
    expect(matchesCondition({ field: 'collections', operator: 'equals', value: 'x' }, empty)).toBe(
      false,
    );
  });
});

describe('resolveBasketFrom', () => {
  it('prefers a manual pin over every rule', () => {
    const result = resolveBasketFrom(
      ruleSet({
        globalRules: [
          {
            ruleId: 'r1',
            basketId: UPPER,
            priority: 1,
            conditions: [{ field: 'tags', operator: 'equals', value: 'shirt' }],
          },
        ],
      }),
      product({ funnelTemplateId: SAREE, tags: ['shirt'] }),
    );
    expect(result).toEqual({
      basketId: SAREE,
      label: 'Saree',
      workflowTemplateId: 'wf-saree',
      workflowTemplateVersion: 3,
      source: 'manual',
    });
  });

  it('falls through a pin to an inactive basket rather than dead-ending', () => {
    const result = resolveBasketFrom(
      ruleSet({ baskets: baskets({ [SAREE]: false }) }),
      product({ funnelTemplateId: SAREE }),
    );
    expect(result?.basketId).toBe(FALLBACK);
    expect(result?.source).toBe('default');
  });

  it('resolves a store rule before a global rule of far better priority', () => {
    const result = resolveBasketFrom(
      ruleSet({
        storeRules: [
          {
            ruleId: 'r-store',
            basketId: UPPER,
            priority: 100,
            conditions: [{ field: 'tags', operator: 'equals', value: 'x' }],
          },
        ],
        globalRules: [
          {
            ruleId: 'r-global',
            basketId: SAREE,
            priority: 1,
            conditions: [{ field: 'tags', operator: 'equals', value: 'x' }],
          },
        ],
      }),
      product({ tags: ['x'] }),
    );
    expect(result?.basketId).toBe(UPPER);
    expect(result?.source).toBe('rule');
  });

  it('orders rules within a tier by priority then ruleId', () => {
    const conditions = [{ field: 'tags', operator: 'equals', value: 'x' } as const];
    const result = resolveBasketFrom(
      ruleSet({
        globalRules: [
          { ruleId: 'b', basketId: SAREE, priority: 5, conditions },
          { ruleId: 'a', basketId: UPPER, priority: 5, conditions },
        ],
      }),
      product({ tags: ['x'] }),
    );
    expect(result?.basketId).toBe(UPPER);
  });

  it('skips a rule pointing at an inactive basket', () => {
    const result = resolveBasketFrom(
      ruleSet({
        baskets: baskets({ [SAREE]: false }),
        globalRules: [
          {
            ruleId: 'r1',
            basketId: SAREE,
            priority: 1,
            conditions: [{ field: 'tags', operator: 'equals', value: 'x' }],
          },
          {
            ruleId: 'r2',
            basketId: UPPER,
            priority: 2,
            conditions: [{ field: 'tags', operator: 'equals', value: 'x' }],
          },
        ],
      }),
      product({ tags: ['x'] }),
    );
    expect(result?.basketId).toBe(UPPER);
  });

  it('treats a rule with no conditions as matching nothing', () => {
    const result = resolveBasketFrom(
      ruleSet({ globalRules: [{ ruleId: 'r1', basketId: UPPER, priority: 1, conditions: [] }] }),
      product({ tags: ['anything'] }),
    );
    expect(result?.basketId).toBe(FALLBACK);
  });

  it('ORs conditions within one rule', () => {
    const rules = ruleSet({
      globalRules: [
        {
          ruleId: 'r1',
          basketId: SAREE,
          priority: 1,
          conditions: [
            { field: 'tags', operator: 'equals', value: 'saree' },
            { field: 'product_type', operator: 'equals', value: 'Saree' },
          ],
        },
      ],
    });
    expect(resolveBasketFrom(rules, product({ tags: ['saree'] }))?.basketId).toBe(SAREE);
    expect(resolveBasketFrom(rules, product({ productType: 'saree' }))?.basketId).toBe(SAREE);
    expect(resolveBasketFrom(rules, product({ vendor: 'saree' }))?.basketId).toBe(FALLBACK);
  });

  it('returns the default basket when nothing matches', () => {
    const result = resolveBasketFrom(ruleSet(), product({ tags: ['unmatched'] }));
    expect(result).toEqual({
      basketId: FALLBACK,
      label: 'Default',
      workflowTemplateId: 'wf-default',
      workflowTemplateVersion: null,
      source: 'default',
    });
  });

  it('returns null when there is no default basket', () => {
    expect(resolveBasketFrom(ruleSet({ defaultBasketId: null }), product())).toBeNull();
  });

  it('returns null when the default basket is inactive', () => {
    expect(
      resolveBasketFrom(ruleSet({ baskets: baskets({ [FALLBACK]: false }) }), product()),
    ).toBeNull();
  });
});
