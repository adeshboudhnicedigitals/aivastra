import { describe, expect, it } from 'vitest';
import type { ShopifyMe } from '../types';
import { needsButtonBlock } from './theme';

const me = (settings: Record<string, unknown>) => ({ store: { settings } }) as unknown as ShopifyMe;

describe('needsButtonBlock', () => {
  it('is true for a store that passed onboarding under the old embed rule', () => {
    expect(needsButtonBlock(me({ themeBlockConfirmed: true, themeEmbedConfirmed: true }))).toBe(
      true,
    );
  });
  it('is false once the block has rendered on a storefront', () => {
    expect(needsButtonBlock(me({ themeBlockConfirmed: true, themeButtonBlockSeen: true }))).toBe(
      false,
    );
  });
  it('is false for a store still in onboarding (the wizard handles it)', () => {
    expect(needsButtonBlock(me({}))).toBe(false);
  });
});
