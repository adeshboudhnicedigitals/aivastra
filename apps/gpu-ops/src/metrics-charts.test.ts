import { describe, expect, it } from 'vitest';
import { chartSegments, counterDeltaSeconds, parseFleetMetrics } from './live-agent';

const T0 = Date.parse('2026-11-02T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const range = { start: T0, end: T0 + 60 * 60_000 };

describe('chartSegments', () => {
  it('maps time to x and value to inverted y', () => {
    const [seg] = chartSegments([{ t: at(30), value: 50 }], range, 60, 100);
    expect(seg?.[0]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('breaks the line at a null value instead of drawing zero', () => {
    const segs = chartSegments(
      [
        { t: at(1), value: 10 },
        { t: at(2), value: null },
        { t: at(3), value: 10 },
      ],
      range,
      60,
      100,
    );
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.every((p) => p.y !== 1))).toBe(true);
  });

  it('breaks the line across a hole longer than 2.5 steps', () => {
    const segs = chartSegments(
      [
        { t: at(1), value: 10 },
        { t: at(2), value: 10 },
        { t: at(10), value: 10 },
      ],
      range,
      60,
      100,
    );
    expect(segs.map((s) => s.length)).toEqual([2, 1]);
  });

  it('keeps a line across a hole of up to 2.5 steps', () => {
    const segs = chartSegments(
      [
        { t: at(1), value: 10 },
        { t: at(3), value: 10 },
      ],
      range,
      60,
      100,
    );
    expect(segs).toHaveLength(1);
  });

  it('drops points outside the window and clamps values above the axis', () => {
    const segs = chartSegments(
      [
        { t: at(-5), value: 10 },
        { t: at(5), value: 500 },
      ],
      range,
      60,
      100,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0]?.[0]?.y).toBe(0);
  });
});

describe('parseFleetMetrics', () => {
  const good = {
    workerId: 'worker-3',
    generatedAt: at(60),
    window: '1h',
    stepSeconds: 60,
    earliest: at(0),
    gpus: [
      {
        index: 0,
        points: [
          {
            t: at(1),
            n: 4,
            tempAvg: 60,
            tempMax: 62,
            smClockAvg: 2000,
            smClockMin: 1900,
            powerAvg: null,
            powerMax: null,
            utilAvg: 10,
            vramUsedMax: 100,
            vramTotalMax: 97000,
            hwThermalSlowdownUsMax: 5_000_000,
            swThermalSlowdownUsMax: null,
            swPowerCapUsMax: 0,
          },
        ],
      },
    ],
    host: [],
  };
  it('accepts the API shape and keeps nulls as null', () => {
    const m = parseFleetMetrics(good);
    expect(m.gpus[0]?.points[0]?.powerAvg).toBeNull();
  });
  it('rejects an unknown window and extra fields', () => {
    expect(() => parseFleetMetrics({ ...good, window: '2h' })).toThrow();
    expect(() => parseFleetMetrics({ ...good, extra: 1 })).toThrow();
  });
});

describe('counterDeltaSeconds', () => {
  const pts = (rows: [number, number | null][]) => rows.map(([m, value]) => ({ t: at(m), value }));
  it('turns a cumulative microsecond counter into seconds slowed per interval', () => {
    const out = counterDeltaSeconds(
      pts([
        [0, 1_000_000],
        [1, 3_500_000],
        [2, 3_500_000],
      ]),
      60,
    );
    expect(out.map((p) => p.value)).toEqual([null, 2.5, 0]);
  });
  it('is unknown, not zero, across a hole, a null neighbour or a counter reset', () => {
    expect(
      counterDeltaSeconds(
        pts([
          [0, 1_000_000],
          [5, 9_000_000],
        ]),
        60,
      )[1]?.value,
    ).toBeNull();
    expect(
      counterDeltaSeconds(
        pts([
          [0, null],
          [1, 9_000_000],
        ]),
        60,
      )[1]?.value,
    ).toBeNull();
    expect(
      counterDeltaSeconds(
        pts([
          [0, 9_000_000],
          [1, 100],
        ]),
        60,
      )[1]?.value,
    ).toBeNull();
  });
});
