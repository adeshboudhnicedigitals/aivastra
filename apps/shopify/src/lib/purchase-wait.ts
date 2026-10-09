/**
 * Polls a credit-pack confirm until Shopify has collected payment. Approval only
 * invoices the merchant, so confirm can answer AWAITING for a minute or two.
 * Returns the first result that is no longer AWAITING, or the last one seen when
 * the deadline passes or the caller cancels — the caller decides what an
 * unsettled result means (hand off to the pending banner).
 */
export async function waitForPayment<T extends { status: string; paymentStatus: string }>(
  first: T,
  confirm: () => Promise<T>,
  opts: {
    pollMs: number;
    waitMs: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    isCancelled?: () => boolean;
  },
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const isCancelled = opts.isCancelled ?? (() => false);
  const deadline = now() + opts.waitMs;
  let data = first;
  while (data.paymentStatus === 'AWAITING' && now() < deadline) {
    await sleep(opts.pollMs);
    if (isCancelled()) return data;
    try {
      data = await confirm();
    } catch {
      // Transient — keep polling until the deadline; the banner and the
      // server-side settlement loop cover anything that outlasts it.
    }
    if (isCancelled()) return data;
  }
  return data;
}
