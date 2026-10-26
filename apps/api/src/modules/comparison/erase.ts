import { cleanupComparisonReplay, invalidateComparisonsForSources } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import type { FastifyInstance } from 'fastify';

export interface EraseComparisonsResult {
  erased: number;
  incomplete: number;
}

/**
 * Permanently invalidates source jobs, expires every frozen comparison, and
 * removes replay jobs/results. Source input objects are never touched here.
 * An incomplete result keeps the source and comparison pointers retryable.
 */
export async function eraseComparisonsForSourceJobs(
  app: FastifyInstance,
  sourceJobIds: string[],
): Promise<EraseComparisonsResult> {
  let erased = 0;
  let incomplete = 0;
  for (const sourceJobId of [...new Set(sourceJobIds)]) {
    // Collector and dispatch take this same source-row lock before committing.
    const links = await invalidateComparisonsForSources(app.db, [sourceJobId]);

    for (const link of links) {
      if (!link.generalJobId) continue; // Durable EXPIRED row; source FK can now be removed.
      try {
        const result = await cleanupComparisonReplay({
          db: app.db,
          withAdvisoryLock: app.withAdvisoryLock,
          comparisonId: link.id,
          io: {
            deleteObject: (key) => app.storage.deleteObject(key),
            replayOutputKeys: (jobId) => [
              keys.output(jobId, 'png'),
              keys.output(jobId, 'webp'),
              keys.outputThumb(jobId),
            ],
          },
          eligible: (row) => row.sourceJobId === sourceJobId && row.status === 'EXPIRED',
        });
        if (!result.complete) {
          incomplete++;
          continue;
        }
        if (result.deleted) erased++;
      } catch (err) {
        incomplete++;
        app.log.error(
          { err, sourceJobId, comparisonId: link.id, replayJobId: link.generalJobId },
          'comparison erasure could not delete replay outputs; retaining cleanup pointers',
        );
      }
    }
  }
  return { erased, incomplete };
}
