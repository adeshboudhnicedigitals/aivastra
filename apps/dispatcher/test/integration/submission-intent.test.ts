import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processRecognitionRequest } from '../../src/classify/process.js';
import { transitionJob } from '../../src/job/state.js';
import { submitRecordedPhase } from '../../src/job/submission.js';
import { registerWorkers } from '../../src/worker/registry.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKFLOW = {
  '1': { class_type: 'LoadImage', inputs: { image: 'garment.jpg' } },
  '3': { class_type: 'AILab_QwenVL', inputs: { custom_prompt: '{{OPTIONS}}' } },
  '4': { class_type: 'PreviewAny', inputs: { source: ['3', 0] } },
};

describe('durable Comfy submission intent', () => {
  let env: TestEnv;
  let redis: Redis;
  const log = createLogger('submission-intent-test');
  const workerId = `intent-${randomUUID()}`;
  let url: string;
  let mode: 'accept' | 'drop' | 'hold' | 'reject' | 'gateway' = 'accept';
  const requests: Array<{
    clientId: string;
    prompt: unknown;
    intent: Record<string, unknown> | null;
  }> = [];
  const held = new Set<ServerResponse>();
  const remote = new Map<string, { clientId: string; prompt: unknown; running: boolean }>();
  const children = new Set<ChildProcess>();

  // The HTTP worker outlives submitters, including child-process crash tests.
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && path === '/prompt') {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const exists = await env.db.execute(sql`select to_regclass('execution_attempts') as name`);
      const rows = exists[0]?.name
        ? await env.db.execute(
            sql`select * from execution_attempts where client_id = ${body.client_id}`,
          )
        : [];
      requests.push({ clientId: body.client_id, prompt: body.prompt, intent: rows[0] ?? null });
      if (mode === 'reject') {
        res.statusCode = 400;
        return res.end(
          JSON.stringify({ error: { type: 'prompt_outputs_failed_validation' }, node_errors: {} }),
        );
      }
      if (mode === 'gateway') {
        res.statusCode = 502;
        return res.end('<html>bad gateway</html>');
      }
      const promptId = `intent-prompt-${requests.length}`;
      remote.set(promptId, {
        clientId: body.client_id,
        prompt: body.prompt,
        running: mode === 'hold',
      });
      if (mode === 'drop') return res.destroy();
      if (mode === 'hold') {
        held.add(res);
        res.on('close', () => held.delete(res));
        return;
      }
      return res.end(JSON.stringify({ prompt_id: promptId }));
    }
    if (path === '/upload/image') return res.end(JSON.stringify({ name: 'uploaded.jpg' }));
    if (path.startsWith('/history/')) {
      const id = path.slice('/history/'.length);
      const entry = remote.get(id);
      return res.end(
        JSON.stringify(
          entry && !entry.running
            ? {
                [id]: {
                  prompt: [0, id, entry.prompt, { client_id: entry.clientId }, []],
                  outputs: { '4': { text: ['kurti'] } },
                  status: { status_str: 'success' },
                },
              }
            : {},
        ),
      );
    }
    if (path === '/prompt') return res.end(JSON.stringify({ exec_info: { queue_remaining: 0 } }));
    if (path === '/queue')
      return res.end(
        JSON.stringify({
          queue_running: [...remote.entries()]
            .filter(([, item]) => item.running)
            .map(([id, item]) => [0, id, item.prompt, { client_id: item.clientId }, []]),
          queue_pending: [],
        }),
      );
    return res.end('{}');
  });

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: `${workerId}:` });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing worker port');
    url = `http://127.0.0.1:${address.port}`;
    await registerWorkers(redis, [
      { id: workerId, url, apiKey: 'fixture', allowedJobTypes: ['classify'] },
    ]);
    await redis.set(`worker:health:${workerId}`, '1');
    await env.storage.putObject(
      'inputs/intent/garment.jpg',
      Buffer.from('fixture-image'),
      'image/jpeg',
    );
    await env.db.insert(schema.workflowTemplates).values({
      slug: `intent-${randomUUID()}`,
      label: 'Intent test',
      jsonContent: WORKFLOW,
      workflowType: 'classify',
      isActive: true,
      tryonPersonNodeId: '1',
      garmentPhasePromptNode: '3',
      tryonOutputNodeId: '4',
      poseNodeId: 'unused',
      upperNodeIds: ['unused'],
      facePhasePromptNode: 'unused',
    });
  }, 60_000);

  beforeEach(() => {
    requests.length = 0;
    remote.clear();
    mode = 'accept';
  });
  afterAll(async () => {
    for (const child of children) child.kill('SIGKILL');
    for (const res of held) res.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    redis?.disconnect();
    await env?.cleanup();
  });

  it('commits SUBMITTING before the classify POST reaches the worker', async () => {
    const requestId = randomUUID();
    const result = await processRecognitionRequest(
      {
        db: env.db,
        redis,
        comfyRedis: redis,
        pub: redis,
        storage: env.storage,
        log,
      },
      {
        requestId,
        garmentKey: 'inputs/intent/garment.jpg',
        options: [{ slug: 'kurti', label: 'Kurti' }],
        expiresAt: Date.now() + 30_000,
      },
      { pollMs: 1 },
    );
    expect(result).toMatchObject({ answer: 'kurti', error: null });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.intent).toMatchObject({
      request_id: requestId,
      job_id: null,
      phase: 'classify',
      state: 'SUBMITTING',
      prompt_id: null,
    });
    expect(requests[0]?.clientId).toBe(`av:classify:${requestId}:1`);
  });

  async function paidJob() {
    const [user] = await env.db
      .insert(schema.users)
      .values({
        email: `intent-${randomUUID()}@test.invalid`,
        passwordHash: 'fixture',
        tier: 'free',
      })
      .returning();
    if (!user) throw new Error('missing fixture user');
    const [job] = await env.db
      .insert(schema.jobs)
      .values({
        userId: user.id,
        status: 'GENERATING',
        creditsCharged: 1,
      })
      .returning();
    if (!job) throw new Error('missing fixture job');
    return job;
  }

  async function send(jobId: string, phase: 'main' | 'mannequin' = 'main') {
    return submitRecordedPhase({
      db: env.db,
      jobId,
      phase,
      worker: { id: workerId, url, apiKey: 'fixture-do-not-persist' },
      prompt: WORKFLOW,
      contract: { outputNodeId: '4', kind: 'fixture' },
      log,
    });
  }

  it('commits the paid intent and send audit together without storing worker credentials', async () => {
    const job = await paidJob();
    const result = await send(job.id);
    expect(requests[0]?.intent).toMatchObject({
      job_id: job.id,
      state: 'SUBMITTING',
      attempt_no: 1,
    });
    expect(requests[0]?.prompt).toEqual(WORKFLOW);
    const rows = await env.db.execute(
      sql`select * from execution_attempts where id = ${result.attemptId}`,
    );
    expect(rows[0]).toMatchObject({
      state: 'ACCEPTED',
      prompt_id: result.promptId,
      client_id: `av:${job.id}:1:main`,
      contract: { version: 1, prompt: WORKFLOW, outputNodeId: '4' },
    });
    expect(JSON.stringify(rows)).not.toContain('fixture-do-not-persist');
    const events = await env.db.execute(
      sql`select payload from job_events where job_id = ${job.id} and event_type = 'COMFY_SUBMIT_STARTED'`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      attemptId: result.attemptId,
      clientId: result.clientId,
    });
  });

  it('serializes concurrent phase identities and never reuses reset job attempts', async () => {
    const job = await paidJob();
    const results = await Promise.all([send(job.id, 'mannequin'), send(job.id), send(job.id)]);
    expect(new Set(results.map((r) => r.clientId)).size).toBe(3);
    const rows = await env.db.execute(
      sql`select attempt_no from execution_attempts where job_id = ${job.id} order by attempt_no`,
    );
    expect(rows.map((r) => r.attempt_no)).toEqual([1, 2, 3]);
    await env.db.execute(sql`update jobs set attempts = 0 where id = ${job.id}`);
    expect((await send(job.id)).clientId).toBe(`av:${job.id}:4:main`);
  });

  it('leaves durable SUBMITTING evidence when acceptance loses its response', async () => {
    const job = await paidJob();
    mode = 'drop';
    await expect(send(job.id)).rejects.toThrow();
    expect(requests).toHaveLength(1);
    const rows = await env.db.execute(
      sql`select state, prompt_id from execution_attempts where job_id = ${job.id}`,
    );
    expect(rows).toEqual([{ state: 'SUBMITTING', prompt_id: null }]);
  });

  it('resolves the attempt as FAILED when ComfyUI definitively rejects the prompt', async () => {
    const job = await paidJob();
    mode = 'reject';
    await expect(send(job.id)).rejects.toThrow('ComfyUI /prompt failed: 400');
    expect(requests).toHaveLength(1);
    const rows = await env.db.execute(
      sql`select state, prompt_id, resolved_at is not null as resolved from execution_attempts where job_id = ${job.id}`,
    );
    expect(rows).toEqual([{ state: 'FAILED', prompt_id: null, resolved: true }]);
  });

  it('keeps SUBMITTING when the failure could have reached the worker (proxy 502)', async () => {
    const job = await paidJob();
    mode = 'gateway';
    await expect(send(job.id)).rejects.toThrow('ComfyUI /prompt failed: 502');
    const rows = await env.db.execute(
      sql`select state, prompt_id, resolved_at is not null as resolved from execution_attempts where job_id = ${job.id}`,
    );
    expect(rows).toEqual([{ state: 'SUBMITTING', prompt_id: null, resolved: false }]);
  });

  it('rolls back the entire intent and sends no POST when the pre-send transaction fails', async () => {
    const job = await paidJob();
    await env.db.execute(
      sql`create function reject_intent_event() returns trigger language plpgsql as $$ begin raise exception 'intent audit unavailable'; end $$`,
    );
    await env.db.execute(
      sql`create trigger reject_intent_event before insert on job_events for each row when (new.event_type = 'COMFY_SUBMIT_STARTED') execute function reject_intent_event()`,
    );
    try {
      await expect(send(job.id)).rejects.toThrow('intent audit unavailable');
      expect(requests).toHaveLength(0);
      const rows = await env.db.execute(
        sql`select id from execution_attempts where job_id = ${job.id}`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      // Only the trigger/function created above in this isolated test database.
      await env.db.execute(sql`drop trigger reject_intent_event on job_events`);
      await env.db.execute(sql`drop function reject_intent_event()`);
    }
  });

  it('returns the accepted prompt and stays SUBMITTING with one POST if receipt persistence fails', async () => {
    const job = await paidJob();
    await env.db.execute(
      sql`create function reject_intent_receipt() returns trigger language plpgsql as $$ begin raise exception 'receipt unavailable'; end $$`,
    );
    await env.db.execute(
      sql`create trigger reject_intent_receipt before update on execution_attempts for each row when (new.state = 'ACCEPTED') execute function reject_intent_receipt()`,
    );
    try {
      const result = await send(job.id);
      expect(result.promptId).toBe('intent-prompt-1');
      expect(requests).toHaveLength(1);
      const rows = await env.db.execute(
        sql`select state, prompt_id from execution_attempts where job_id = ${job.id}`,
      );
      expect(rows).toEqual([{ state: 'SUBMITTING', prompt_id: null }]);
    } finally {
      await env.db.execute(sql`drop trigger reject_intent_receipt on execution_attempts`);
      await env.db.execute(sql`drop function reject_intent_receipt()`);
    }
  });

  it('a failing attempt update cannot roll back a terminal transition', async () => {
    const job = await paidJob();
    await send(job.id);
    await env.db.execute(
      sql`create function reject_outcome() returns trigger language plpgsql as $$ begin raise exception 'outcome unavailable'; end $$`,
    );
    await env.db.execute(
      sql`create trigger reject_outcome before update on execution_attempts for each row when (new.state = 'SUCCEEDED') execute function reject_outcome()`,
    );
    try {
      expect(await transitionJob(env.db, redis, job.id, '', 'COMPLETED', {}, log)).toBe(true);
      const [row] = await env.db.execute(sql`select status from jobs where id = ${job.id}`);
      expect(row?.status).toBe('COMPLETED');
      const events = await env.db.execute(
        sql`select 1 from job_events where job_id = ${job.id} and event_type = 'COMPLETED'`,
      );
      expect(events).toHaveLength(1);
      const [attempt] = await env.db.execute(
        sql`select state from execution_attempts where job_id = ${job.id}`,
      );
      expect(attempt?.state).toBe('ACCEPTED');
    } finally {
      await env.db.execute(sql`drop trigger reject_outcome on execution_attempts`);
      await env.db.execute(sql`drop function reject_outcome()`);
    }
  });

  async function waitFor(check: () => boolean | Promise<boolean>) {
    const until = Date.now() + 10_000;
    while (!(await check())) {
      if (Date.now() >= until) throw new Error('fixture gate timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  function submitInChild(jobId: string) {
    const databaseUrl = new URL(env.databaseUrl);
    databaseUrl.searchParams.set('application_name', 'phase-a-signal-child');
    const child = fork(new URL('../helpers/submission-child.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'],
      silent: true,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        SUBMISSION_TEST_DATABASE_URL: databaseUrl.toString(),
        SUBMISSION_TEST_JOB_ID: jobId,
        SUBMISSION_TEST_WORKER_URL: url,
      },
    });
    children.add(child);
    child.on('exit', () => children.delete(child));
    return child;
  }

  async function stopChild(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL') {
    const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill(signal);
    await ended;
  }

  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    it(`${signal} before intent commit leaves no intent or HTTP request`, async () => {
      const job = await paidJob();
      let release!: () => void;
      let locked!: () => void;
      const acquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locking = env.db.transaction(async (tx) => {
        await tx.execute(sql`select id from jobs where id = ${job.id} for update`);
        locked();
        await barrier;
      });
      await acquired;
      const child = submitInChild(job.id);
      try {
        await waitFor(async () => {
          const rows = await env.db.execute(
            sql`select pid from pg_stat_activity where datname = current_database() and application_name = 'phase-a-signal-child' and wait_event_type = 'Lock'`,
          );
          return rows.length > 0;
        });
        await stopChild(child, signal);
      } finally {
        release();
        await locking;
      }
      expect(requests).toHaveLength(0);
      const rows = await env.db.execute(
        sql`select id from execution_attempts where job_id = ${job.id}`,
      );
      expect(rows).toHaveLength(0);
    });

    it(`${signal} after acceptance preserves intent and worker state across submitter restarts`, async () => {
      const job = await paidJob();
      mode = 'hold';
      const child = submitInChild(job.id);
      await waitFor(() => requests.length === 1);
      await stopChild(child, signal);
      let rows = await env.db.execute(
        sql`select state, prompt_id, client_id from execution_attempts where job_id = ${job.id} order by attempt_no`,
      );
      expect(rows).toEqual([
        { state: 'SUBMITTING', prompt_id: null, client_id: `av:${job.id}:1:main` },
      ]);
      const queue = await fetch(`${url}/queue`).then((r) => r.json());
      expect(queue.queue_running[0][3].client_id).toBe(`av:${job.id}:1:main`);
      const first = remote.get('intent-prompt-1');
      if (!first) throw new Error('worker lost its accepted prompt');
      first.running = false;
      mode = 'accept';
      const replacement = submitInChild(job.id);
      await new Promise<void>((resolve, reject) => {
        replacement.on('message', (message) => {
          if (message && typeof message === 'object' && 'receipt' in message) resolve();
        });
        replacement.on('error', reject);
        replacement.on('exit', () => reject(new Error('replacement exited before receipt')));
      });
      await stopChild(replacement, signal);
      rows = await env.db.execute(
        sql`select state, prompt_id from execution_attempts where job_id = ${job.id} order by attempt_no`,
      );
      expect(rows).toEqual([
        { state: 'SUBMITTING', prompt_id: null },
        { state: 'ACCEPTED', prompt_id: 'intent-prompt-2' },
      ]);
      expect(remote.size).toBe(2);
      const history = await fetch(`${url}/history/intent-prompt-1`).then((r) => r.json());
      expect(history['intent-prompt-1'].prompt[3].client_id).toBe(`av:${job.id}:1:main`);
    });
  }
});
