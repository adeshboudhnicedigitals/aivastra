import { fleetActivityListSchema, fleetActivityQuerySchema } from '@aivastra/types';
import { describe, expect, it } from 'vitest';
import {
  auditItem,
  commandItem,
  incidentEventItem,
  mergeActivity,
} from '../src/modules/fleet/activity-core.js';

const d = (s: string) => new Date(s);

describe('fleet activity shaping', () => {
  it('words an audit row and attaches the worker only for worker resources', () => {
    const w = auditItem({
      id: 'a1',
      action: 'fleet.command.request',
      resourceType: 'worker',
      resourceId: 'w3',
      actorEmail: 'ops@example.com',
      createdAt: d('2026-11-03T10:00:00Z'),
    });
    expect(w).toMatchObject({
      id: 'audit:a1',
      source: 'AUDIT',
      workerId: 'w3',
      actor: 'ops@example.com',
    });
    expect(w.summary).toBe('ops@example.com requested a command on w3');
    const s = auditItem({
      id: 'a2',
      action: 'fleet.notification_settings.update',
      resourceType: 'fleet_settings',
      resourceId: 'alert_emails',
      actorEmail: null,
      createdAt: d('2026-11-03T10:01:00Z'),
    });
    expect(s.workerId).toBeNull();
    expect(s.summary).toBe('An admin changed the alert recipients');
  });

  it('an unknown audit action is shown by its code, never hidden', () => {
    const i = auditItem({
      id: 'a3',
      action: 'fleet.something.new',
      resourceType: 'x',
      resourceId: null,
      actorEmail: 'a@b.c',
      createdAt: d('2026-11-03T10:02:00Z'),
    });
    expect(i.summary).toContain('fleet.something.new');
  });

  it('describes incident events and clips long operator notes', () => {
    const base = {
      id: 7,
      at: d('2026-11-03T11:00:00Z'),
      actorEmail: 'ops@example.com',
      ruleKey: 'disk_high',
      workerId: 'w4',
      incidentSummary: 'x',
    };
    expect(incidentEventItem({ ...base, kind: 'ACK', text: null }).summary).toBe(
      'ops@example.com acknowledged disk_high on w4',
    );
    expect(
      incidentEventItem({ ...base, kind: 'OPENED', text: null, actorEmail: null }),
    ).toMatchObject({ actor: null, action: 'OPENED' });
    const long = incidentEventItem({ ...base, kind: 'NOTE', text: 'x'.repeat(1000) });
    expect(long.summary.length).toBeLessThanOrEqual(400);
    expect(incidentEventItem({ ...base, kind: 'WEIRD', text: null }).summary).toBe(
      'WEIRD: disk_high on w4',
    );
  });

  it('lists only finished commands, as outcomes', () => {
    const row = {
      id: 'c1',
      workerId: 'w6',
      kind: 'clear_queue',
      state: 'SUCCEEDED',
      finishedAt: d('2026-11-03T12:00:00Z'),
      result: 'cleared 2',
    };
    expect(commandItem(row)).toMatchObject({
      id: 'command:c1',
      action: 'command.succeeded',
      actor: null,
    });
    expect(commandItem({ ...row, state: 'PENDING', finishedAt: null })).toBeNull();
    expect(commandItem({ ...row, state: 'RUNNING', finishedAt: null })).toBeNull();
    expect(commandItem({ ...row, state: 'FAILED' })?.summary).toContain('failed');
  });
});

describe('merging', () => {
  const item = (id: string, at: string) => ({
    id,
    at,
    source: 'AUDIT' as const,
    action: 'x',
    actor: null,
    workerId: null,
    summary: id,
  });
  const a = [
    item('audit:1', '2026-11-03T10:00:00.000Z'),
    item('audit:2', '2026-11-03T08:00:00.000Z'),
  ];
  const b = [
    item('incident:1', '2026-11-03T09:00:00.000Z'),
    item('incident:2', '2026-11-03T10:00:00.000Z'),
  ];

  it('interleaves newest first with a stable tie-break', () => {
    const { items } = mergeActivity([a, b], 10, 0);
    expect(items.map((i) => i.id)).toEqual(['incident:2', 'audit:1', 'incident:1', 'audit:2']);
  });

  it('pages without repeats or gaps and reports hasMore', () => {
    const p1 = mergeActivity([a, b], 2, 0);
    const p2 = mergeActivity([a, b], 2, 2);
    expect(p1.hasMore).toBe(true);
    expect(p2.hasMore).toBe(false);
    expect([...p1.items, ...p2.items].map((i) => i.id)).toEqual([
      'incident:2',
      'audit:1',
      'incident:1',
      'audit:2',
    ]);
  });

  it('is empty-safe', () => {
    expect(mergeActivity([[], []], 5, 0)).toEqual({ items: [], hasMore: false });
  });
});

describe('query and list schemas', () => {
  it('defaults, splits the source list and bounds the paging', () => {
    expect(fleetActivityQuerySchema.parse({})).toEqual({ source: [], limit: 50, offset: 0 });
    expect(
      fleetActivityQuerySchema.parse({ source: 'AUDIT, COMMAND', limit: '10' }).source,
    ).toEqual(['AUDIT', 'COMMAND']);
    expect(fleetActivityQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(fleetActivityQuerySchema.safeParse({ offset: 5000 }).success).toBe(false);
    expect(fleetActivityQuerySchema.safeParse({ source: 'NOPE' }).success).toBe(false);
  });

  it('the list schema accepts what mergeActivity returns', () => {
    expect(
      fleetActivityListSchema.safeParse({ generatedAt: 'x', items: [], hasMore: false }).success,
    ).toBe(true);
  });
});
