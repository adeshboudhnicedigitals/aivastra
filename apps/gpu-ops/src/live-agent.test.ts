import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  agentKeyErrorMessage,
  createAgentKey,
  drainWorker,
  FleetAgentApiError,
  loadAgentStatus,
  loadFleetAgentSummaries,
  parseAgentStatus,
  parseAgentTelemetryView,
  parseCreatedAgentKey,
  parseFleetAgentSummaries,
  revokeAgentKey,
} from './live-agent';

const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/fleet-contracts',
);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8'));
const record = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const response = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('fleet agent contracts', () => {
  it('parses the strict overview summary fixture, preserving missing and null readings', () => {
    const parsed = parseFleetAgentSummaries(fixture('agent-summaries.json'));
    expect(parsed.workers).toHaveLength(2);
    expect(parsed.workers[0]?.telemetry?.diskUsedPctMax).toBe(95.8);
    expect(parsed.workers[1]?.telemetry).toBeNull();
    expect(() =>
      parseFleetAgentSummaries({
        ...(fixture('agent-summaries.json') as object),
        extra: true,
      }),
    ).toThrow('Unexpected fleet agent response');
  });

  it('accepts the optional slowdown counters and error logs, and defaults them for an older agent', () => {
    const base = fixture('agent-telemetry.fresh.json') as {
      telemetry: { gpus: Record<string, unknown>[]; logs?: unknown };
    };
    // Older agent: neither field is present.
    const old = parseAgentTelemetryView(base).telemetry;
    expect(old?.logs).toEqual([]);
    expect(old?.gpus[0]).toMatchObject({
      hwThermalSlowdownUs: null,
      swThermalSlowdownUs: null,
      swPowerCapUs: null,
    });

    const next = structuredClone(base);
    Object.assign(next.telemetry.gpus[0] as object, {
      hwThermalSlowdownUs: 105_332_073,
      swThermalSlowdownUs: null,
      swPowerCapUs: 0,
    });
    next.telemetry.logs = [{ unit: 'comfyui', lines: ['RuntimeError: out of memory'] }];
    const parsed = parseAgentTelemetryView(next).telemetry;
    expect(parsed?.gpus[0]).toMatchObject({
      hwThermalSlowdownUs: 105_332_073,
      swThermalSlowdownUs: null,
      swPowerCapUs: 0,
    });
    expect(parsed?.logs).toEqual([{ unit: 'comfyui', lines: ['RuntimeError: out of memory'] }]);
  });

  it('still rejects unknown GPU fields and a malformed logs block', () => {
    const base = fixture('agent-telemetry.fresh.json') as {
      telemetry: { gpus: Record<string, unknown>[]; logs?: unknown };
    };
    const extra = structuredClone(base);
    Object.assign(extra.telemetry.gpus[0] as object, { surprise: 1 });
    expect(() => parseAgentTelemetryView(extra)).toThrow('Unexpected fleet agent response');
    const badLogs = structuredClone(base);
    badLogs.telemetry.logs = [{ unit: 'comfyui', lines: [42] }];
    expect(() => parseAgentTelemetryView(badLogs)).toThrow('Unexpected fleet agent response');
  });

  it('parses every published agent-status fixture', () => {
    const files = readdirSync(fixtureRoot).filter(
      (name) => name.startsWith('agent-status.') && name.endsWith('.json'),
    );
    expect(files).toHaveLength(4);
    for (const file of files) expect(parseAgentStatus(fixture(file)).workerId).toBeTruthy();
  });

  it('parses every published agent-telemetry fixture, preserving null and empty arrays', () => {
    const files = readdirSync(fixtureRoot).filter(
      (name) => name.startsWith('agent-telemetry.') && name.endsWith('.json'),
    );
    expect(files).toHaveLength(7);
    for (const file of files) expect(parseAgentTelemetryView(fixture(file)).workerId).toBeTruthy();
    const unknown = parseAgentTelemetryView(fixture('agent-telemetry.unknown-fields.json'));
    expect(unknown.telemetry?.gpus[0]?.tempC).toBeNull();
    expect(unknown.telemetry?.host.swapUsedMib).toBeNull();
    expect(parseAgentTelemetryView(fixture('agent-telemetry.none.json')).telemetry).toBeNull();
    expect(parseAgentTelemetryView(fixture('agent-telemetry.no-gpu.json')).telemetry?.gpus).toEqual(
      [],
    );
  });

  it('parses the one-time key response and rejects unexpected structures', () => {
    expect(parseCreatedAgentKey(fixture('agent-key-created.json')).key).toMatch(/^fa_/);
    expect(() => parseAgentStatus({ workerId: 'w', unexpected: true })).toThrow(
      'Unexpected fleet agent response',
    );
    expect(() =>
      parseAgentTelemetryView({
        ...record(fixture('agent-telemetry.none.json')),
        telemetry: { nope: true },
      }),
    ).toThrow('Unexpected fleet agent response');
    expect(() =>
      parseCreatedAgentKey({ ...record(fixture('agent-key-created.json')), key: undefined }),
    ).toThrow('Unexpected fleet agent response');
  });
});

describe('fleet agent API client', () => {
  it('loads overview summaries and retries once after a silent refresh', async () => {
    const sent: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      sent.push(`${String(input)} ${new Headers(init?.headers).get('authorization')}`);
      return sent.length === 1 ? response(401) : response(200, fixture('agent-summaries.json'));
    };
    const result = await loadFleetAgentSummaries('http://api.invalid', 'old', {
      recovery: { refreshAccessToken: async () => 'fresh', onSessionExpired: () => {} },
      fetchImpl,
    });
    expect(result.workers[0]?.workerId).toBe('example-with-data');
    expect(sent).toEqual([
      'http://api.invalid/admin/fleet/agents Bearer old',
      'http://api.invalid/admin/fleet/agents Bearer fresh',
    ]);
  });

  it('pins create-key 403 and TOO_MANY_KEYS 409 messages', () => {
    expect(agentKeyErrorMessage(new FleetAgentApiError(403, 'forbidden'))).toBe(
      'Your role lacks fleet.operate (SUPER_ADMIN only).',
    );
    expect(agentKeyErrorMessage(new FleetAgentApiError(409, 'TOO_MANY_KEYS: maximum is 3'))).toBe(
      'TOO_MANY_KEYS: maximum is 3',
    );
  });

  it('posts drain reason and accepts changed:false', async () => {
    let requestBody = '';
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = String(init?.body ?? '');
      return response(200, { ok: true, changed: false });
    };
    await expect(
      drainWorker(
        'https://api.invalid',
        'access',
        'worker-1',
        'drain',
        'planned maintenance',
        fetchImpl,
      ),
    ).resolves.toEqual({ ok: true, changed: false });
    expect(JSON.parse(requestBody)).toEqual({ reason: 'planned maintenance' });
  });

  it('retries an agent read once with a refreshed access token', async () => {
    const sent: string[] = [];
    const recovery = {
      refreshAccessToken: async () => 'fresh-token',
      onSessionExpired: () => expect.fail('session should remain active'),
    };
    const fetchImpl: typeof fetch = async (_input, init) => {
      sent.push(new Headers(init?.headers).get('authorization') ?? '');
      return sent.length === 1
        ? response(401)
        : response(200, fixture('agent-status.connected.json'));
    };
    await expect(
      loadAgentStatus('https://api.invalid', 'old-token', 'worker-1', recovery, fetchImpl),
    ).resolves.toMatchObject({ workerId: 'tryon-worker-4' });
    expect(sent).toEqual(['Bearer old-token', 'Bearer fresh-token']);
  });

  it('creates and revokes keys without logging or persisting the plaintext', async () => {
    const key = fixture('agent-key-created.json');
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return calls === 1 ? response(201, key) : response(200, { ok: true, changed: false });
    };
    await expect(
      createAgentKey('https://api.invalid', 'access', 'worker-1', 'gpu main', fetchImpl),
    ).resolves.toMatchObject({ key: record(key).key });
    await expect(
      revokeAgentKey('https://api.invalid', 'access', 'key-1', fetchImpl),
    ).resolves.toEqual({ ok: true, changed: false });
  });

  it.each([
    400, 403, 404, 409, 500,
  ])('surfaces HTTP %i without leaking response payloads', async (status) => {
    const fetchImpl: typeof fetch = async () => response(status, { message: 'request rejected' });
    await expect(
      createAgentKey('https://api.invalid', 'access', 'worker-1', undefined, fetchImpl),
    ).rejects.toMatchObject({ status, message: 'request rejected' });
  });

  it('handles network and malformed response failures', async () => {
    const network: typeof fetch = async () => {
      throw new Error('offline');
    };
    await expect(
      revokeAgentKey('https://api.invalid', 'access', 'key-1', network),
    ).rejects.toBeInstanceOf(FleetAgentApiError);
    const malformed: typeof fetch = async () => response(200, { ok: true });
    await expect(
      drainWorker('https://api.invalid', 'access', 'worker-1', 'undrain', 'reason', malformed),
    ).rejects.toThrow('Unexpected fleet agent response');
  });
});
