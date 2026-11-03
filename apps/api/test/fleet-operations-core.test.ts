import { describe, expect, it } from 'vitest';
import {
  MAX_WINDOW_MS,
  reservationError,
  reservationExpired,
  silencedWorkers,
  windowError,
  windowStatus,
} from '../src/modules/fleet/operations-core';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const H = 3_600_000;
const row = (startH: number, endH: number, state = 'SCHEDULED', workerId = 'w1') => ({
  workerId,
  state,
  startsAt: new Date(NOW + startH * H),
  endsAt: new Date(NOW + endH * H),
});

describe('windowError', () => {
  it('accepts a future window', () => expect(windowError(NOW + H, NOW + 2 * H, NOW)).toBeNull());
  it('rejects a start in the past or now', () => {
    expect(windowError(NOW - 1, NOW + H, NOW)).toMatch(/future/);
    expect(windowError(NOW, NOW + H, NOW)).toMatch(/future/);
  });
  it('rejects an end that is not after the start', () => {
    expect(windowError(NOW + 2 * H, NOW + H, NOW)).toMatch(/after the start/);
    expect(windowError(NOW + H, NOW + H, NOW)).toMatch(/after the start/);
  });
  it('rejects unparseable times', () =>
    expect(windowError(Number.NaN, NOW + H, NOW)).toMatch(/valid/));
  it('caps the length at 14 days', () => {
    expect(windowError(NOW + H, NOW + H + MAX_WINDOW_MS, NOW)).toBeNull();
    expect(windowError(NOW + H, NOW + H + MAX_WINDOW_MS + 1, NOW)).toMatch(/14 days/);
  });
});

describe('reservationError', () => {
  it('allows no end time', () => expect(reservationError(null, NOW)).toBeNull());
  it('needs a future end', () => {
    expect(reservationError(NOW + H, NOW)).toBeNull();
    expect(reservationError(NOW, NOW)).toMatch(/future/);
    expect(reservationError(Number.NaN, NOW)).toMatch(/future/);
  });
});

describe('windowStatus / silencedWorkers', () => {
  it('derives the status from the clock', () => {
    expect(windowStatus(row(1, 2), NOW)).toBe('SCHEDULED');
    expect(windowStatus(row(-1, 1), NOW)).toBe('ACTIVE');
    expect(windowStatus(row(-2, -1), NOW)).toBe('ENDED');
    expect(windowStatus(row(-1, 1, 'CANCELLED'), NOW)).toBe('CANCELLED');
  });
  it('treats the start as inclusive and the end as exclusive', () => {
    expect(windowStatus(row(0, 1), NOW)).toBe('ACTIVE');
    expect(windowStatus(row(-1, 0), NOW)).toBe('ENDED');
  });
  it('silences only workers with an active, uncancelled window', () => {
    const set = silencedWorkers(
      [
        row(-1, 1, 'SCHEDULED', 'a'),
        row(1, 2, 'SCHEDULED', 'b'),
        row(-2, -1, 'SCHEDULED', 'c'),
        row(-1, 1, 'CANCELLED', 'd'),
      ],
      NOW,
    );
    expect([...set]).toEqual(['a']);
  });
});

describe('reservationExpired', () => {
  it('is false without an end and true once it passes', () => {
    expect(reservationExpired(null, NOW)).toBe(false);
    expect(reservationExpired(new Date(NOW + H), NOW)).toBe(false);
    expect(reservationExpired(new Date(NOW), NOW)).toBe(true);
  });
});
