import {
  fillImageCompressionDefaults,
  type ImageCompressionConfig,
  imageCompressionConfigSchema,
} from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { recordAudit } from './audit.js';
import { requireAdmin } from './guard.js';

const KEY = 'config:image-compression';

/**
 * Per-job-type sharp compression settings for finalizeOutput
 * (apps/dispatcher/src/workflow/finalize.ts), read live by the dispatcher on
 * every job finalize — not snapshotted at enqueue like resolution/aspect-ratio
 * config, so a change here applies even to jobs already queued.
 *
 * Kept in its own Redis key rather than folded into config:system so the
 * dispatcher doesn't need SystemConfigBody's full schema, and so this can be
 * gated by the SUPER_ADMIN role alone rather than the broader config.write
 * permission that governs /admin/config — same reasoning as
 * prod-snapshot.routes.ts's requireAdmin(['SUPER_ADMIN']).
 */
export async function adminImageCompressionRoutes(app: FastifyInstance) {
  const SUPER_ADMIN_ONLY = requireAdmin(['SUPER_ADMIN']);

  app.get('/admin/image-compression', { preHandler: SUPER_ADMIN_ONLY }, async () => {
    const raw = await app.redis.get(KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<ImageCompressionConfig>) : undefined;
    return fillImageCompressionDefaults(stored);
  });

  app.patch(
    '/admin/image-compression',
    {
      preHandler: SUPER_ADMIN_ONLY,
      schema: { body: imageCompressionConfigSchema },
    },
    async (req) => {
      const before = fillImageCompressionDefaults(
        JSON.parse((await app.redis.get(KEY)) ?? '{}') as Partial<ImageCompressionConfig>,
      );
      const after = req.body as ImageCompressionConfig;

      // Redis-backed, not Postgres — write the audit record first so a config
      // change can never land without a Team Activity entry for who made it,
      // same ordering as /admin/config's PATCH.
      await app.db.transaction(async (tx) => {
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'image_compression.update',
          resourceType: 'system_config',
          resourceId: 'image_compression',
          before,
          after,
          request: req,
        });
      });
      await app.redis.set(KEY, JSON.stringify(after));
      return after;
    },
  );
}
