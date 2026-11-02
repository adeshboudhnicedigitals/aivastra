import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  acknowledgeIncident,
  addIncidentNote,
  FleetIncidentsApiError,
  incidentErrorMessage,
  loadAlertRules,
  loadIncident,
  loadIncidentSummary,
  loadIncidents,
  parseAlertRules,
  parseIncidentDetail,
  parseIncidentList,
  parseIncidentSummary,
  patchAlertRule,
} from './live-incidents';

const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/fleet-contracts',
);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8'));
const response = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('published incident and alert-rule contracts', () => {
  it('parses list and empty-list fixtures while keeping evidence scalar values', () => {
    expect(parseIncidentList(fixture('incidents.list.json')).items).toHaveLength(4);
    const empty = parseIncidentList(fixture('incidents.empty.json'));
    expect(empty.total).toBe(0);
    expect(empty.items).toEqual([]);
    expect(empty.items).toHaveLength(0);
    expect(() =>
      parseIncidentList({ ...(fixture('incidents.empty.json') as object), healthy: true }),
    ).toThrow('Unexpected fleet incidents response');
  });

  it('parses the summary and every incident detail state, including null actors and email', () => {
    expect(parseIncidentSummary(fixture('incidents.summary.json')).open).toBe(2);
    const open = parseIncidentDetail(fixture('incident.detail.open.json'));
    expect(open.events[0]?.actor).toBeNull();
    const acked = parseIncidentDetail(fixture('incident.detail.acked.json'));
    expect(acked.incident.ackedBy?.email).toBe('oncall@example.com');
    const recovered = parseIncidentDetail(fixture('incident.detail.recovered.json'));
    expect(recovered.events.map((event) => event.kind)).toContain('ESCALATED');
    expect(() =>
      parseIncidentDetail({ ...(fixture('incident.detail.open.json') as object), unexpected: 1 }),
    ).toThrow('Unexpected fleet incidents response');
  });

  it('parses an incident raised by the thermal_slowdown rule', () => {
    const open = fixture('incident.detail.open.json') as { incident: Record<string, unknown> };
    const detail = parseIncidentDetail({
      ...open,
      incident: { ...open.incident, ruleKey: 'thermal_slowdown' },
    });
    expect(detail.incident.ruleKey).toBe('thermal_slowdown');
  });

  it('parses all twelve alert rules with bounded parameter metadata', () => {
    const parsed = parseAlertRules(fixture('alert-rules.json'));
    expect(parsed.rules).toHaveLength(12);
    expect(parsed.rules.map((rule) => rule.key)).toContain('thermal_slowdown');
    expect(parsed.rules.find((rule) => rule.key === 'ram_low')?.enabled).toBe(false);
    expect(
      parsed.rules.find((rule) => rule.key === 'gpu_temp_high')?.params.tempAtLeastC,
    ).toMatchObject({
      value: 85,
      default: 88,
      min: 60,
      max: 110,
      unit: '°C',
    });
    expect(() =>
      parseAlertRules({ ...(fixture('alert-rules.json') as object), unexpected: true }),
    ).toThrow('Unexpected fleet incidents response');
  });
});

describe('incident API client', () => {
  it('maps permission failures to the required capability messages', () => {
    expect(incidentErrorMessage(new FleetIncidentsApiError(403, 'forbidden'), 'ack')).toBe(
      'Your role lacks fleet.ack.',
    );
    expect(incidentErrorMessage(new FleetIncidentsApiError(403, 'forbidden'), 'rules')).toBe(
      'Your role lacks fleet.operate (SUPER_ADMIN).',
    );
    expect(incidentErrorMessage(new FleetIncidentsApiError(401, 'expired'), 'view')).toBe(
      'Session expired, sign in again.',
    );
  });

  it('serializes list filters and offset paging', async () => {
    let url = '';
    const fetchImpl: typeof fetch = async (input) => {
      url = String(input);
      return response(200, fixture('incidents.list.json'));
    };
    const page = await loadIncidents(
      'http://api.invalid',
      'token',
      {
        state: ['OPEN', 'ACK'],
        workerId: 'worker 6',
        severity: 'warning',
        ruleKey: 'disk_high',
        limit: 1,
        offset: 1,
      },
      { fetchImpl },
    );
    expect(new URL(url).searchParams.get('state')).toBe('OPEN,ACK');
    expect(new URL(url).searchParams.get('workerId')).toBe('worker 6');
    expect(new URL(url).searchParams.get('offset')).toBe('1');
    expect(page.items).toHaveLength(4);
  });

  it('loads detail and summary using their exact paths', async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      return response(
        200,
        urls.at(-1)?.endsWith('/summary')
          ? fixture('incidents.summary.json')
          : fixture('incident.detail.open.json'),
      );
    };
    await loadIncident('http://api.invalid', 'token', 'incident-1', { fetchImpl });
    await loadIncidentSummary('http://api.invalid', 'token', { fetchImpl });
    expect(urls).toEqual([
      'http://api.invalid/admin/fleet/incidents/incident-1',
      'http://api.invalid/admin/fleet/incidents/summary',
    ]);
  });

  it('refreshes once and retries a summary request after 401', async () => {
    const auth: string[] = [];
    let expired = false;
    const result = await loadIncidentSummary('http://api.invalid', 'old-token', {
      recovery: {
        refreshAccessToken: async () => 'fresh-token',
        onSessionExpired: () => {
          expired = true;
        },
      },
      fetchImpl: async (_input, init) => {
        auth.push(new Headers(init?.headers).get('authorization') ?? '');
        return auth.length === 1 ? response(401) : response(200, fixture('incidents.summary.json'));
      },
    });
    expect(result.open).toBe(2);
    expect(auth).toEqual(['Bearer old-token', 'Bearer fresh-token']);
    expect(expired).toBe(false);
  });

  it('posts acknowledgement and note bodies and patches only supplied rule fields', async () => {
    const requests: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (String(input).endsWith('/ack'))
        return response(200, { ok: true, changed: false, state: 'ACK' });
      if (String(input).includes('/notes')) return response(201, { ok: true, eventId: 4 });
      return response(200, (fixture('alert-rules.json') as { rules: unknown[] }).rules[0]);
    };
    await expect(
      acknowledgeIncident('http://api.invalid', 'token', 'incident-1', 'reviewed', { fetchImpl }),
    ).resolves.toEqual({ ok: true, changed: false, state: 'ACK' });
    await expect(
      addIncidentNote('http://api.invalid', 'token', 'incident-1', 'follow-up note', { fetchImpl }),
    ).resolves.toEqual({ ok: true, eventId: 4 });
    await expect(
      patchAlertRule(
        'http://api.invalid',
        'token',
        'agent_silent',
        { enabled: false },
        { fetchImpl },
      ),
    ).resolves.toMatchObject({ key: 'agent_silent' });
    expect(requests.map(({ method, body }) => [method, body])).toEqual([
      ['POST', { note: 'reviewed' }],
      ['POST', { text: 'follow-up note' }],
      ['PATCH', { enabled: false }],
    ]);
  });

  it.each([400, 403, 404, 409, 500])('preserves the server message for HTTP %i', async (status) => {
    await expect(
      loadAlertRules('http://api.invalid', 'token', {
        fetchImpl: async () => response(status, { message: 'server detail' }),
      }),
    ).rejects.toMatchObject({ status, message: 'server detail' });
  });
});
