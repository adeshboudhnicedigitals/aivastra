import { describe, expect, it } from 'vitest';
import {
  activityErrorMessage,
  FleetActivityApiError,
  loadActivity,
  parseActivityList,
} from './live-activity';

const item = {
  id: 'audit:1',
  at: '2026-11-03T10:00:00.000Z',
  source: 'AUDIT',
  action: 'fleet.command.request',
  actor: 'ops@example.com',
  workerId: 'w3',
  summary: 'ops@example.com requested a command on w3',
};
const list = { generatedAt: '2026-11-03T10:01:00.000Z', items: [item], hasMore: false };

describe('parseActivityList', () => {
  it('accepts the API shape, including null actor and worker', () => {
    expect(parseActivityList(list).items).toHaveLength(1);
    expect(
      parseActivityList({ ...list, items: [{ ...item, actor: null, workerId: null }] }).items[0]
        ?.actor,
    ).toBeNull();
  });
  it.each([
    ['not an object', 'x'],
    ['no hasMore', { ...list, hasMore: undefined }],
    ['bad source', { ...list, items: [{ ...item, source: 'NOPE' }] }],
    ['bad date', { ...list, items: [{ ...item, at: 'yesterday' }] }],
    ['missing summary', { ...list, items: [{ ...item, summary: undefined }] }],
    ['items not a list', { ...list, items: {} }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseActivityList(value)).toThrow(FleetActivityApiError);
  });
});

describe('loadActivity', () => {
  const ok = (body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  it('builds the query and sends the bearer token', async () => {
    let url = '';
    let auth = '';
    const fetchImpl = (async (u: string, init: RequestInit) => {
      url = u;
      auth = (init.headers as Record<string, string>).authorization ?? '';
      return new Response(JSON.stringify(list), { status: 200 });
    }) as unknown as typeof fetch;
    await loadActivity(
      'http://api/',
      'tok',
      { source: ['AUDIT', 'COMMAND'], workerId: 'w3', limit: 50, offset: 100 },
      { fetchImpl },
    );
    expect(url).toBe(
      'http://api/admin/fleet/activity?source=AUDIT%2CCOMMAND&workerId=w3&limit=50&offset=100',
    );
    expect(auth).toBe('Bearer tok');
  });
  it('omits empty filters', async () => {
    let url = '';
    const fetchImpl = (async (u: string) => (
      (url = u), new Response(JSON.stringify(list), { status: 200 })
    )) as unknown as typeof fetch;
    await loadActivity('http://api', 't', {}, { fetchImpl });
    expect(url).toBe('http://api/admin/fleet/activity');
  });
  it('maps 403 and an unreachable API to readable messages', async () => {
    const f403 = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await expect(loadActivity('http://api', 't', {}, { fetchImpl: f403 })).rejects.toThrow(
      FleetActivityApiError,
    );
    const err = await loadActivity('http://api', 't', {}, { fetchImpl: f403 }).catch((e) => e);
    expect(activityErrorMessage(err)).toBe('Your role lacks fleet.view.');
    const down = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    expect(
      activityErrorMessage(
        await loadActivity('http://api', 't', {}, { fetchImpl: down }).catch((e) => e),
      ),
    ).toBe('Fleet API unavailable.');
  });
  it('parses a good response', async () => {
    expect((await loadActivity('http://api', 't', {}, { fetchImpl: ok(list) })).hasMore).toBe(
      false,
    );
  });
});
