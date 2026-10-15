import { hostname } from 'node:os';
import type { Logger } from '@aivastra/logger';
import { GARMENT_RECOGNITION_STREAM, GarmentRecognitionRequest } from '@aivastra/types';
import type { Redis } from 'ioredis';
import type { ProcessorConfig } from '../job/processor.js';
import { DISPATCHER_GROUP, type XReadGroupResult } from '../stream/loop.js';
import { type ClassifyService, processRecognitionRequest } from './process.js';

const CONSUMER = `${hostname()}-classify`;
// Recognition is ~1 s of GPU on the few workers that opt in; a handful in
// flight is plenty, and bounds what a burst can claim.
const CONCURRENCY = 4;
const BLOCK_MS = 5_000;

/**
 * The classify lane (spec 8a). Its own stream, connection and cap, like the
 * video lane, so recognition never waits behind try-on jobs and never counts
 * against the GPU consumer's in-flight cap. Messages are acked as soon as they
 * are read and never recovered (D53): the api has stopped waiting long before
 * a retry could answer.
 */
export async function runClassifyConsumer(
  redis: Redis,
  cfg: ProcessorConfig,
  log: Logger,
  opts: { resolveService?: () => Promise<ClassifyService | undefined> } = {},
): Promise<() => void> {
  const laneLog = log.child({ lane: 'classify' });
  // Dedicated connection: XREADGROUP BLOCK parks it (same reason as video-consumer.ts).
  const readConn = redis.duplicate();
  try {
    // '$': a backlog from before this lane existed is all expired requests.
    await readConn.xgroup('CREATE', GARMENT_RECOGNITION_STREAM, DISPATCHER_GROUP, '$', 'MKSTREAM');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }

  let running = true;
  let inFlight = 0;

  async function loop(): Promise<void> {
    while (running) {
      try {
        const room = CONCURRENCY - inFlight;
        if (room <= 0) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        const result = (await readConn.xreadgroup(
          'GROUP',
          DISPATCHER_GROUP,
          CONSUMER,
          'COUNT',
          String(room),
          'BLOCK',
          String(BLOCK_MS),
          'STREAMS',
          GARMENT_RECOGNITION_STREAM,
          '>',
        )) as XReadGroupResult;
        for (const [id, fields] of result?.[0]?.[1] ?? []) {
          await redis.xack(GARMENT_RECOGNITION_STREAM, DISPATCHER_GROUP, id);
          const raw = fields[fields.indexOf('payload') + 1];
          let parsed: ReturnType<typeof GarmentRecognitionRequest.safeParse>;
          try {
            parsed = GarmentRecognitionRequest.safeParse(JSON.parse(raw ?? ''));
          } catch {
            parsed = GarmentRecognitionRequest.safeParse(null);
          }
          if (!parsed.success) {
            laneLog.warn({ streamId: id }, 'invalid garment recognition request — dropped');
            continue;
          }
          inFlight++;
          void (async () =>
            processRecognitionRequest(cfg, parsed.data, {
              service: await opts.resolveService?.(),
            }))()
            .catch((err) => laneLog.error({ err, streamId: id }, 'garment recognition crashed'))
            .finally(() => {
              inFlight--;
            });
        }
      } catch (err) {
        laneLog.error({ err }, 'classify loop error — resuming');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  loop().catch((err) => laneLog.error({ err }, 'classify loop crashed'));
  laneLog.info({ concurrency: CONCURRENCY }, 'classify consumer started');

  return () => {
    running = false;
    void readConn.quit().catch(() => {});
  };
}
