import { describe, expect, it } from 'vitest';
import { assertPgTimeZone, isInvalidTimeZoneError, parseWindow } from './params.js';

const NOW = new Date('2026-11-06T19:00:00Z'); // already 07 Nov 00:30 in IST

describe('parseWindow', () => {
  it('IST: [from 00:00 IST, to+1 00:00 IST)', () => {
    const w = parseWindow({ from: '2026-10-01', to: '2026-10-03' }, NOW);
    expect(w.tz).toBe('Asia/Kolkata');
    expect(w.startUtc.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-10-03T18:30:00.000Z');
  });

  it('defaults to the 30 local days ending today in tz', () => {
    const w = parseWindow({}, NOW);
    expect(w.to).toBe('2026-11-07');
    expect(w.from).toBe('2026-10-09');
  });

  it('is correct across a DST change (America/New_York, 2026-03-08 and 2026-11-01)', () => {
    const spring = parseWindow(
      { from: '2026-03-08', to: '2026-03-08', tz: 'America/New_York' },
      NOW,
    );
    expect(spring.startUtc.toISOString()).toBe('2026-03-08T05:00:00.000Z'); // EST
    expect(spring.endUtc.toISOString()).toBe('2026-03-09T04:00:00.000Z'); // EDT, 23h day
    const fall = parseWindow({ from: '2026-11-01', to: '2026-11-01', tz: 'America/New_York' }, NOW);
    expect(fall.startUtc.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(fall.endUtc.toISOString()).toBe('2026-11-02T05:00:00.000Z'); // 25h day
  });

  it('handles a zone whose clocks skip midnight (America/Santiago, 2026-09-06)', () => {
    // Chile springs forward at 00:00 local -> 01:00; the day starts at 01:00 local = 04:00Z.
    const w = parseWindow({ from: '2026-09-06', to: '2026-09-06', tz: 'America/Santiago' }, NOW);
    expect(w.startUtc.toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  it('echoes the tz as given (not the ICU alias Asia/Calcutta)', () => {
    expect(parseWindow({ tz: 'Asia/Kolkata' }, NOW).tz).toBe('Asia/Kolkata');
  });

  it.each([
    [{ from: '2025-01-01', to: '2026-01-02' }],
    [{ from: '2026-10-03', to: '2026-10-01' }],
    [{ from: '2026-02-30', to: '2026-03-01' }],
    [{ tz: 'Mars/Olympus' }],
    [{ tz: '+05:30' }],
    [{ from: '2026-11-08' }], // from after the default to (today)
  ])('rejects %j with a 400', (q) => {
    expect(() => parseWindow(q, NOW)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('accepts exactly 366 days', () => {
    expect(() => parseWindow({ from: '2024-01-01', to: '2024-12-31' }, NOW)).not.toThrow();
  });
});

describe('Postgres tz errors map to 400', () => {
  // The shape postgres-js raises for `AT TIME ZONE 'US/Pacific-New'`.
  const pgErr = Object.assign(new Error('time zone "US/Pacific-New" not recognized'), {
    code: '22023',
  });

  it('recognises the invalid_parameter_value code, bare or wrapped as a cause', () => {
    expect(isInvalidTimeZoneError(pgErr)).toBe(true);
    expect(isInvalidTimeZoneError(new Error('wrapped', { cause: pgErr }))).toBe(true);
    expect(isInvalidTimeZoneError(Object.assign(new Error('x'), { code: '57014' }))).toBe(false);
    expect(isInvalidTimeZoneError(null)).toBe(false);
  });

  it('assertPgTimeZone turns that error into a 400 and rethrows anything else', async () => {
    const dbFailing = (err: unknown) =>
      ({ execute: async () => Promise.reject(err) }) as unknown as Parameters<
        typeof assertPgTimeZone
      >[0];
    await expect(assertPgTimeZone(dbFailing(pgErr), 'US/Pacific-New')).rejects.toMatchObject({
      statusCode: 400,
    });
    const other = new Error('connection reset');
    await expect(assertPgTimeZone(dbFailing(other), 'UTC')).rejects.toBe(other);
  });
});
