import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handoffMessage } from '../../src/stream/handoff.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

// The append-before-ACK handoff against real Redis. Streams are unique per case; the client is
// unprefixed so XGROUP and the script see the same keys.
describe('replacement-message handoff', () => {
  let env: TestEnv;
  let redis: Redis;
  const GROUP = 'dispatcher-cg';
  const run = randomUUID();

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl);
  }, 60_000);
  afterAll(async () => {
    redis.disconnect();
    await env?.cleanup();
  });

  async function pending(name: string, fields: string[], consumer = hostname()) {
    const source = `jobs:handoff-${run}-${name}`;
    await redis.xgroup('CREATE', source, GROUP, '$', 'MKSTREAM');
    const id = (await redis.xadd(source, '*', ...fields)) as string;
    await redis.xreadgroup('GROUP', GROUP, consumer, 'COUNT', 1, 'STREAMS', source, '>');
    return { source, id, target: `${source}:target` };
  }
  const fieldsOf = async (stream: string) => {
    const [entry] = (await redis.xrange(stream, '-', '+')) as Array<[string, string[]]>;
    const out: Record<string, string> = {};
    const f = entry?.[1] ?? [];
    for (let i = 0; i < f.length; i += 2) out[f[i] as string] = f[i + 1] as string;
    return out;
  };
  const pendingCount = async (source: string) =>
    ((await redis.xpending(source, GROUP)) as [number])[0];

  it('appends the replacement with every original field and ACKs the original', async () => {
    const m = await pending('fields', [
      'jobId',
      'j1',
      'userId',
      'u1',
      'retryCount',
      '2',
      'futureField',
      'keep-me',
    ]);
    expect(
      await handoffMessage(redis, {
        sourceStream: m.source,
        targetStream: m.target,
        messageId: m.id,
        overrides: { retryCount: '3' },
      }),
    ).toBe('handed_off');
    expect(await fieldsOf(m.target)).toEqual({
      jobId: 'j1',
      userId: 'u1',
      retryCount: '3',
      futureField: 'keep-me',
    });
    expect(await pendingCount(m.source)).toBe(0);
  });

  it('a message with no userId (merchant/shopify) is not given one, and a missing retryCount is added', async () => {
    const m = await pending('nouser', ['jobId', 'j2']);
    await handoffMessage(redis, {
      sourceStream: m.source,
      targetStream: m.target,
      messageId: m.id,
      overrides: { retryCount: '1' },
    });
    expect(await fieldsOf(m.target)).toEqual({ jobId: 'j2', retryCount: '1' });
  });

  it('repeating a successful call (a lost reply) appends no second replacement', async () => {
    const m = await pending('repeat', ['jobId', 'j3', 'userId', 'u3']);
    const args = { sourceStream: m.source, targetStream: m.target, messageId: m.id };
    expect(await handoffMessage(redis, args)).toBe('handed_off');
    expect(await handoffMessage(redis, args)).toBe('gone');
    expect(await redis.xlen(m.target)).toBe(1);
  });

  it('a real append failure ACKs nothing: the original stays pending for recovery', async () => {
    const m = await pending('fail', ['jobId', 'j4', 'userId', 'u4']);
    await redis.set(m.target, 'not-a-stream');
    await expect(
      handoffMessage(redis, { sourceStream: m.source, targetStream: m.target, messageId: m.id }),
    ).rejects.toThrow();
    expect(await pendingCount(m.source)).toBe(1);
  });

  it('the video and inhouse consumers of this host count as the caller', async () => {
    for (const suffix of ['-video', '-inhouse']) {
      const m = await pending(`lane${suffix}`, ['jobId', 'j9'], `${hostname()}${suffix}`);
      expect(
        await handoffMessage(redis, {
          sourceStream: m.source,
          targetStream: m.target,
          messageId: m.id,
        }),
      ).toBe('handed_off');
      expect(await pendingCount(m.source)).toBe(0);
    }
  });

  it("a delivery with no stream message (the sweeper's) appends from its own fields and ACKs nothing", async () => {
    const m = await pending('synthetic', ['jobId', 'other']);
    const args = { sourceStream: m.source, targetStream: m.target, messageId: '0-0' };
    expect(await handoffMessage(redis, args)).toBe('gone');
    expect(
      await handoffMessage(redis, {
        ...args,
        fields: { jobId: 'j7', userId: 'u7' },
        overrides: { retryCount: '2' },
      }),
    ).toBe('handed_off');
    expect(await fieldsOf(m.target)).toEqual({ jobId: 'j7', userId: 'u7', retryCount: '2' });
    // The unrelated pending entry is untouched.
    expect(await pendingCount(m.source)).toBe(1);
  });

  it('wrong pending owner: recovery already moved it, so nothing is appended or ACKed', async () => {
    const m = await pending('owner', ['jobId', 'j5', 'userId', 'u5']);
    await redis.xclaim(m.source, GROUP, 'recovery-elsewhere', 0, m.id);
    expect(
      await handoffMessage(redis, {
        sourceStream: m.source,
        targetStream: m.target,
        messageId: m.id,
      }),
    ).toBe('not_owner');
    expect(await redis.exists(m.target)).toBe(0);
    expect(await pendingCount(m.source)).toBe(1);
  });

  it('priority promotion: the replacement lands on the target stream, not the source', async () => {
    const m = await pending('promote', ['jobId', 'j6', 'userId', 'u6', 'retryCount', '4']);
    const priority = `${m.source}:priority`;
    await handoffMessage(redis, {
      sourceStream: m.source,
      targetStream: priority,
      messageId: m.id,
      overrides: { retryCount: '5' },
    });
    expect((await fieldsOf(priority)).retryCount).toBe('5');
    expect(await redis.xlen(m.source)).toBe(1);
    expect(await redis.exists(m.target)).toBe(0);
  });
});
