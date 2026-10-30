import { describe, expect, it } from 'vitest';
import { checkLoginGate, checkShopperLimits } from './limits.js';

// Only settings.limits is read, so a partial store is enough.
const store = (limits?: object) => ({ settings: { limits } }) as never;

describe('checkLoginGate', () => {
  it('passes when the store does not require login', () => {
    expect(checkLoginGate(store(), null)).toBeNull();
    expect(checkLoginGate(store({}), null)).toBeNull();
    expect(checkLoginGate(store({ loginRequired: false }), null)).toBeNull();
  });

  it('refuses an unverified shopper when login is required', () => {
    expect(checkLoginGate(store({ loginRequired: true }), null)).toMatchObject({
      reason: 'login_required',
    });
  });

  it('passes a verified shopper', () => {
    expect(checkLoginGate(store({ loginRequired: true }), 8123456789)).toBeNull();
  });
});

describe('checkShopperLimits contact gate', () => {
  const shopper = (over: object = {}) =>
    ({ id: 's', clientId: 'c', email: null, phone: null, shopifyCustomerId: 1, ...over }) as never;
  const db = {} as never; // Never reached: the contact refusal returns before any query.

  it('refuses a login-required shopper with no email', async () => {
    const r = await checkShopperLimits(db, store({ loginRequired: true }), shopper());
    expect(r).toMatchObject({ reason: 'contact_required' });
  });
});
