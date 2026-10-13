import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { WhatsappClient } from './channels/whatsapp/client.js';
import { runConversation } from './conversation.js';
import { sendMessages, windowOpen } from './send.js';

const R = schema.messagingRuns;
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const LOCK_TTL_SECONDS = 120;

/**
 * Sends whatever finished for one run. Safe to call from the poll loop and from
 * the inbound path at the same time: a per-run Redis lock serialises them, and
 * delivered_job_ids makes every send happen once.
 */
export async function deliverRun(
  app: FastifyInstance,
  wa: WhatsappClient,
  runId: string,
): Promise<void> {
  const lock = `msg:deliver:${runId}`;
  if ((await app.redis.set(lock, '1', 'EX', LOCK_TTL_SECONDS, 'NX')) !== 'OK') return;
  try {
    const [run] = await app.db.select().from(R).where(eq(R.catalogueId, runId));
    if (!run || run.finishedAt) return;
    const [account] = await app.db
      .select()
      .from(schema.messagingAccounts)
      .where(eq(schema.messagingAccounts.id, run.messagingAccountId));
    if (!account) return; // cascade deletes the run with the account; nothing to do

    const jobs = await app.db
      .select({
        id: schema.jobs.id,
        status: schema.jobs.status,
        poseId: schema.jobInputs.poseId,
        resultKey: schema.jobOutputs.resultKey,
      })
      .from(schema.jobs)
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
      .where(inArray(schema.jobs.id, run.jobIds));

    const delivered = new Set(run.deliveredJobIds);
    const pending = jobs.filter((j) => TERMINAL.has(j.status) && !delivered.has(j.id));
    const to = account.externalId.slice(1);
    const optedOut = account.optedOutAt !== null;
    const open = windowOpen(account.lastInboundAt);

    for (const j of pending) {
      if (j.status === 'COMPLETED' && !optedOut) {
        if (!open) {
          // Window closed: one paid template per run, then the images wait for
          // the seller's next message (processInbound → deliverPendingForAccount).
          const template = app.env.WHATSAPP_RESULTS_TEMPLATE;
          if (template && !run.readyNoticeSentAt) {
            await wa.send(to, {
              type: 'template',
              template: { name: template, language: { code: 'en' } },
            });
            await app.db
              .update(R)
              .set({ readyNoticeSentAt: new Date() })
              .where(eq(R.catalogueId, runId));
          }
          return;
        }
        // D38: uploaded, not linked — needs no public URL. finalizeOutput writes
        // png by default but webp when image compression is enabled, so the
        // stored content type (not a literal) goes to Meta.
        const resultKey = j.resultKey ?? keys.output(j.id);
        const bytes = await app.storage.getObject(resultKey);
        const { contentType } = await app.storage.headObject(resultKey);
        const mediaId = await wa.uploadMedia(bytes, contentType ?? 'image/png');
        await wa.send(to, { type: 'image', image: { id: mediaId } });
      }
      // STOP: results stay on the web (/catalogs); the job counts as accounted for.
      await app.db
        .update(R)
        .set({ deliveredJobIds: sql`array_append(${R.deliveredJobIds}, ${j.id}::uuid)` })
        .where(eq(R.catalogueId, runId));
      delivered.add(j.id);
    }

    if (delivered.size < run.jobIds.length) return;
    // Every job is accounted for. The closing buttons need an open window; when
    // closed, the run stays unfinished and closes on the seller's next message.
    if (!optedOut && !open) return;
    await app.db.update(R).set({ finishedAt: new Date() }).where(eq(R.catalogueId, runId));
    if (optedOut) return;
    const failedPoseIds = jobs
      .filter((j) => j.status !== 'COMPLETED' && j.poseId)
      .map((j) => j.poseId as string);
    const out = await runConversation(
      app,
      {
        id: account.id,
        userId: account.userId,
        channel: account.channel,
        externalId: account.externalId,
      },
      { type: 'runFinished', runId, images: run.jobIds.length, failedPoseIds },
      `run:${runId}`,
    );
    await sendMessages(app, wa, to, out);
  } finally {
    await app.redis.del(lock);
  }
}

export async function deliverPendingForAccount(
  app: FastifyInstance,
  wa: WhatsappClient,
  accountId: string,
) {
  const runs = await app.db
    .select({ id: R.catalogueId })
    .from(R)
    .where(and(eq(R.messagingAccountId, accountId), isNull(R.finishedAt)))
    .orderBy(asc(R.createdAt));
  for (const r of runs) await deliverRun(app, wa, r.id);
}

export async function deliveryTick(app: FastifyInstance, wa: WhatsappClient): Promise<void> {
  const runs = await app.db
    .select({ id: R.catalogueId })
    .from(R)
    .where(isNull(R.finishedAt))
    .orderBy(asc(R.createdAt))
    .limit(50);
  for (const r of runs) {
    // One bad run (a missing result object) must not stall everyone else's.
    await deliverRun(app, wa, r.id).catch((err) =>
      app.log.error({ err, runId: r.id }, 'whatsapp delivery failed'),
    );
  }
}
