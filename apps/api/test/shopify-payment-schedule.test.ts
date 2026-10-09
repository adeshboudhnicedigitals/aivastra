import { describe, expect, it } from 'vitest';
import { nextCheckAt } from '../src/modules/shopify/payment-settlement.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const created = new Date('2026-10-01T00:00:00Z');
const at = (ms: number) => new Date(created.getTime() + ms);

describe('nextCheckAt', () => {
  it('checks every minute for the first 15 minutes', () => {
    expect(nextCheckAt(created, at(14 * MIN))?.getTime()).toBe(at(15 * MIN).getTime());
  });
  it('checks every 15 minutes until 24 hours', () => {
    expect(nextCheckAt(created, at(15 * MIN))?.getTime()).toBe(at(30 * MIN).getTime());
    expect(nextCheckAt(created, at(23 * HOUR))?.getTime()).toBe(at(23 * HOUR + 15 * MIN).getTime());
  });
  it('checks hourly from 24 hours to 7 days', () => {
    expect(nextCheckAt(created, at(DAY))?.getTime()).toBe(at(DAY + HOUR).getTime());
  });
  it('checks daily from 7 to 30 days', () => {
    expect(nextCheckAt(created, at(7 * DAY))?.getTime()).toBe(at(8 * DAY).getTime());
  });
  it('returns null (park) at 30 days', () => {
    expect(nextCheckAt(created, at(30 * DAY))).toBeNull();
  });
});
