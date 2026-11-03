import { describe, expect, it } from 'vitest';
import {
  FleetOperationsApiError,
  loadOperations,
  operationsErrorMessage,
  parseOperations,
  releaseReservation,
  scheduleMaintenance,
  setReservation,
  windowFormError,
} from './live-operations';

const api = {
  generatedAt: '2026-11-03T10:00:00.000Z',
  maintenance: [
    {
      id: '5b0c6f56-6a39-4d0e-9d6f-0d9d4f8a2f10',
      workerId: 'w1',
      startsAt: '2026-11-03T09:00:00.000Z',
      endsAt: '2026-11-03T11:00:00.000Z',
      owner: 'Srinivas',
      reason: 'driver upgrade',
      status: 'ACTIVE',
      createdAt: '2026-11-02T10:00:00.000Z',
    },
  ],
  reservations: [
    {
      workerId: 'w2',
      owner: 'QA',
      reason: 'lent for tests',
      until: null,
      createdAt: '2026-11-03T08:00:00.000Z',
    },
  ],
};
const ok = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const fail = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('parseOperations', () => {
  it('accepts the API shape', () => {
    const v = parseOperations(api);
    expect(v.maintenance[0]?.status).toBe('ACTIVE');
    expect(v.reservations[0]?.until).toBeNull();
  });
  it.each([
    ['root', null],
    ['generatedAt', { ...api, generatedAt: 'nope' }],
    ['maintenance list', { ...api, maintenance: {} }],
    ['unknown status', { ...api, maintenance: [{ ...api.maintenance[0], status: 'PAUSED' }] }],
    ['bad time', { ...api, maintenance: [{ ...api.maintenance[0], endsAt: 'soon' }] }],
    ['bad until', { ...api, reservations: [{ ...api.reservations[0], until: 5 }] }],
    ['missing owner', { ...api, reservations: [{ ...api.reservations[0], owner: undefined }] }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseOperations(value)).toThrow(FleetOperationsApiError);
  });
});

describe('requests', () => {
  it('loads and parses', async () => {
    const v = await loadOperations('http://api/', 't', { fetchImpl: ok(api) });
    expect(v.reservations).toHaveLength(1);
  });
  it('sends the right method, path and body', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(api), { status: 200 });
    }) as unknown as typeof fetch;
    await scheduleMaintenance(
      'http://api',
      't',
      {
        workerId: 'w1',
        startsAt: '2026-11-04T09:00:00.000Z',
        endsAt: '2026-11-04T10:00:00.000Z',
        owner: 'me',
        reason: 'upgrade',
      },
      { fetchImpl },
    );
    await setReservation(
      'http://api',
      't',
      'w 2',
      { owner: 'QA', until: null, reason: 'lend' },
      { fetchImpl },
    );
    await releaseReservation('http://api', 't', 'w2', 'done', { fetchImpl });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST http://api/admin/fleet/operations/maintenance',
      'PUT http://api/admin/fleet/operations/reservations/w%202',
      'DELETE http://api/admin/fleet/operations/reservations/w2',
    ]);
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual({ reason: 'done' });
  });
  it('surfaces the API error message from the envelope', async () => {
    await expect(
      scheduleMaintenance(
        'http://api',
        't',
        { workerId: 'w1', startsAt: 'x', endsAt: 'y', owner: 'o', reason: 'rrr' },
        {
          fetchImpl: fail(400, {
            error: { code: 'INVALID_WINDOW', message: 'Maintenance must start in the future.' },
          }),
        },
      ),
    ).rejects.toThrow('Maintenance must start in the future.');
  });
  it('maps 401 and 403 to plain messages', async () => {
    const e401 = await loadOperations('http://api', 't', { fetchImpl: fail(401, {}) }).catch(
      (e) => e,
    );
    const e403 = await loadOperations('http://api', 't', { fetchImpl: fail(403, {}) }).catch(
      (e) => e,
    );
    expect(operationsErrorMessage(e401)).toMatch(/Session expired/);
    expect(operationsErrorMessage(e403, 'edit')).toMatch(/fleet\.operate/);
    expect(operationsErrorMessage(e403)).toMatch(/fleet\.view/);
  });
});

describe('windowFormError', () => {
  const now = Date.parse('2026-11-03T10:00:00Z');
  it('mirrors the server rules', () => {
    expect(windowFormError('2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z', now)).toBeNull();
    expect(windowFormError('', '2026-11-03T12:00:00Z', now)).toMatch(/Choose/);
    expect(windowFormError('2026-11-03T09:00:00Z', '2026-11-03T12:00:00Z', now)).toMatch(/future/);
    expect(windowFormError('2026-11-03T12:00:00Z', '2026-11-03T11:00:00Z', now)).toMatch(/after/);
    expect(windowFormError('2026-11-03T11:00:00Z', '2026-12-03T11:00:00Z', now)).toMatch(/14 days/);
  });
});
