import { type DB, schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';

/**
 * The message id of a delivery that has no stream message behind it. The stuck-job sweeper
 * hands a job to the processor without one: XACK on this id is a no-op, and a requeue has no
 * original to hand off (it appends the replacement from the job's own fields instead).
 */
export const NO_MESSAGE_ID = '0-0';

/**
 * The fields the API would have put on the job's stream message, for a delivery that has none:
 * `jobId`, plus `userId` whenever the job has one (studio, saree, batch, regenerate and video
 * jobs, and merchant try-ons, whose message carries the merchant's user). Only the Shopify
 * widget sends no `userId`. `type` is not reproduced: the dispatcher never reads it. Payer
 * selection never reads the message's userId either: settlement resolves the payer from the
 * job row; the message's userId only names the SSE channel.
 */
export async function deliveryFields(
  db: DB,
  jobId: string,
  messageId: string,
): Promise<Record<string, string> | undefined> {
  if (messageId !== NO_MESSAGE_ID) return undefined;
  const [job] = await db
    .select({ userId: schema.jobs.userId, merchantId: schema.jobs.merchantId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  if (!job) return { jobId };
  let userId = job.userId;
  if (!userId && job.merchantId) {
    // A merchant job written before the user was stored on the row: the API's message carried
    // the merchant's owning user.
    const [merchant] = await db
      .select({ userId: schema.merchants.userId })
      .from(schema.merchants)
      .where(eq(schema.merchants.id, job.merchantId));
    userId = merchant?.userId ?? null;
  }
  return userId ? { jobId, userId } : { jobId };
}
