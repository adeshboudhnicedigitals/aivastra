import { z } from 'zod';
import { JOB_SOURCE, type JobSource } from './job-taxonomy.js';

// Per-job-type compression config for finalizeOutput's sharp re-encode
// (apps/dispatcher/src/workflow/finalize.ts). Every JobSource except
// CATALOG_VIDEO, which is PixVerse's image-to-video lane — no sharp image
// output to compress.
export const IMAGE_COMPRESSION_JOB_SOURCES = Object.values(JOB_SOURCE).filter(
  (s) => s !== JOB_SOURCE.CATALOG_VIDEO,
) as Exclude<JobSource, typeof JOB_SOURCE.CATALOG_VIDEO>[];

export const IMAGE_COMPRESSION_LEVELS = ['lossless', 'q95', 'q90', 'q85', 'q80'] as const;
export type ImageCompressionLevel = (typeof IMAGE_COMPRESSION_LEVELS)[number];
export const imageCompressionLevelSchema = z.enum(IMAGE_COMPRESSION_LEVELS);

export const imageCompressionJobConfigSchema = z.object({
  enabled: z.boolean(),
  level: imageCompressionLevelSchema,
});
export type ImageCompressionJobConfig = z.infer<typeof imageCompressionJobConfigSchema>;

export const imageCompressionConfigSchema = z.record(
  z.enum(IMAGE_COMPRESSION_JOB_SOURCES as [string, ...string[]]),
  imageCompressionJobConfigSchema,
);
export type ImageCompressionConfig = Partial<Record<JobSource, ImageCompressionJobConfig>>;

// Preserves today's real behavior on ship — every one of these was hardcoded
// to sharp(...).webp({ quality: 90 }) before this config existed: tryon,
// api_tryon and regenerate via processTryonDirectJob/processRegenerateJob
// (apps/dispatcher/src/workflow/finalize.ts); wordpress_tryon also routes
// through processTryonDirectJob (job_inputs.params.personKey with no
// merchantId — see apps/api/src/modules/dev/create-job.ts); merchant_tryon
// instead routes through processWidgetJob's merchant/kiosk branch (its own
// separate sharp call in apps/dispatcher/src/job/processor.ts, since a
// merchantId-bearing job never reaches processJob's routing at all). Every
// other job source is currently uncompressed PNG.
const COMPRESSED_BY_DEFAULT: JobSource[] = [
  JOB_SOURCE.TRYON,
  JOB_SOURCE.API_TRYON,
  JOB_SOURCE.MERCHANT_TRYON,
  JOB_SOURCE.WORDPRESS_TRYON,
  JOB_SOURCE.REGENERATE,
];

export const DEFAULT_IMAGE_COMPRESSION_CONFIG: Record<
  Exclude<JobSource, typeof JOB_SOURCE.CATALOG_VIDEO>,
  ImageCompressionJobConfig
> = Object.fromEntries(
  IMAGE_COMPRESSION_JOB_SOURCES.map((source) => [
    source,
    { enabled: COMPRESSED_BY_DEFAULT.includes(source), level: 'q90' as ImageCompressionLevel },
  ]),
) as Record<Exclude<JobSource, typeof JOB_SOURCE.CATALOG_VIDEO>, ImageCompressionJobConfig>;

// Merges a partial stored config (Redis may hold a subset written before a new
// JobSource existed) over the defaults, per-key — same reasoning as
// fillResolutionDefaults in apps/api/src/modules/admin/config.routes.ts.
export function fillImageCompressionDefaults(
  stored: Partial<Record<string, Partial<ImageCompressionJobConfig>>> | undefined,
): ImageCompressionConfig {
  const s = stored ?? {};
  const out: ImageCompressionConfig = {};
  for (const source of IMAGE_COMPRESSION_JOB_SOURCES) {
    const d = DEFAULT_IMAGE_COMPRESSION_CONFIG[source];
    const t = s[source] ?? {};
    out[source] = {
      enabled: typeof t.enabled === 'boolean' ? t.enabled : d.enabled,
      level: t.level && IMAGE_COMPRESSION_LEVELS.includes(t.level) ? t.level : d.level,
    };
  }
  return out;
}
