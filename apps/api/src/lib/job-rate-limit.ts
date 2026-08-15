import { schema } from '@aivastra/db';
import { DEFAULT_JOB_RATE_LIMIT_PER_MIN } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from './errors.js';

/**
 * Fixed-window (per-UTC-minute) counter, keyed by merchant — merchants.userId is
 * unique (one merchant per user), so merchantUserId is a valid per-merchant key
 * without needing a separate merchantId lookup. Scoped to job-creation calls only
 * (createDevJobCore, the shared core every /v1/dev/* job route funnels through),
 * distinct from the flat per-key request-volume limiter already on those routes.
 *
 * Fails open on a Redis error, matching server.ts's `skipOnError: true` on the
 * general rate limiter: a Redis blip must not turn into a wall of 500s on a
 * safety-net check.
 */
export async function assertMerchantJobRateLimit(
  app: FastifyInstance,
  merchantUserId: string,
): Promise<void> {
  const [merchant] = await app.db
    .select({ jobRateLimitPerMin: schema.merchants.jobRateLimitPerMin })
    .from(schema.merchants)
    .where(eq(schema.merchants.userId, merchantUserId));
  const limit = merchant?.jobRateLimitPerMin ?? DEFAULT_JOB_RATE_LIMIT_PER_MIN;

  const bucket = Math.floor(Date.now() / 60_000);
  const key = `job-rate:${merchantUserId}:${bucket}`;

  let count: number;
  try {
    count = await app.redis.incr(key);
    if (count === 1) await app.redis.expire(key, 60);
  } catch (err) {
    app.log.warn({ err, merchantUserId }, 'job rate limit check failed open on redis error');
    return;
  }

  if (count > limit) {
    throw new AppError(
      'RATE_LIMITED',
      429,
      'job submission rate limit exceeded, please slow down',
      { limit },
    );
  }
}
