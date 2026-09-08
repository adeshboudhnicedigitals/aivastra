import { createR2Provider, type StorageProvider } from '@aivastra/storage';
import type { FastifyInstance } from 'fastify';
import { recordAudit } from './audit.js';
import { requireAdmin } from './guard.js';

const MANIFEST_KEY = 'db/manifest.json';
const DUMP_KEY = 'db/latest.dump.age';

interface SnapshotManifest {
  exportedAt?: string;
  excludedTableData?: string[];
  schemaMarker?: string;
  [key: string]: unknown;
}

/**
 * Distribution-bucket provider is deliberately separate from app.storage
 * (the live R2/MinIO bucket) — see docs/local-dev-snapshot-runbook.md. Built
 * lazily per-request rather than decorated on app: DEV_SNAPSHOT_* is
 * optional (unset until the VPS-side one-time bucket setup happens), so
 * there's no safe value to construct a provider with at boot.
 *
 * Deliberately reuses R2_ENDPOINT/R2_SIGN_ENDPOINT/R2_PUBLIC_PRESIGN_BASE/
 * R2_FORCE_PATH_STYLE from the live bucket's config rather than a parallel
 * DEV_SNAPSHOT_ENDPOINT — the distribution bucket lives on the exact same
 * MinIO instance, so these values are already correct for it. This is not
 * optional: `getObject`/`headObject` below are genuine internal
 * server-to-server calls (never cross the public proxy, so R2_ENDPOINT's
 * internal Docker address is correct), but `presignGet`'s *result* is
 * handed to a browser, which must reach it over app.aivastra.com/minio/ — a
 * path-stripping reverse proxy. Signing and fetching a presigned URL through
 * one MUST use different base URLs (sign against the public host with no
 * /minio prefix, since that's the path MinIO validates against after Nginx
 * strips it; fetch through /minio so Nginx knows to route there at all) or
 * every request 403s with SignatureDoesNotMatch — confirmed by hand against
 * the real distribution bucket on 2026-09-03. A single conflated `endpoint`
 * (what the first version of this function used) breaks presigning; it
 * happens to work for direct calls only because those never touch the proxy.
 */
function distributionProvider(app: FastifyInstance): StorageProvider | null {
  const { DEV_SNAPSHOT_BUCKET, DEV_SNAPSHOT_ACCESS_KEY_ID, DEV_SNAPSHOT_SECRET_ACCESS_KEY } =
    app.env;
  if (!DEV_SNAPSHOT_BUCKET || !DEV_SNAPSHOT_ACCESS_KEY_ID || !DEV_SNAPSHOT_SECRET_ACCESS_KEY) {
    return null;
  }
  return createR2Provider({
    endpoint: app.env.R2_ENDPOINT,
    signEndpoint: app.env.R2_SIGN_ENDPOINT,
    presignBaseUrl: app.env.R2_PUBLIC_PRESIGN_BASE,
    accessKeyId: DEV_SNAPSHOT_ACCESS_KEY_ID,
    secretAccessKey: DEV_SNAPSHOT_SECRET_ACCESS_KEY,
    bucket: DEV_SNAPSHOT_BUCKET,
    // Never called (publicUrl() isn't used by either route below) — placeholder
    // to satisfy R2Config's required field.
    publicUrl: `${app.env.R2_PUBLIC_PRESIGN_BASE ?? app.env.R2_ENDPOINT}/${DEV_SNAPSHOT_BUCKET}`,
    forcePathStyle: app.env.R2_FORCE_PATH_STYLE,
  });
}

export async function adminProdSnapshotRoutes(app: FastifyInstance) {
  // requireAdmin(['SUPER_ADMIN']) rather than requirePermission(...): this
  // hands out access to a presigned URL for the full production DB dump, so
  // it deliberately isn't delegable via the role_permissions matrix the way
  // most admin routes are — only the SUPER_ADMIN role itself, full stop.
  const SUPER_ADMIN_ONLY = requireAdmin(['SUPER_ADMIN']);

  // Status is inert metadata (a timestamp, row counts) — not audited, unlike
  // the download-url route below which hands out a capability to the actual
  // production DB dump.
  app.get('/admin/prod-snapshot/status', { preHandler: SUPER_ADMIN_ONLY }, async () => {
    const storage = distributionProvider(app);
    if (!storage) return { configured: false as const };

    let manifest: SnapshotManifest;
    try {
      const buf = await storage.getObject(MANIFEST_KEY);
      manifest = JSON.parse(buf.toString('utf8'));
    } catch {
      return { configured: true as const, found: false as const };
    }
    return { configured: true as const, found: true as const, manifest };
  });

  app.get('/admin/prod-snapshot/download-url', { preHandler: SUPER_ADMIN_ONLY }, async (req) => {
    const storage = distributionProvider(app);
    if (!storage) {
      return { configured: false as const };
    }

    try {
      await storage.headObject(DUMP_KEY);
    } catch {
      return { configured: true as const, found: false as const };
    }

    const { url, expiresIn } = await storage.presignGet(DUMP_KEY, 300);

    await app.db.transaction(async (tx) => {
      await recordAudit(tx, {
        actor: { userId: req.userId, role: req.adminRole ?? '' },
        action: 'prod_snapshot.download_url_issued',
        resourceType: 'prod_snapshot',
        request: req,
      });
    });

    return { configured: true as const, found: true as const, url, expiresIn };
  });
}
