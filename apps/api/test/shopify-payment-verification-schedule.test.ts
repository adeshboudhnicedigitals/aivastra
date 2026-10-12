import { describe, expect, it } from 'vitest';
import {
  decideNoSale,
  NOT_RECEIVED_POLL_MS,
  VERIFY_POLL_MS,
  verifyWindowMs,
} from '../src/modules/shopify/payment-verification.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WINDOW = 180 * MIN;
const created = new Date('2026-10-01T00:00:00Z');
const at = (ms: number) => new Date(created.getTime() + ms);

describe('decideNoSale', () => {
  it('stays UNVERIFIED and re-checks in 15 minutes before the window ends', () => {
    const now = at(20 * MIN);
    const d = decideNoSale(created, now, WINDOW);
    expect(d.status).toBe('UNVERIFIED');
    expect(d.nextCheckAt?.getTime()).toBe(now.getTime() + VERIFY_POLL_MS);
  });

  it('becomes NOT_RECEIVED, re-checked daily, exactly when the window is reached', () => {
    const now = at(WINDOW);
    const d = decideNoSale(created, now, WINDOW);
    expect(d.status).toBe('NOT_RECEIVED');
    expect(d.nextCheckAt?.getTime()).toBe(now.getTime() + NOT_RECEIVED_POLL_MS);
  });

  it('is still UNVERIFIED one millisecond before the window ends', () => {
    expect(decideNoSale(created, at(WINDOW - 1), WINDOW).status).toBe('UNVERIFIED');
  });

  it('keeps re-checking daily until the row is 30 days old', () => {
    const now = at(29 * DAY);
    const d = decideNoSale(created, now, WINDOW);
    expect(d.status).toBe('NOT_RECEIVED');
    expect(d.nextCheckAt?.getTime()).toBe(now.getTime() + DAY);
  });

  it('stops checking (no next time) at 30 days', () => {
    const d = decideNoSale(created, at(30 * DAY), WINDOW);
    expect(d.status).toBe('NOT_RECEIVED');
    expect(d.nextCheckAt).toBeNull();
  });
});

describe('verifyWindowMs', () => {
  it('uses the configured minutes', () => {
    expect(verifyWindowMs({ SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: 240 })).toBe(240 * MIN);
    expect(verifyWindowMs({ SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: 60 })).toBe(60 * MIN);
  });
  it('falls back to 180 minutes when unset or below the minimum', () => {
    expect(verifyWindowMs({})).toBe(180 * MIN);
    expect(verifyWindowMs({ SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: 59 })).toBe(180 * MIN);
  });
});
