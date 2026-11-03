import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FLEET_ALERT_RULES,
  fleetActivityListSchema,
  fleetAgentKeyCreatedSchema,
  fleetAgentStatusSchema,
  fleetAgentSummariesSchema,
  fleetAgentTelemetryViewSchema,
  fleetAlertRulesSchema,
  fleetIncidentDetailSchema,
  fleetIncidentListSchema,
  fleetIncidentSummarySchema,
  fleetInventorySchema,
  fleetOperationsSchema,
} from '@aivastra/types';
import { describe, expect, it } from 'vitest';
import { deriveGpuSignals } from '../src/modules/fleet/signals.js';

// docs/fleet-contracts is what the dashboard is built against. If a schema changes, these fail
// until the fixtures are updated too, so UI work never targets a stale shape.
const DIR = join(import.meta.dirname, '../../../docs/fleet-contracts');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const read = (f: string): unknown => JSON.parse(readFileSync(join(DIR, f), 'utf8'));

describe('fleet contract fixtures', () => {
  it('cover every endpoint and state the README lists', () => {
    expect(files.length).toBeGreaterThanOrEqual(22);
  });

  it.each(files.filter((f) => f.startsWith('agent-status.')))('%s matches the schema', (f) => {
    expect(fleetAgentStatusSchema.safeParse(read(f)).success).toBe(true);
  });

  it.each(files.filter((f) => f.startsWith('agent-key-created.')))('%s matches the schema', (f) => {
    expect(fleetAgentKeyCreatedSchema.safeParse(read(f)).success).toBe(true);
  });

  it.each(
    files.filter((f) => f.startsWith('agent-telemetry.')),
  )('%s matches the schema and its signals are what the server would derive', (f) => {
    const parsed = fleetAgentTelemetryViewSchema.parse(read(f));
    expect(parsed.signals).toEqual(parsed.telemetry ? deriveGpuSignals(parsed.telemetry) : []);
  });

  it.each(
    files.filter((f) => f.startsWith('incidents.list') || f.startsWith('incidents.empty')),
  )('%s matches the schema and its total agrees with its items', (f) => {
    const v = fleetIncidentListSchema.parse(read(f));
    expect(v.total).toBeGreaterThanOrEqual(v.items.length);
  });

  it('the activity fixture matches its schema and is newest first', () => {
    const v = fleetActivityListSchema.parse(read('activity.list.json'));
    const ats = v.items.map((i) => i.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(new Set(v.items.map((i) => i.source))).toEqual(
      new Set(['AUDIT', 'INCIDENT', 'COMMAND']),
    );
  });

  it('the inventory fixture matches its schema and is internally consistent', () => {
    const v = fleetInventorySchema.parse(read('inventory.json'));
    const gpu = new Map(v.gpus.map((g) => [g.id, g]));
    expect(v.workers.some((w) => w.hostId === null)).toBe(true);
    for (const w of v.workers.filter((x) => x.gpuId))
      expect(gpu.get(w.gpuId as string)?.hostId).toBe(w.hostId);
    expect(v.workers.filter((w) => w.gpuId === 'gpu7-0').length).toBeGreaterThan(1);
  });

  it('the operations fixture matches its schema and shows every window status in use', () => {
    const v = fleetOperationsSchema.parse(read('operations.json'));
    expect(new Set(v.maintenance.map((w) => w.status))).toEqual(
      new Set(['ACTIVE', 'SCHEDULED', 'CANCELLED']),
    );
    expect(v.reservations.some((r) => r.until === null)).toBe(true);
    expect(v.reservations.some((r) => r.until !== null)).toBe(true);
    for (const w of v.maintenance)
      expect(Date.parse(w.endsAt)).toBeGreaterThan(Date.parse(w.startsAt));
  });

  it('the agent summaries fixture matches its schema', () => {
    const v = fleetAgentSummariesSchema.parse(read('agent-summaries.json'));
    expect(v.workers.some((w) => w.telemetry === null)).toBe(true);
    expect(v.workers.some((w) => w.telemetry !== null)).toBe(true);
  });

  it('the incident summary fixture matches its schema', () => {
    const v = fleetIncidentSummarySchema.parse(read('incidents.summary.json'));
    expect(v.open + v.acknowledged).toBe(
      v.bySeverity.critical + v.bySeverity.warning + v.bySeverity.info,
    );
  });

  it.each(
    files.filter((f) => f.startsWith('incident.detail.')),
  )('%s matches the schema, is chronological, and its events agree with its state', (f) => {
    const { incident, events } = fleetIncidentDetailSchema.parse(read(f));
    const times = events.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(events[0]?.kind).toBe('OPENED');
    expect(events.some((e) => e.kind === 'RECOVERED')).toBe(incident.state === 'RECOVERED');
    expect(events.some((e) => e.kind === 'ACK')).toBe(incident.ackedAt !== null);
  });

  it('the alert-rules fixture lists exactly the rules the server knows, within their bounds', () => {
    const { rules } = fleetAlertRulesSchema.parse(read('alert-rules.json'));
    expect(rules.map((r) => r.key).sort()).toEqual(Object.keys(FLEET_ALERT_RULES).sort());
    for (const r of rules) {
      for (const p of Object.values(r.params)) {
        expect(p.value).toBeGreaterThanOrEqual(p.min);
        expect(p.value).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('stale and fresh fixtures agree with the server staleness rule', () => {
    const generated = (f: string) => fleetAgentTelemetryViewSchema.parse(read(f));
    for (const f of files.filter((x) => x.startsWith('agent-telemetry.'))) {
      const v = generated(f);
      if (!v.telemetry) {
        expect(v.stale).toBe(true);
        continue;
      }
      const age = Date.parse(v.generatedAt) - v.telemetry.observedAt;
      expect(v.stale).toBe(age > 45_000);
    }
  });

  it('never contains a plausible real key', () => {
    for (const f of files) {
      expect(readFileSync(join(DIR, f), 'utf8')).not.toMatch(/fa_[A-Za-z0-9_-]{43}\b/);
    }
  });
});
