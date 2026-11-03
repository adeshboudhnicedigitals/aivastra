import { describe, expect, it } from 'vitest';
import {
  cancelQueuedJob,
  JobActionError,
  jobActionErrorMessage,
  jobActionFor,
  jobActionNotice,
  parseJobActionResult,
  retryFailedJob,
} from './live-job-actions';

const ID = '5b0c6f56-6a39-4d0e-9d6f-0d9d4f8a2f10';
const reply = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('jobActionFor', () => {
  it('offers cancel for queued, retry for failed, nothing else', () => {
    expect(jobActionFor('QUEUED')).toBe('cancel');
    expect(jobActionFor('FAILED')).toBe('retry');
    for (const s of ['GENERATING', 'PREPROCESSING', 'COMPLETED', 'CANCELLED', 'HELD'])
      expect(jobActionFor(s)).toBeNull();
  });
});

describe('parseJobActionResult', () => {
  it('accepts the API shape', () =>
    expect(
      parseJobActionResult({ ok: true, jobId: ID, status: 'CANCELLED', refunded: true }),
    ).toEqual({ jobId: ID, status: 'CANCELLED', refunded: true }));
  it.each([
    null,
    {},
    { jobId: ID, status: 'DONE', refunded: true },
    { jobId: ID, status: 'QUEUED' },
  ])('rejects %j', (v) => expect(() => parseJobActionResult(v)).toThrow(JobActionError));
});

describe('requests', () => {
  it('posts the reason to the right path', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ ok: true, jobId: ID, status: 'QUEUED', refunded: false }),
      );
    }) as unknown as typeof fetch;
    await retryFailedJob('http://api/', 't', ID, 'worker fixed', f);
    expect(calls[0]?.url).toBe(`http://api/admin/fleet/jobs/${ID}/retry`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ reason: 'worker fixed' });
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer t');
  });
  it('shows the API message for a refusal', async () => {
    await expect(
      cancelQueuedJob(
        'http://api',
        't',
        ID,
        'why not',
        reply(409, {
          error: {
            code: 'JOB_NOT_CANCELLABLE',
            message: 'Only a queued job can be cancelled here.',
          },
        }),
      ),
    ).rejects.toThrow('Only a queued job can be cancelled here.');
  });
  it('maps 401, 403 and network failure to plain messages', async () => {
    const e401 = await retryFailedJob('http://api', 't', ID, 'abc', reply(401, {})).catch((e) => e);
    const e403 = await retryFailedJob('http://api', 't', ID, 'abc', reply(403, {})).catch((e) => e);
    const down = await retryFailedJob('http://api', 't', ID, 'abc', (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch).catch((e) => e);
    expect(jobActionErrorMessage(e401)).toMatch(/Session expired/);
    expect(jobActionErrorMessage(e403)).toMatch(/fleet\.operate/);
    expect(jobActionErrorMessage(down)).toMatch(/unavailable/);
  });
});

describe('jobActionNotice', () => {
  it('says what happened to the credits', () => {
    const r = (refunded: boolean) => ({ jobId: ID, status: 'CANCELLED' as const, refunded });
    expect(jobActionNotice('cancel', r(true))).toMatch(/returned/);
    expect(jobActionNotice('cancel', r(false))).toMatch(/no credits/);
    expect(jobActionNotice('retry', r(true))).toMatch(/does not charge again/);
    expect(jobActionNotice('retry', r(false))).toBe('Job re-queued.');
  });
});
