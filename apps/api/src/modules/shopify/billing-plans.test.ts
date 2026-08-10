import { describe, expect, it } from 'vitest';
import { creditsForPlanName, normalizePlanName, SHOPIFY_PLAN_HANDLES } from './billing-plans.js';

describe('creditsForPlanName', () => {
  it('maps each known plan name to its credit grant', () => {
    expect(creditsForPlanName('starter')).toBe(1925);
    expect(creditsForPlanName('growth')).toBe(5000);
    expect(creditsForPlanName('pro')).toBe(22000);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    // Shopify echoes back the plan's Partner Dashboard display name verbatim,
    // and we do not control how it gets capitalized there.
    expect(creditsForPlanName('Starter')).toBe(1925);
    expect(creditsForPlanName('GROWTH')).toBe(5000);
    expect(creditsForPlanName('  Pro  ')).toBe(22000);
  });

  it('returns null for an unknown name rather than guessing a tier', () => {
    expect(creditsForPlanName('enterprise')).toBeNull();
    expect(creditsForPlanName('Starter Plan')).toBeNull();
    expect(creditsForPlanName('')).toBeNull();
  });

  it('SHOPIFY_PLAN_HANDLES lists exactly the mapped handles', () => {
    expect(SHOPIFY_PLAN_HANDLES).toEqual(['starter', 'growth', 'pro']);
  });
});

describe('normalizePlanName', () => {
  it('trims and lowercases', () => {
    expect(normalizePlanName('  Starter ')).toBe('starter');
    expect(normalizePlanName('Enterprise')).toBe('enterprise');
    expect(normalizePlanName('')).toBe('');
  });
});
