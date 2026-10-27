import type { FastifyInstance } from 'fastify';
import type { ParsedStatus } from './parse.js';

// Long enough for the poll loop to see a receipt that arrives late; a receipt is
// only ever looked up within seconds of the send.
const STATUS_TTL_SECONDS = 600;
const POLL_MS = 300;

const key = (messageId: string) => `msg:status:whatsapp:${messageId}`;

/** Remembers that a message we sent reached the phone. `sent` and `failed` say nothing about order, so they are not kept. */
export async function recordStatus(app: FastifyInstance, s: ParsedStatus): Promise<void> {
  if (s.status !== 'delivered' && s.status !== 'read') return;
  await app.redis.set(key(s.messageId), s.status, 'EX', STATUS_TTL_SECONDS);
}

/**
 * Waits until `messageId` is reported delivered, at most `timeoutMs`. Resolves
 * either way (true when delivered): the caller proceeds regardless, because a
 * receipt that never comes must not hold a seller's message back.
 */
export async function waitForDelivered(
  app: FastifyInstance,
  messageId: string,
  timeoutMs: number,
): Promise<boolean> {
  // Not a positive number (0 = off, or unset where the env is built by hand): no wait.
  if (!(timeoutMs > 0)) return false;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await app.redis.get(key(messageId))) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))));
  }
}
