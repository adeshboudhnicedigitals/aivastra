/**
 * Seeds a comprehensive spread of audit_logs rows so the Team Activity page
 * (apps/admin-web/src/pages/AuditLogsPage.tsx) has something to show for
 * every action type its describeAction() switch handles, every risk tier
 * (destructive/sensitive/default), every diff shape (added/removed/changed
 * fields), and every filter (action, resource type, actor, date range).
 * Also seeds a few actions the switch does NOT know about (e.g.
 * shopify_stores.delete) to exercise the humanizeActionFallback path.
 *
 * Reuses real admins/users/credit-plans/merchants/workflows already in the
 * local db where cheap (so live resourceLabel joins resolve), and fabricates
 * a resourceId + descriptive before/after snapshot for everything else.
 *
 * Idempotent: the first row's requestId is always set to a fixed marker;
 * re-running checks for that marker first and skips if found (audit_logs is
 * append-only, so there's no upsert to fall back on).
 *
 * Usage:  tsx --env-file=.env scripts/seed-audit-logs.mts
 */
import { randomUUID } from 'node:crypto';
import { createDb, eq, schema } from '@aivastra/db';

const SEED_MARKER = 'req-seed-marker';

const dayMs = 24 * 60 * 60 * 1000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const { db, close } = createDb(databaseUrl);

const IPS: Array<string | null> = ['127.0.0.1', '203.0.113.42', '198.51.100.17', null];
const AGENTS: Array<string | null> = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Firefox/130.0',
  null,
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

interface Template {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
}

async function main() {
  const alreadySeeded = await db
    .select({ id: schema.auditLogs.id })
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.requestId, SEED_MARKER))
    .limit(1);
  if (alreadySeeded.length > 0) {
    console.log('Audit-log seed data already present (marker row found) — skipping.');
    await close();
    return;
  }

  const admins = await db
    .select({
      userId: schema.adminUsers.userId,
      role: schema.adminUsers.role,
    })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.status, 'active'));
  if (admins.length === 0) {
    console.error('No active admin_users found — run `pnpm db:seed` first.');
    process.exit(1);
  }

  const targetUsers = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .limit(15);
  if (targetUsers.length === 0) {
    console.error('No users found — run `pnpm db:seed` first.');
    process.exit(1);
  }
  const u = (i: number) => targetUsers[i % targetUsers.length];

  const plans = await db
    .select({ id: schema.creditPlans.id, slug: schema.creditPlans.slug })
    .from(schema.creditPlans);
  const growthPlan = plans.find((p) => p.slug === 'try-on-growth' || p.slug === 'growth');
  const starterPlan = plans.find((p) => p.slug === 'try-on-starter' || p.slug === 'starter');

  const [merchant] = await db.select({ id: schema.merchants.id }).from(schema.merchants).limit(1);

  const workflows = await db
    .select({
      id: schema.workflowTemplates.id,
      label: schema.workflowTemplates.label,
      workflowType: schema.workflowTemplates.workflowType,
    })
    .from(schema.workflowTemplates)
    .limit(20);
  const regularWorkflows = workflows.filter((w) => !w.workflowType.startsWith('saree'));
  const sareeWorkflow = workflows.find((w) => w.workflowType.startsWith('saree'));

  const templates: Template[] = [
    // --- Credits ---
    {
      action: 'credits.grant',
      resourceType: 'user_credits',
      resourceId: u(0).id,
      after: { amount: 200, reason: 'Loyalty compensation' },
    },
    {
      action: 'credits.deduct',
      resourceType: 'user_credits',
      resourceId: u(1).id,
      after: { amount: 50, reason: 'Chargeback reversal' },
    },

    // --- Users ---
    {
      action: 'users.create',
      resourceType: 'user',
      resourceId: u(2).id,
      after: { email: u(2).email, tier: 'free' },
    },
    {
      action: 'users.update',
      resourceType: 'user',
      resourceId: u(2).id,
      before: { tier: 'free' },
      after: { tier: 'starter' },
    },
    {
      action: 'users.ban',
      resourceType: 'user',
      resourceId: u(3).id,
      before: { isBanned: false },
      after: { isBanned: true, banReason: 'Repeated policy violations' },
    },
    {
      action: 'users.delete',
      resourceType: 'user',
      resourceId: u(4).id,
      before: { email: u(4).email },
    },

    // --- Admin users ---
    {
      action: 'admin_users.approve',
      resourceType: 'admin_user',
      resourceId: u(5).id,
      after: { role: 'SUPPORT' },
    },
    {
      action: 'admin_users.reject',
      resourceType: 'admin_user',
      resourceId: u(6).id,
      after: { reason: 'Not an internal team member' },
    },

    // --- Workflows ---
    ...(regularWorkflows[0]
      ? [
          {
            action: 'workflow.update',
            resourceType: 'workflow',
            resourceId: regularWorkflows[0].id,
            before: { isActive: false },
            after: { isActive: true, label: regularWorkflows[0].label },
          } satisfies Template,
        ]
      : []),
    ...(regularWorkflows[1]
      ? [
          {
            action: 'workflow.reassign',
            resourceType: 'workflow',
            resourceId: regularWorkflows[1].id,
            before: { workflowType: 'regular' },
            after: { workflowType: 'tryon', label: regularWorkflows[1].label },
          } satisfies Template,
        ]
      : []),

    // --- Faces / backgrounds / poses / sample videos / saree styles / garment types ---
    {
      action: 'face.create',
      resourceType: 'face',
      resourceId: randomUUID(),
      after: { label: 'Studio Face 12' },
    },
    {
      action: 'face.update',
      resourceType: 'face',
      resourceId: randomUUID(),
      before: { label: 'Studio Face 4' },
      after: { label: 'Studio Face 4 (retouched)' },
    },
    {
      action: 'background.create',
      resourceType: 'background',
      resourceId: randomUUID(),
      after: { label: 'Marble Studio Backdrop' },
    },
    {
      action: 'background.update',
      resourceType: 'background',
      resourceId: randomUUID(),
      before: { label: 'Beach Sunset' },
      after: { label: 'Beach Sunset (HDR)' },
    },
    { action: 'background.bulk_update', resourceType: 'background', after: { updated: 14 } },
    {
      action: 'pose.create',
      resourceType: 'pose',
      resourceId: randomUUID(),
      after: { label: 'Three-Quarter Standing' },
    },
    {
      action: 'pose.update',
      resourceType: 'pose',
      resourceId: randomUUID(),
      before: { label: 'Side Profile' },
      after: { label: 'Side Profile (v2)' },
    },
    {
      action: 'pose.bulk_workflow_update',
      resourceType: 'pose',
      after: { updated: 9, workflowLabel: regularWorkflows[0]?.label ?? 'kurthi' },
    },
    { action: 'pose.bulk_rename', resourceType: 'pose', after: { updated: 6 } },
    {
      action: 'sample_video.create',
      resourceType: 'sample_video',
      resourceId: randomUUID(),
      after: { title: 'Saree Drape Demo' },
    },
    {
      action: 'sample_video.update',
      resourceType: 'sample_video',
      resourceId: randomUUID(),
      before: { title: 'Kurthi Reel' },
      after: { title: 'Kurthi Reel (final)' },
    },
    {
      action: 'sample_video.delete',
      resourceType: 'sample_video',
      resourceId: randomUUID(),
      before: { title: 'Old Promo Clip' },
    },
    {
      action: 'saree_style.create',
      resourceType: 'saree_style',
      resourceId: randomUUID(),
      after: { label: 'Kanjeevaram Classic' },
    },
    {
      action: 'saree_style.update',
      resourceType: 'saree_style',
      resourceId: randomUUID(),
      before: { label: 'Banarasi' },
      after: { label: 'Banarasi Silk' },
    },
    {
      action: 'garment_type.create',
      resourceType: 'garment_type',
      resourceId: randomUUID(),
      after: { label: 'Lehenga Choli' },
    },
    {
      action: 'garment_type.delete',
      resourceType: 'garment_type',
      resourceId: randomUUID(),
      before: { label: 'Deprecated Anarkali' },
    },

    // --- Catalog ---
    {
      action: 'catalog_item.create',
      resourceType: 'catalog_item',
      resourceId: randomUUID(),
      after: { label: 'Tan Block Heels', type: 'shoe' },
    },
    {
      action: 'catalog_item.update',
      resourceType: 'catalog_item',
      resourceId: randomUUID(),
      before: { label: 'Black Loafers' },
      after: { label: 'Black Leather Loafers' },
    },
    { action: 'catalog_item.bulk_update', resourceType: 'catalog_item', after: { updated: 42 } },
    {
      action: 'catalog_category.create',
      resourceType: 'catalog_category',
      resourceId: randomUUID(),
      after: { label: 'Formal Footwear' },
    },
    {
      action: 'catalog_category.update',
      resourceType: 'catalog_category',
      resourceId: randomUUID(),
      before: { label: 'Footwear' },
      after: { label: 'Footwear & Accessories' },
    },
    {
      action: 'catalog_category.delete',
      resourceType: 'catalog_category',
      resourceId: randomUUID(),
      before: { label: 'Discontinued Line' },
    },
    {
      action: 'catalogue_template.create',
      resourceType: 'catalogue_template',
      resourceId: randomUUID(),
      after: { label: 'Festive Collection 2026' },
    },
    {
      action: 'catalogue_template.update',
      resourceType: 'catalogue_template',
      resourceId: randomUUID(),
      before: { label: 'Summer Lookbook' },
      after: { label: 'Summer Lookbook v2' },
    },
    {
      action: 'catalogue_template.delete',
      resourceType: 'catalogue_template',
      resourceId: randomUUID(),
      before: { label: 'Old Draft Template' },
    },
    {
      action: 'catalogue_template.update_looks',
      resourceType: 'catalogue_template',
      resourceId: randomUUID(),
      after: { label: 'Wedding Collection', lookCount: 8 },
    },

    // --- Assets ---
    { action: 'asset.restore', resourceType: 'asset', resourceId: randomUUID() },
    { action: 'asset.permanent_delete', resourceType: 'asset', resourceId: randomUUID() },
    { action: 'asset.bulk_import', resourceType: 'asset', after: { imported: 120 } },
    {
      action: 'jobs.delete_assets',
      resourceType: 'job',
      resourceId: randomUUID(),
      after: { deleted: ['output', 'thumbnail'] },
    },

    // --- System config ---
    {
      action: 'config.update',
      resourceType: 'system_config',
      before: { maxBatchJobs: 20 },
      after: { maxBatchJobs: 30 },
    },
    {
      action: 'config.app_video_update',
      resourceType: 'system_config',
      resourceId: 'app_video',
      before: { key: 'config/app-video-old.mp4' },
      after: { key: 'config/app-video-2026.mp4' },
    },

    // --- Credit plans ---
    {
      action: 'credit_plan.create',
      resourceType: 'credit_plan',
      resourceId: randomUUID(),
      after: { name: 'Diwali Special Pack', credits: 500 },
    },
    ...(growthPlan
      ? [
          {
            action: 'credit_plan.update',
            resourceType: 'credit_plan',
            resourceId: growthPlan.id,
            before: { basePaise: 249900 },
            after: { basePaise: 279900 },
          } satisfies Template,
        ]
      : []),
    ...(starterPlan
      ? [
          {
            action: 'credit_plan.delete',
            resourceType: 'credit_plan',
            resourceId: starterPlan.id,
            before: { name: 'Starter Pack' },
          } satisfies Template,
        ]
      : []),

    // --- Merchants ---
    {
      action: 'merchant.create',
      resourceType: 'merchant',
      resourceId: randomUUID(),
      after: { companyName: 'Ritu Kumar Boutique' },
    },
    ...(merchant
      ? [
          {
            action: 'merchant.update',
            resourceType: 'merchant',
            resourceId: merchant.id,
            before: { jobRateLimitPerMin: 10 },
            after: { jobRateLimitPerMin: 30 },
          } satisfies Template,
        ]
      : []),
    ...(merchant
      ? [
          {
            action: 'merchant.credit_grant',
            resourceType: 'merchant',
            resourceId: merchant.id,
            after: { amount: 500, reason: 'Onboarding bonus' },
          } satisfies Template,
        ]
      : []),

    // --- Saree ---
    {
      action: 'saree_workflow.create',
      resourceType: 'saree_workflow',
      resourceId: randomUUID(),
      after: { slug: 'saree-drape-v3', label: 'Saree Drape v3' },
    },
    ...(sareeWorkflow
      ? [
          {
            action: 'saree_workflow.delete',
            resourceType: 'saree_workflow',
            resourceId: sareeWorkflow.id,
            before: { slug: sareeWorkflow.label, label: sareeWorkflow.label },
          } satisfies Template,
        ]
      : []),
    {
      action: 'saree_settings.update',
      resourceType: 'saree_settings',
      before: { modelImageKey: null },
      after: { modelImageKey: 'saree/model-default.png' },
    },

    // --- Held jobs ---
    {
      action: 'held_jobs.release',
      resourceType: 'job',
      after: { released: 18, remaining: 3, hasMore: false },
    },

    // --- Unmapped actions — exercise the humanizeActionFallback default case ---
    {
      action: 'shopify_stores.delete',
      resourceType: 'shopify_store',
      resourceId: randomUUID(),
      before: { shopDomain: 'legacy-store.myshopify.com' },
    },
    {
      action: 'shopify_stores.update',
      resourceType: 'shopify_store',
      resourceId: randomUUID(),
      before: { isActive: true },
      after: { isActive: false },
    },
    {
      action: 'kiosk_devices.rotate_key',
      resourceType: 'kiosk_device',
      resourceId: randomUUID(),
      after: { rotatedAt: new Date().toISOString() },
    },
  ];

  const now = Date.now();
  const rows = templates.map((t, idx) => {
    const actor = pick(admins, idx);
    const daysAgo = idx % 34; // spread across ~5 weeks so date-range filtering has something to bite on
    const createdAt = new Date(now - daysAgo * dayMs - (idx % 7) * 3_600_000);
    return {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: t.action,
      resourceType: t.resourceType,
      resourceId: t.resourceId ?? null,
      before: t.before ?? null,
      after: t.after ?? null,
      ipAddress: pick(IPS, idx),
      userAgent: pick(AGENTS, idx),
      // Row 0 always carries the fixed idempotency marker checked above; the
      // rest are mostly tagged for realism, with some left null so the
      // details drawer's "Request:" line is exercised both ways.
      requestId:
        idx === 0
          ? SEED_MARKER
          : idx % 5 === 0
            ? null
            : `req-seed-${t.action.replace(/\./g, '-')}-${idx}`,
      createdAt,
    };
  });

  await db.insert(schema.auditLogs).values(rows);
  console.log(
    `✅ Seeded ${rows.length} audit_logs rows covering ${templates.length} action types.`,
  );
  console.log('View in admin-web under Team Activity.');
  await close();
}

main().catch((err) => {
  console.error('❌ Seeding audit logs failed:', err);
  process.exit(1);
});
