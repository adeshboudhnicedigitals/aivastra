import { describe, expect, it, vi } from 'vitest';
import {
  FleetAgentApiError,
  loadCommands,
  parseFleetCommand,
  parseFleetCommands,
  parseNotificationSettings,
  requestCommand,
} from './live-agent';
import { splitEmails } from './NotificationSettings';

const cmd = {
  id: '5b3d2c1e-6f1a-4c55-9a1e-0a1b2c3d4e5f',
  workerId: 'worker-3',
  kind: 'clear_queue',
  reason: 'stuck prompts',
  state: 'PENDING',
  requestedAt: '2026-11-02T13:00:00.000Z',
  claimedAt: null,
  finishedAt: null,
  result: null,
};

describe('command parsing', () => {
  it('accepts the API shape and keeps nulls', () => {
    const c = parseFleetCommand(cmd);
    expect(c).toMatchObject({ kind: 'clear_queue', state: 'PENDING', claimedAt: null });
    const list = parseFleetCommands({
      workerId: 'worker-3',
      generatedAt: cmd.requestedAt,
      commands: [cmd],
    });
    expect(list.commands).toHaveLength(1);
  });
  it('rejects an unknown kind or state and any extra field', () => {
    expect(() => parseFleetCommand({ ...cmd, kind: 'wipe_disk' })).toThrow();
    expect(() => parseFleetCommand({ ...cmd, state: 'DONE' })).toThrow();
    expect(() => parseFleetCommand({ ...cmd, extra: 1 })).toThrow();
  });
});

describe('notification settings parsing', () => {
  const ok = {
    generatedAt: cmd.requestedAt,
    emails: ['a@example.com'],
    source: 'dashboard',
    updatedAt: null,
  };
  it('accepts every source and rejects an unknown one', () => {
    for (const source of ['dashboard', 'env', 'none']) {
      expect(parseNotificationSettings({ ...ok, source }).source).toBe(source);
    }
    expect(() => parseNotificationSettings({ ...ok, source: 'file' })).toThrow();
  });
});

describe('splitEmails', () => {
  it('splits on lines, commas, semicolons and spaces and drops blanks', () => {
    expect(splitEmails('a@x.co,\n b@y.co ;; c@z.co  ')).toEqual(['a@x.co', 'b@y.co', 'c@z.co']);
    expect(splitEmails('   ')).toEqual([]);
  });
});

describe('API calls', () => {
  const json = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it("surfaces the server's own reason from the { error: { message } } envelope", async () => {
    const fetchImpl = json(409, {
      error: {
        code: 'COMMAND_NOT_ALLOWED',
        message: 'Drain the worker first: a command must not race a job.',
      },
    });
    await expect(
      requestCommand(
        'http://x',
        't',
        'worker-3',
        'clear_queue',
        'valid reason',
        undefined,
        fetchImpl,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/Drain the worker first/),
    });
  });

  it('still reads a top-level message from older routes', async () => {
    const fetchImpl = json(400, { message: 'Reason must contain 3-300 characters.' });
    await expect(loadCommands('http://x', 't', 'w', undefined, fetchImpl)).rejects.toBeInstanceOf(
      FleetAgentApiError,
    );
    await expect(
      loadCommands('http://x', 't', 'w', undefined, json(400, { message: 'm' })),
    ).rejects.toMatchObject({ message: 'm' });
  });

  it('posts the kind and reason as JSON with the bearer token', async () => {
    const fetchImpl = json(201, cmd);
    await requestCommand(
      'http://x/',
      'tok',
      'worker-3',
      'clear_queue',
      'stuck prompts',
      undefined,
      fetchImpl,
    );
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/admin/fleet/workers/worker-3/commands');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'clear_queue',
      reason: 'stuck prompts',
    });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});
