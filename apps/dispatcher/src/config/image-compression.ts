import {
  DEFAULT_IMAGE_COMPRESSION_CONFIG,
  fillImageCompressionDefaults,
  type ImageCompressionJobConfig,
  type JobSource,
} from '@aivastra/types';
import type { Redis } from 'ioredis';

const KEY = 'config:image-compression';

/**
 * Live Redis read, not a snapshot resolved at enqueue time (unlike resolution
 * or aspect-ratio config) — deliberately so an admin's change applies even to
 * a job already sitting in the queue, mirroring how mannequin workflow
 * templates re-resolve fresh at dispatch rather than at enqueue. Plain
 * redis.get per call, no cache: current job volumes don't justify the added
 * complexity, and this keeps "live" literal.
 *
 * The dispatcher has no dependency on apps/api's route code — it just reads
 * the same Redis key GET/PATCH /admin/image-compression writes
 * (apps/api/src/modules/admin/image-compression.routes.ts).
 */
export async function getImageCompressionConfig(
  redis: Redis,
  source: JobSource | string | null,
): Promise<ImageCompressionJobConfig> {
  if (!source || !(source in DEFAULT_IMAGE_COMPRESSION_CONFIG)) {
    // catalog_video (or any future source with no image-compression entry) —
    // PNG passthrough, matching today's uncompressed behavior.
    return { enabled: false, level: 'q90' };
  }
  const raw = await redis.get(KEY);
  const stored = raw ? JSON.parse(raw) : undefined;
  return fillImageCompressionDefaults(stored)[source as JobSource]!;
}
