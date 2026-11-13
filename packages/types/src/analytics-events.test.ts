import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_CLIENT_EVENTS,
  ANALYTICS_DERIVED_EVENTS,
  ANALYTICS_EVENT_PROP_MAX_LEN,
  ANALYTICS_EVENT_PROPS_MAX_KEYS,
  ANALYTICS_SERVER_EVENTS,
  AnalyticsClientEvent,
  AnalyticsHeatmapQuery,
  DEVICE_EVENTS_BATCH_MAX,
  DeviceEventsBatchBody,
} from './analytics-events.js';

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const event = (over: Record<string, unknown> = {}) => ({
  id: ID,
  event: 'item_viewed',
  occurredAt: '2026-11-12T10:15:00+05:30',
  ...over,
});

describe('event catalogue', () => {
  it('keeps the three lists disjoint', () => {
    const all = [
      ...ANALYTICS_SERVER_EVENTS,
      ...ANALYTICS_DERIVED_EVENTS,
      ...ANALYTICS_CLIENT_EVENTS,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  // The trust boundary: a device must not be able to report a fact the business counts.
  it.each([
    ...ANALYTICS_SERVER_EVENTS,
    ...ANALYTICS_DERIVED_EVENTS,
  ])('rejects server/derived name %s from a client', (name) => {
    expect(AnalyticsClientEvent.safeParse(name).success).toBe(false);
    expect(DeviceEventsBatchBody.safeParse({ events: [event({ event: name })] }).success).toBe(
      false,
    );
  });

  it.each([...ANALYTICS_CLIENT_EVENTS])('accepts client name %s', (name) => {
    expect(DeviceEventsBatchBody.safeParse({ events: [event({ event: name })] }).success).toBe(
      true,
    );
  });
});

describe('DeviceEventsBatchBody', () => {
  it('bounds the batch size', () => {
    expect(DeviceEventsBatchBody.safeParse({ events: [] }).success).toBe(false);
    const full = Array.from({ length: DEVICE_EVENTS_BATCH_MAX }, () => event());
    expect(DeviceEventsBatchBody.safeParse({ events: full }).success).toBe(true);
    expect(DeviceEventsBatchBody.safeParse({ events: [...full, event()] }).success).toBe(false);
  });

  it('requires a uuid id and an offset ISO timestamp', () => {
    expect(DeviceEventsBatchBody.safeParse({ events: [event({ id: 'x' })] }).success).toBe(false);
    expect(
      DeviceEventsBatchBody.safeParse({ events: [event({ occurredAt: 'yesterday' })] }).success,
    ).toBe(false);
    expect(
      DeviceEventsBatchBody.safeParse({ events: [event({ occurredAt: '2026-11-12T04:45:00Z' })] })
        .success,
    ).toBe(true);
  });

  it('bounds props: key count, value length, scalar values only', () => {
    const many = Object.fromEntries(
      Array.from({ length: ANALYTICS_EVENT_PROPS_MAX_KEYS + 1 }, (_, i) => [`k${i}`, i]),
    );
    expect(DeviceEventsBatchBody.safeParse({ events: [event({ props: many })] }).success).toBe(
      false,
    );
    const long = 'x'.repeat(ANALYTICS_EVENT_PROP_MAX_LEN + 1);
    expect(
      DeviceEventsBatchBody.safeParse({ events: [event({ props: { a: long } })] }).success,
    ).toBe(false);
    expect(
      DeviceEventsBatchBody.safeParse({ events: [event({ props: { a: { nested: 1 } } })] }).success,
    ).toBe(false);
    expect(
      DeviceEventsBatchBody.safeParse({
        events: [event({ props: { category: 'saree', waitMs: 1200, oos: true } })],
      }).success,
    ).toBe(true);
  });

  it('ignores body-supplied dimensions (they come from the device token)', () => {
    const parsed = DeviceEventsBatchBody.parse({
      events: [event({ merchantId: ID, branchId: ID, deviceId: ID })],
    });
    expect(parsed.events[0]).not.toHaveProperty('merchantId');
    expect(parsed.events[0]).not.toHaveProperty('branchId');
    expect(parsed.events[0]).not.toHaveProperty('deviceId');
  });
});

describe('AnalyticsHeatmapQuery', () => {
  it('defaults metric to sessions and rejects unknown metrics', () => {
    expect(AnalyticsHeatmapQuery.parse({}).metric).toBe('sessions');
    expect(AnalyticsHeatmapQuery.parse({ metric: 'tryons' }).metric).toBe('tryons');
    expect(AnalyticsHeatmapQuery.safeParse({ metric: 'sales' }).success).toBe(false);
  });
});
