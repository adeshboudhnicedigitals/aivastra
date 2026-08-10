import { describe, expect, it } from 'vitest';
import { creditsForPlanHandle, SHOPIFY_PLAN_HANDLES } from './billing-plans.js';

describe('creditsForPlanHandle', () => {
  it('maps each known plan handle to its credit grant', () => {
    expect(creditsForPlanHandle('starter')).toBe(2500);
    expect(creditsForPlanHandle('growth')).toBe(6250);
    expect(creditsForPlanHandle('pro')).toBe(25000);
  });

  it('returns null for an unknown handle', () => {
    expect(creditsForPlanHandle('enterprise')).toBeNull();
    expect(creditsForPlanHandle('')).toBeNull();
  });

  it('SHOPIFY_PLAN_HANDLES lists exactly the mapped handles', () => {
    expect(SHOPIFY_PLAN_HANDLES).toEqual(['starter', 'growth', 'pro']);
  });
});
