import { describe, expect, it } from 'vitest';
import { accountHealth, relativeTime } from './hq-format';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('relativeTime', () => {
  it('reads naturally with singular and plural', () => {
    expect(relativeTime(null, NOW)).toBe('Never');
    expect(relativeTime(ago(20_000), NOW)).toBe('Just now');
    expect(relativeTime(ago(60_000), NOW)).toBe('1 min ago');
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5 mins ago');
    expect(relativeTime(ago(3 * 3600_000), NOW)).toBe('3 hours ago');
    expect(relativeTime(ago(86400_000), NOW)).toBe('1 day ago');
    expect(relativeTime(ago(10 * 86400_000), NOW)).toBe('10 days ago');
    expect(relativeTime(ago(65 * 86400_000), NOW)).toBe('2 months ago');
  });
});

describe('accountHealth', () => {
  const base = { isActive: true, creditBalance: 1000, burn30d: 300, devices: 4, devicesOffline: 0 };
  it('is ok when funded and online', () => expect(accountHealth(base)).toBe('ok'));
  it('is risk with no credits while tablets run', () =>
    expect(accountHealth({ ...base, creditBalance: 0 })).toBe('risk'));
  it('is risk when every tablet is offline', () =>
    expect(accountHealth({ ...base, devicesOffline: 4 })).toBe('risk'));
  it('watches under a week of burn, or some offline', () => {
    expect(accountHealth({ ...base, creditBalance: 50 })).toBe('watch');
    expect(accountHealth({ ...base, devicesOffline: 1 })).toBe('watch');
  });
  it('ignores inactive accounts', () =>
    expect(accountHealth({ ...base, isActive: false, creditBalance: 0 })).toBe('ok'));
});
