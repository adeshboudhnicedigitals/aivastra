import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createLogger } from '@aivastra/logger';
import { type Command, Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ProcessorConfig, processJob } from '../../src/job/processor.js';
import { runConsumer } from '../../src/stream/consumer.js';
import { runInhouseConsumer } from '../../src/stream/inhouse-consumer.js';
import { runVideoConsumer } from '../../src/stream/video-consumer.js';
import { registerWorkers } from '../../src/worker/registry.js';

// Exercise the real consumers and Redis protocol; hold execution at the GPU/HTTP
// boundary so admission and shutdown can be tested without submitting paid work.
vi.mock('../../src/job/processor.js', () => ({ processJob: vi.fn() }));

const GROUP = 'dispatcher-cg';
const GPU_STREAMS = ['jobs:priority', 'jobs:normal', 'jobs:low'] as const;
const LANES = ['gpu', 'video', 'inhouse'] as const;
type Lane = (typeof LANES)[number];
const log = createLogger('stream-wake-claim-test');
log.level = 'silent';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 1_000) {
  const deadline = performance.now() + timeoutMs;
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function isClaim(command: Command, stream?: string) {
  return (
    command.name === 'xreadgroup' &&
    (!stream || command.args.some((arg) => String(arg).endsWith(stream)))
  );
}

function isBlockingRead(command: Command) {
  return (
    (command.name === 'xread' || command.name === 'xreadgroup') && command.args.includes('BLOCK')
  );
}

describe('stream wake-up and claim lifecycle (real Redis)', () => {
  let redis: Redis;
  let reader: Redis;
  let prefix: string;
  let stop: (() => void) | undefined;
  let beforeCommand: ((command: Command) => Promise<void>) | undefined;
  let afterCommand: ((command: Command, result: unknown) => Promise<void>) | undefined;
  let commands: Command[];
  let started: string[];
  let releases: Array<() => void>;

  beforeEach(async () => {
    vi.mocked(processJob).mockReset();
    prefix = `wake-claim:${randomUUID()}:`;
    redis = new Redis('redis://127.0.0.1:6379', {
      keyPrefix: prefix,
      maxRetriesPerRequest: 1,
    });
    await redis.ping();
    beforeCommand = undefined;
    afterCommand = undefined;
    commands = [];
    started = [];
    releases = [];
    stop = undefined;

    const duplicate = redis.duplicate.bind(redis);
    vi.spyOn(redis, 'duplicate').mockImplementation((options) => {
      reader = duplicate({ ...options, connectionName: `${prefix}reader` });
      const send = reader.sendCommand.bind(reader);
      // Gates wrap actual Redis commands/responses, never fabricate them. This
      // places arrivals/stop deterministically in otherwise tiny race windows.
      vi.spyOn(reader, 'sendCommand').mockImplementation(async (command, stream) => {
        // ioredis prefixes XREAD/XREADGROUP keys, but not XGROUP's subcommand
        // key. Keep group creation inside the same per-test namespace.
        if (command.name === 'xgroup' && !String(command.args[1]).startsWith(prefix)) {
          command.args[1] = `${prefix}${command.args[1]}`;
        }
        commands.push(command);
        await beforeCommand?.(command);
        const result = await send(command, stream);
        await afterCommand?.(command, result);
        return result;
      });
      return reader;
    });
    vi.mocked(processJob).mockImplementation(async (_cfg, jobId, _userId, stream, messageId) => {
      started.push(jobId);
      await redis.xack(stream, GROUP, messageId);
    });
  });

  afterEach(async () => {
    stop?.();
    beforeCommand = undefined;
    afterCommand = undefined;
    for (const release of releases) release();
    // Interrupt only for test cleanup, after each test's shutdown assertions.
    // Consumers retain their production quit() behavior.
    reader?.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) {
      await redis.del(...keys.map((key) => key.slice(prefix.length)));
    }
    redis.disconnect();
    vi.restoreAllMocks();
  });

  function gate() {
    const result = deferred();
    releases.push(result.resolve);
    return result;
  }

  async function start(lane: Lane = 'gpu', capacity = 1) {
    await registerWorkers(
      redis,
      Array.from({ length: capacity }, (_, i) => ({
        id: `worker-${i}`,
        url: 'http://unused.invalid',
        apiKey: '',
        allowedJobTypes: lane === 'inhouse' ? (['inhouse'] as const).slice() : [],
      })),
    );
    const cfg = { redis, log } as ProcessorConfig;
    stop =
      lane === 'gpu'
        ? await runConsumer(redis, cfg, log)
        : lane === 'video'
          ? await runVideoConsumer(redis, cfg, log, { concurrency: capacity })
          : await runInhouseConsumer(redis, cfg, log);
  }

  async function pending(stream: string) {
    return (await redis.xpending(stream, GROUP)) as [number, ...unknown[]];
  }

  async function waitForBlockedReader() {
    // CLIENT LIST confirms the command reached Redis and really parked, rather
    // than measuring only a call to a JavaScript wrapper.
    await until(async () => {
      const clients = String(await redis.client('LIST'));
      return clients
        .split('\n')
        .some((line) => line.includes(`name=${prefix}reader `) && /flags=\S*b/.test(line));
    });
  }

  it.each(GPU_STREAMS)('wakes promptly for an idle arrival on %s', async (stream) => {
    await start();
    await waitForBlockedReader();
    const began = performance.now();
    await redis.xadd(stream, '*', 'jobId', 'idle-job');
    await until(() => started.includes('idle-job'), 300);
    expect(performance.now() - began).toBeLessThan(100);
  });

  it.each(GPU_STREAMS)('does not miss %s arriving after its empty claim check', async (stream) => {
    let inserted = false;
    let began = 0;
    afterCommand = async (command, result) => {
      if (!inserted && isClaim(command, stream) && result === null) {
        inserted = true;
        began = performance.now();
        await redis.xadd(stream, '*', 'jobId', 'between-check-and-block');
      }
    };
    await start();
    await until(() => started.includes('between-check-and-block'), 2_500);
    expect(performance.now() - began).toBeLessThan(100);
  });

  it('wake-only reads leave pending entries unchanged and refresh after another consumer claims', async () => {
    let wakeReturns = 0;
    const continueRead = [gate(), gate()];
    afterCommand = async (command) => {
      if (command.name === 'xread') {
        const index = wakeReturns++;
        await continueRead[index]?.promise;
      }
    };
    await start();
    for (let i = 0; i < 2; i++) {
      await waitForBlockedReader();
      const messageId = await redis.xadd('jobs:normal', '*', 'jobId', `other-${i}`);
      await until(() => wakeReturns === i + 1);
      expect((await pending('jobs:normal'))[0]).toBe(0);
      await redis.xreadgroup(
        'GROUP',
        GROUP,
        'other-consumer',
        'COUNT',
        '1',
        'STREAMS',
        'jobs:normal',
        '>',
      );
      expect((await pending('jobs:normal'))[0]).toBe(1);
      await redis.xack('jobs:normal', GROUP, messageId as string);
      continueRead[i]?.resolve();
    }
    await waitForBlockedReader();
    const reads = commands.filter((command) => command.name === 'xread').length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(commands.filter((command) => command.name === 'xread')).toHaveLength(reads);
    expect(started).toEqual([]);
    await redis.xadd('jobs:normal', '*', 'jobId', 'ours');
    await until(() => started.includes('ours'));
  });

  it('claims an existing backlog in priority order without prefetching beyond capacity', async () => {
    const finish = gate();
    vi.mocked(processJob).mockImplementation(async (_cfg, jobId) => {
      started.push(jobId);
      await finish.promise;
    });
    // Groups exist before the backlog, matching an already-running dispatcher.
    for (const stream of GPU_STREAMS) {
      await redis.xgroup('CREATE', `${prefix}${stream}`, GROUP, '0', 'MKSTREAM');
      await redis.xadd(stream, '*', 'jobId', stream);
    }
    await start();
    await until(() => started.length === 1);
    expect(started).toEqual(['jobs:priority']);
    expect((await pending('jobs:priority'))[0]).toBe(1);
    expect((await pending('jobs:normal'))[0]).toBe(0);
    expect((await pending('jobs:low'))[0]).toBe(0);
  });

  it.each(LANES)('%s does not read when capacity is zero, including after stop', async (lane) => {
    await start(lane, 0);
    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(commands.filter((command) => isClaim(command) || command.name === 'xread')).toEqual([]);
    stop?.();
    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(commands.filter((command) => isClaim(command) || command.name === 'xread')).toEqual([]);
    expect(started).toEqual([]);
  });

  it('dispatches concurrently up to capacity, then resumes when one execution finishes', async () => {
    const finish = [gate(), gate(), gate()];
    vi.mocked(processJob).mockImplementation(async (_cfg, jobId, _userId, stream, messageId) => {
      started.push(jobId);
      await finish[Number(jobId)]?.promise;
      await redis.xack(stream, GROUP, messageId);
    });
    await start('gpu', 2);
    await waitForBlockedReader();
    for (let i = 0; i < 3; i++) await redis.xadd('jobs:normal', '*', 'jobId', String(i));
    await until(() => started.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(started).toEqual(['0', '1']);
    expect((await pending('jobs:normal'))[0]).toBe(2);
    finish[0]?.resolve();
    await until(() => started.length === 3);
    expect(started).toEqual(['0', '1', '2']);
  });

  it('stops after a blocked wake read times out without another read or dispatch', async () => {
    await start();
    await waitForBlockedReader();
    const reads = commands.filter(isBlockingRead).length;
    stop?.();
    await until(() => reader.status === 'end', 2_500);
    expect(commands.filter(isBlockingRead)).toHaveLength(reads);
    expect(processJob).not.toHaveBeenCalled();
  });

  it('does not claim an arrival that wakes the GPU reader after stop', async () => {
    await start();
    await waitForBlockedReader();
    const claims = commands.filter((command) => isClaim(command)).length;
    stop?.();
    await redis.xadd('jobs:normal', '*', 'jobId', 'arrival-after-stop');
    await until(() => reader.status === 'end');
    expect(commands.filter((command) => isClaim(command))).toHaveLength(claims);
    expect((await pending('jobs:normal'))[0]).toBe(0);
    expect(processJob).not.toHaveBeenCalled();
  });

  it('does not sleep for a retry when an outstanding read rejects after stop', async () => {
    const entered = gate();
    const resume = gate();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    beforeCommand = async (command) => {
      if (isBlockingRead(command)) {
        entered.resolve();
        await resume.promise;
      }
    };
    await start();
    await entered.promise;
    stop?.();
    await until(() => reader.status === 'end');
    // The real client rejects the delayed command on the now-closed connection.
    resume.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(timers.mock.calls.some(([, delay]) => delay === 1_000)).toBe(false);
    expect(processJob).not.toHaveBeenCalled();
  });

  it('does not claim the next stream if stop arrives during an empty group read', async () => {
    const empty = gate();
    const resume = gate();
    afterCommand = async (command, result) => {
      if (isClaim(command, 'jobs:priority') && result === null) {
        empty.resolve();
        await resume.promise;
      }
    };
    await start();
    await empty.promise;
    await redis.xadd('jobs:normal', '*', 'jobId', 'must-remain-unclaimed');
    stop?.();
    resume.resolve();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(commands.filter((command) => isClaim(command, 'jobs:normal'))).toEqual([]);
    expect((await pending('jobs:normal'))[0]).toBe(0);
    expect(processJob).not.toHaveBeenCalled();
  });

  it.each(
    LANES,
  )('%s leaves a claim returning after stop pending without dispatch', async (lane) => {
    const claimed = gate();
    const resume = gate();
    afterCommand = async (command, result) => {
      if (isClaim(command) && result !== null) {
        claimed.resolve();
        await resume.promise;
      }
    };
    await start(lane);
    const stream = lane === 'gpu' ? 'jobs:priority' : `jobs:${lane}`;
    const messageId = await redis.xadd(stream, '*', 'jobId', 'stop-race', 'retryCount', '3');
    await claimed.promise;
    stop?.();
    resume.resolve();
    await until(() => reader.status === 'end');
    expect(processJob).not.toHaveBeenCalled();
    const entries = (await redis.xpending(stream, GROUP, '-', '+', 10)) as Array<
      [string, ...unknown[]]
    >;
    expect(entries.map(([id]) => id)).toEqual([messageId]);
    expect(await redis.xlen(stream)).toBe(1);
  });
});
