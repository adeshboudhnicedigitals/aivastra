import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fleetAgentKeyCreatedSchema,
  fleetAgentStatusSchema,
  fleetAgentTelemetryViewSchema,
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
    expect(files.length).toBeGreaterThanOrEqual(12);
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
