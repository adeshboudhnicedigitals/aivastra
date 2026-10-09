import { describe, expect, it, vi } from 'vitest';
import { creditsLanded, waitForPayment } from './purchase-wait';

type R = { status: string; paymentStatus: string; n?: number };
const awaiting = (n = 0): R => ({ status: 'ACTIVE', paymentStatus: 'AWAITING', n });
const paid: R = { status: 'ACTIVE', paymentStatus: 'PAID' };

// A fake clock: sleeping advances it, so deadlines are deterministic.
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms;
    }),
  };
}

describe('waitForPayment', () => {
  it('does not poll when the first result is already settled', async () => {
    const c = clock();
    const confirm = vi.fn();
    const out = await waitForPayment(paid, confirm, { pollMs: 10, waitMs: 100, ...c });
    expect(out).toBe(paid);
    expect(confirm).not.toHaveBeenCalled();
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it('settles on the 2nd poll', async () => {
    const c = clock();
    const confirm = vi.fn().mockResolvedValueOnce(awaiting(1)).mockResolvedValueOnce(paid);
    const out = await waitForPayment(awaiting(), confirm, { pollMs: 10, waitMs: 100, ...c });
    expect(out).toBe(paid);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('times out after waitMs and returns the last AWAITING result', async () => {
    const c = clock();
    let n = 0;
    const confirm = vi.fn(async () => awaiting(++n));
    const out = await waitForPayment(awaiting(), confirm, { pollMs: 10, waitMs: 30, ...c });
    expect(out.paymentStatus).toBe('AWAITING');
    expect(out.n).toBe(n);
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it('tolerates a transient rejection and then settles', async () => {
    const c = clock();
    const confirm = vi.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce(paid);
    const out = await waitForPayment(awaiting(), confirm, { pollMs: 10, waitMs: 100, ...c });
    expect(out).toBe(paid);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('stops polling when cancelled', async () => {
    const c = clock();
    let cancelled = false;
    const confirm = vi.fn(async () => {
      cancelled = true;
      return awaiting(1);
    });
    const first = awaiting();
    const out = await waitForPayment(first, confirm, {
      pollMs: 10,
      waitMs: 1000,
      isCancelled: () => cancelled,
      ...c,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(out.paymentStatus).toBe('AWAITING');
  });
});

describe('creditsLanded', () => {
  const r = (paymentStatus: string, creditsGranted: number) => ({ paymentStatus, creditsGranted });

  it('PAID counts regardless of creditsGranted (advisory in hold mode)', () => {
    expect(creditsLanded(r('PAID', 0))).toBe(true);
    expect(creditsLanded(r('PAID', 800))).toBe(true);
  });
  it('NOT_REQUIRED counts only when something was actually granted', () => {
    expect(creditsLanded(r('NOT_REQUIRED', 800))).toBe(true);
    expect(creditsLanded(r('NOT_REQUIRED', 0))).toBe(false);
  });
  it('AWAITING and UNPAID never count', () => {
    expect(creditsLanded(r('AWAITING', 800))).toBe(false);
    expect(creditsLanded(r('UNPAID', 800))).toBe(false);
  });
});
