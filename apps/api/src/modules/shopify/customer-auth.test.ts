import Redis from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import {
  mintAccountLinkCode,
  resolveAccountLinkCode,
  signShopifyAccountToken,
  verifyShopifyAccountToken,
} from './customer-auth.js';

describe('shopify customer account link/exchange', () => {
  it('mints a one-time code that resolves to the userId once, then is gone', async () => {
    const redis = new Redis();
    const userId = 'user-123';
    const code = await mintAccountLinkCode(redis as never, userId);
    expect(await resolveAccountLinkCode(redis as never, code)).toBe(userId);
    expect(await resolveAccountLinkCode(redis as never, code)).toBeNull();
  });

  it('signs and verifies a token scoped to the correct storeId', async () => {
    const secret = new TextEncoder().encode('a'.repeat(32));
    const token = await signShopifyAccountToken(secret, 'user-123', 'store-abc');
    const userId = await verifyShopifyAccountToken(secret, token, 'store-abc');
    expect(userId).toBe('user-123');
  });

  it('rejects a token presented against the wrong storeId', async () => {
    const secret = new TextEncoder().encode('a'.repeat(32));
    const token = await signShopifyAccountToken(secret, 'user-123', 'store-abc');
    await expect(verifyShopifyAccountToken(secret, token, 'store-other')).rejects.toThrow();
  });
});
