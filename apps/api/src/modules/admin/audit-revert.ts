import { schema } from '@aivastra/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from './audit.js';

interface AuditLogRecord {
  id: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

export interface RevertCheckResult {
  revertible: boolean;
  reason?: string;
  summary?: string;
}

/**
 * Checks whether an audit log entry can be automatically reverted.
 */
export function isAuditActionRevertible(log: {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
}): RevertCheckResult {
  if (log.action === 'audit.revert') {
    return { revertible: false, reason: 'A revert event cannot be reverted' };
  }

  // Non-reversible actions (data physically deleted without restore path, or password hashes)
  if (
    log.action === 'admin_users.sync_password' ||
    log.action === 'users.reset_password' ||
    log.action === 'asset.permanent_delete' ||
    log.action === 'jobs.delete_assets' ||
    log.action === 'shopify_stores.delete'
  ) {
    return {
      revertible: false,
      reason:
        'This action is permanent or involves credentials that cannot be automatically undone',
    };
  }

  // Deleted workflow templates lack full graph JSON in audit payload
  if (log.action === 'workflow.delete') {
    return {
      revertible: false,
      reason:
        'Deleted workflow templates cannot be restored automatically because graph JSON is omitted from audit log',
    };
  }

  // Generic updates
  if (log.action.endsWith('.update') || log.action.endsWith('_update')) {
    if (!log.resourceId && log.resourceType !== 'system_config') {
      return { revertible: false, reason: 'Missing resource ID' };
    }
    if (!log.before || typeof log.before !== 'object' || Object.keys(log.before).length === 0) {
      return { revertible: false, reason: 'No prior snapshot was recorded for this change' };
    }
    return { revertible: true, summary: 'Restore properties to their previous values' };
  }

  // Credits
  if (
    log.action === 'credits.grant' ||
    log.action === 'users.credits.grant' ||
    log.action === 'credits.deduct' ||
    log.action === 'merchant.credit_grant'
  ) {
    if (!log.resourceId) return { revertible: false, reason: 'Missing account ID' };
    const amt =
      typeof log.after === 'object' && log.after !== null
        ? (log.after as Record<string, unknown>).amount
        : undefined;
    if (typeof amt !== 'number' || amt <= 0) {
      return { revertible: false, reason: 'Missing credit amount to reverse' };
    }
    const isGrant = log.action.includes('grant');
    return {
      revertible: true,
      summary: isGrant ? `Deduct ${amt} credits` : `Refund ${amt} credits`,
    };
  }

  // User bans
  if (log.action === 'users.ban') {
    if (!log.resourceId) return { revertible: false, reason: 'Missing user ID' };
    return { revertible: true, summary: 'Unban this user account' };
  }
  if (log.action === 'users.unban') {
    if (!log.resourceId) return { revertible: false, reason: 'Missing user ID' };
    return { revertible: true, summary: 'Re-ban this user account' };
  }

  // Admin approvals
  if (log.action === 'admin_users.approve' || log.action === 'admin_users.reject') {
    if (!log.resourceId) return { revertible: false, reason: 'Missing admin user ID' };
    return { revertible: true, summary: 'Reset admin account to pending status' };
  }
  if (log.action === 'admin_users.revoke') {
    if (!log.resourceId) return { revertible: false, reason: 'Missing admin user ID' };
    return { revertible: true, summary: 'Reactivate admin account access' };
  }
  if (log.action === 'admin_users.update_role') {
    if (!log.resourceId) return { revertible: false, reason: 'Missing admin user ID' };
    return { revertible: true, summary: 'Restore previous admin role' };
  }

  // Creates
  if (
    log.action === 'garment_type.create' ||
    log.action === 'worker.create' ||
    log.action === 'workflow.create' ||
    log.action === 'face.create' ||
    log.action === 'background.create' ||
    log.action === 'pose.create' ||
    log.action === 'sample_video.create' ||
    log.action === 'saree_style.create' ||
    log.action === 'catalogue_template.create' ||
    log.action === 'catalog_item.create' ||
    log.action === 'catalog_category.create' ||
    log.action === 'credit_plan.create'
  ) {
    if (!log.resourceId) return { revertible: false, reason: 'Missing created resource ID' };
    return { revertible: true, summary: 'Delete or deactivate the created resource' };
  }

  // Deletes
  if (
    log.action === 'garment_type.delete' ||
    log.action === 'worker.delete' ||
    log.action === 'face.delete' ||
    log.action === 'background.delete' ||
    log.action === 'pose.delete' ||
    log.action === 'sample_video.delete' ||
    log.action === 'catalogue_template.delete' ||
    log.action === 'catalog_item.delete' ||
    log.action === 'catalog_category.delete' ||
    log.action === 'credit_plan.delete'
  ) {
    if (!log.resourceId) return { revertible: false, reason: 'Missing deleted resource ID' };
    return { revertible: true, summary: 'Restore the deleted resource' };
  }

  if (log.action === 'asset.restore') {
    if (!log.resourceId) return { revertible: false, reason: 'Missing asset ID' };
    return { revertible: true, summary: 'Send the asset back to the recycle bin' };
  }

  return { revertible: false, reason: `Reverting is not supported for action "${log.action}"` };
}

/**
 * Strips internal non-mutable columns from a snapshot before applying updates.
 */
function cleanSnapshotFields(snapshot: Record<string, unknown>): Record<string, unknown> {
  const { id, createdAt, created_at, updatedAt, updated_at, deletedAt, deleted_at, ...rest } =
    snapshot;
  return rest;
}

/**
 * Reverts the specified audit log entry within a transaction and appends an `audit.revert` log.
 */
export async function executeAuditRevert(
  app: FastifyInstance,
  log: AuditLogRecord,
  req: FastifyRequest,
): Promise<{ ok: boolean; message: string }> {
  const check = isAuditActionRevertible(log);
  if (!check.revertible) {
    throw new AppError('NOT_REVERTIBLE', 400, check.reason || 'Activity cannot be reverted');
  }

  const resourceId = log.resourceId;
  const beforeSnapshot = (log.before && typeof log.before === 'object' ? log.before : {}) as Record<
    string,
    unknown
  >;
  const afterSnapshot = (log.after && typeof log.after === 'object' ? log.after : {}) as Record<
    string,
    unknown
  >;

  return await app.db.transaction(async (tx) => {
    // 1. Verify this specific log was not already reverted
    const [alreadyReverted] = await tx
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, 'audit.revert'),
          sql`${schema.auditLogs.after}->>'revertedLogId' = ${log.id}`,
        ),
      );
    if (alreadyReverted) {
      throw new AppError('ALREADY_REVERTED', 400, 'This activity has already been reverted');
    }

    let currentSnapshot: unknown = null;
    let revertSummary = '';

    // ==========================================
    // 2. Perform the reversal by action category
    // ==========================================

    // --- Credits Grant Revert ---
    if (log.action === 'credits.grant' || log.action === 'users.credits.grant') {
      const amount = Number(afterSnapshot.amount);
      if (!amount || Number.isNaN(amount))
        throw new AppError('INVALID_LOG', 400, 'Invalid credit amount in audit record');
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing user ID in audit record');

      const [cur] = await tx
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, resourceId));
      currentSnapshot = cur ?? null;

      await tx
        .insert(schema.userCredits)
        .values({
          userId: resourceId,
          balance: Math.max(0, (cur?.balance ?? 0) - amount),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.userCredits.userId,
          set: {
            balance: sql`${schema.userCredits.balance} - ${amount}`,
            updatedAt: new Date(),
          },
        });

      await tx.insert(schema.creditLedger).values({
        userId: resourceId,
        delta: -amount,
        reason: `Revert credit grant #${log.id.slice(0, 8)}`,
        adminId: req.userId,
      });

      revertSummary = `Deducted ${amount} credits from user`;
    }

    // --- Credits Deduct Revert ---
    else if (log.action === 'credits.deduct') {
      const amount = Number(afterSnapshot.amount);
      if (!amount || Number.isNaN(amount))
        throw new AppError('INVALID_LOG', 400, 'Invalid credit amount in audit record');
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing user ID in audit record');

      const [cur] = await tx
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, resourceId));
      currentSnapshot = cur ?? null;

      await tx
        .insert(schema.userCredits)
        .values({
          userId: resourceId,
          balance: (cur?.balance ?? 0) + amount,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.userCredits.userId,
          set: {
            balance: sql`${schema.userCredits.balance} + ${amount}`,
            updatedAt: new Date(),
          },
        });

      await tx.insert(schema.creditLedger).values({
        userId: resourceId,
        delta: amount,
        reason: `Revert credit deduction #${log.id.slice(0, 8)}`,
        adminId: req.userId,
      });

      revertSummary = `Refunded ${amount} credits to user`;
    }

    // --- Merchant Credit Grant Revert ---
    else if (log.action === 'merchant.credit_grant') {
      const amount = Number(afterSnapshot.amount);
      if (!amount || Number.isNaN(amount))
        throw new AppError('INVALID_LOG', 400, 'Invalid credit amount');
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing merchant ID');

      const [merchant] = await tx
        .select({ id: schema.merchants.id, userId: schema.merchants.userId })
        .from(schema.merchants)
        .where(eq(schema.merchants.id, resourceId));
      if (!merchant) throw new AppError('NOT_FOUND', 404, 'Merchant not found');
      currentSnapshot = merchant;

      await tx
        .insert(schema.userCredits)
        .values({
          userId: merchant.userId,
          balance: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.userCredits.userId,
          set: {
            balance: sql`${schema.userCredits.balance} - ${amount}`,
            updatedAt: new Date(),
          },
        });

      await tx.insert(schema.creditLedger).values({
        userId: merchant.userId,
        delta: -amount,
        reason: `Revert merchant credit grant #${log.id.slice(0, 8)}`,
        adminId: req.userId,
      });

      revertSummary = `Deducted ${amount} credits from merchant`;
    }

    // --- User Ban Revert ---
    else if (log.action === 'users.ban') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing user ID');
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, resourceId));
      if (!user) throw new AppError('NOT_FOUND', 404, 'User not found');
      currentSnapshot = user;

      await tx
        .update(schema.users)
        .set({ isBanned: false, banReason: null, updatedAt: new Date() })
        .where(eq(schema.users.id, resourceId));

      revertSummary = `Unbanned user ${user.email ?? resourceId}`;
    }

    // --- User Unban Revert ---
    else if (log.action === 'users.unban') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing user ID');
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, resourceId));
      if (!user) throw new AppError('NOT_FOUND', 404, 'User not found');
      currentSnapshot = user;

      const banReason = (beforeSnapshot.banReason as string) || 'Banned';
      await tx
        .update(schema.users)
        .set({ isBanned: true, banReason, updatedAt: new Date() })
        .where(eq(schema.users.id, resourceId));

      revertSummary = `Re-banned user ${user.email ?? resourceId}`;
    }

    // --- Admin User Status & Role Revert ---
    else if (log.action === 'admin_users.approve' || log.action === 'admin_users.reject') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing admin user ID');
      const [admin] = await tx
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.userId, resourceId));
      if (!admin) throw new AppError('NOT_FOUND', 404, 'Admin user not found');
      currentSnapshot = admin;

      await tx
        .update(schema.adminUsers)
        .set({ status: 'pending' })
        .where(eq(schema.adminUsers.userId, resourceId));

      revertSummary = 'Reset admin account to pending status';
    } else if (log.action === 'admin_users.revoke') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing admin user ID');
      const [admin] = await tx
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.userId, resourceId));
      if (!admin) throw new AppError('NOT_FOUND', 404, 'Admin user not found');
      currentSnapshot = admin;

      await tx
        .update(schema.adminUsers)
        .set({ status: 'active' })
        .where(eq(schema.adminUsers.userId, resourceId));

      revertSummary = 'Restored active admin status';
    } else if (log.action === 'admin_users.update_role') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing admin user ID');
      const [admin] = await tx
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.userId, resourceId));
      if (!admin) throw new AppError('NOT_FOUND', 404, 'Admin user not found');
      currentSnapshot = admin;

      const prevRole = beforeSnapshot.role as string;
      if (!prevRole)
        throw new AppError('INVALID_LOG', 400, 'No previous role found in audit record');

      await tx
        .update(schema.adminUsers)
        .set({ role: prevRole as 'superadmin' | 'admin' | 'ops' | 'analyst' })
        .where(eq(schema.adminUsers.userId, resourceId));

      revertSummary = `Restored admin role to ${prevRole}`;
    }

    // --- Worker Update Revert ---
    else if (log.action === 'worker.update') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing worker ID');
      const [worker] = await tx
        .select()
        .from(schema.workers)
        .where(eq(schema.workers.id, resourceId));
      if (!worker) throw new AppError('NOT_FOUND', 404, 'Worker not found');
      currentSnapshot = worker;

      const fields = cleanSnapshotFields(beforeSnapshot);
      await tx
        .update(schema.workers)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(schema.workers.id, resourceId));

      // Sync Redis registry
      const raw = await app.redis.hget('workers:registry', resourceId);
      if (raw) {
        const cur = JSON.parse(raw) as Record<string, unknown>;
        if (fields.url) cur.url = fields.url;
        if (fields.allowedJobTypes) cur.allowedJobTypes = fields.allowedJobTypes;
        if (fields.isActive !== undefined) cur.status = fields.isActive ? 'IDLE' : 'DRAINING';
        await app.redis.hset('workers:registry', resourceId, JSON.stringify(cur));
      }

      revertSummary = `Restored worker "${resourceId}" configuration`;
    }

    // --- Worker Create Revert ---
    else if (log.action === 'worker.create') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing worker ID');
      const [worker] = await tx
        .select()
        .from(schema.workers)
        .where(eq(schema.workers.id, resourceId));
      currentSnapshot = worker ?? null;

      await tx.delete(schema.workers).where(eq(schema.workers.id, resourceId));
      await app.redis.hdel('workers:registry', resourceId);

      revertSummary = `Removed created worker "${resourceId}"`;
    }

    // --- Worker Delete Revert ---
    else if (log.action === 'worker.delete') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing worker ID');
      const fields = beforeSnapshot as {
        id?: string;
        label?: string;
        url?: string;
        apiKey?: string;
        isActive?: boolean;
        allowedJobTypes?: string[];
      };
      if (!fields?.id)
        throw new AppError('INVALID_LOG', 400, 'Missing worker details in audit record');

      await tx
        .insert(schema.workers)
        .values({
          id: fields.id,
          label: fields.label ?? '',
          url: fields.url ?? '',
          apiKey: fields.apiKey ?? 'reverted-placeholder-key',
          isActive: fields.isActive ?? true,
          allowedJobTypes: fields.allowedJobTypes ?? [],
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.workers.id,
          set: {
            label: fields.label ?? '',
            url: fields.url ?? '',
            isActive: fields.isActive ?? true,
            allowedJobTypes: fields.allowedJobTypes ?? [],
            updatedAt: new Date(),
          },
        });

      revertSummary = `Restored deleted worker "${resourceId}"`;
    }

    // --- Garment Type Update Revert ---
    else if (log.action === 'garment_type.update') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing garment type ID');
      const [sub] = await tx
        .select()
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, resourceId));
      if (!sub) throw new AppError('NOT_FOUND', 404, 'Garment type not found');
      currentSnapshot = sub;

      const fields = cleanSnapshotFields(beforeSnapshot);
      await tx
        .update(schema.garmentSubcategories)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(schema.garmentSubcategories.id, resourceId));

      revertSummary = `Restored garment type "${sub.label || resourceId}"`;
    }

    // --- Garment Type Create Revert ---
    else if (log.action === 'garment_type.create') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing garment type ID');
      const [sub] = await tx
        .select()
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, resourceId));
      currentSnapshot = sub ?? null;

      await tx
        .delete(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, resourceId));
      revertSummary = `Deleted created garment type "${sub?.label || resourceId}"`;
    }

    // --- Garment Type Delete Revert ---
    else if (log.action === 'garment_type.delete') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing garment type ID');
      const fields = beforeSnapshot as {
        label?: string;
        slug?: string;
        genderSlug?: string;
        category?: string;
        description?: string;
        imageUrl?: string;
        promptHint?: string;
        displayOrder?: number;
      };
      if (!fields?.label)
        throw new AppError('INVALID_LOG', 400, 'Missing garment type fields in audit record');

      const slug =
        (fields.slug as string) ||
        (fields.label
          ? String(fields.label)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
          : 'reverted-type');

      await tx
        .insert(schema.garmentSubcategories)
        .values({
          id: resourceId,
          slug,
          label: fields.label,
          genderSlug: fields.genderSlug ?? 'women',
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.garmentSubcategories.id,
          set: {
            slug,
            label: fields.label,
            genderSlug: fields.genderSlug ?? 'women',
            updatedAt: new Date(),
          },
        });

      revertSummary = `Restored deleted garment type "${fields.label}"`;
    }

    // --- Workflow Update Revert ---
    else if (log.action === 'workflow.update') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing workflow ID');
      const [wf] = await tx
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, resourceId));
      if (!wf) throw new AppError('NOT_FOUND', 404, 'Workflow template not found');
      currentSnapshot = wf;

      const fields = cleanSnapshotFields(beforeSnapshot);
      await tx
        .update(schema.workflowTemplates)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(schema.workflowTemplates.id, resourceId));

      revertSummary = `Restored workflow template "${wf.label || resourceId}"`;
    }

    // --- Workflow Create Revert ---
    else if (log.action === 'workflow.create') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing workflow ID');
      const [wf] = await tx
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, resourceId));
      currentSnapshot = wf ?? null;

      await tx
        .update(schema.workflowTemplates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.workflowTemplates.id, resourceId));

      revertSummary = `Deactivated created workflow "${wf?.label || resourceId}"`;
    }

    // --- User Update Revert ---
    else if (log.action === 'users.update') {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing user ID');
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, resourceId));
      if (!user) throw new AppError('NOT_FOUND', 404, 'User not found');
      currentSnapshot = user;

      const fields = cleanSnapshotFields(beforeSnapshot);
      await tx
        .update(schema.users)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(schema.users.id, resourceId));

      revertSummary = `Restored account details for ${user.email ?? resourceId}`;
    }

    // --- Image Compression Config Revert ---
    else if (log.action === 'image_compression.update') {
      const prev = beforeSnapshot;
      await app.redis.set('config:image-compression', JSON.stringify(prev));
      revertSummary = 'Restored image compression configuration';
    }

    // --- Soft-Delete Asset Deletions Revert ---
    else if (
      log.action === 'face.delete' ||
      log.action === 'background.delete' ||
      log.action === 'pose.delete' ||
      log.action === 'sample_video.delete'
    ) {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing asset ID');
      // biome-ignore lint/suspicious/noExplicitAny: polymorphic table dispatch
      const tableMap: Record<string, any> = {
        'face.delete': schema.modelFaces,
        'background.delete': schema.modelBackgrounds,
        'pose.delete': schema.modelPoseAssets,
        'sample_video.delete': schema.sampleVideos,
      };
      const table = tableMap[log.action];
      if (table) {
        await tx
          .update(table)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(table.id, resourceId));
        revertSummary = `Restored deleted ${log.resourceType}`;
      }
    }

    // --- Hard-Delete Asset Reverts ---
    else if (
      log.action === 'catalogue_template.delete' ||
      log.action === 'catalog_item.delete' ||
      log.action === 'catalog_category.delete' ||
      log.action === 'credit_plan.delete'
    ) {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing ID');
      // biome-ignore lint/suspicious/noExplicitAny: polymorphic table dispatch
      const tableMap: Record<string, any> = {
        'catalogue_template.delete': schema.catalogueTemplates,
        'catalog_item.delete': schema.catalogItems,
        'catalog_category.delete': schema.catalogCategories,
        'credit_plan.delete': schema.creditPlans,
      };
      const table = tableMap[log.action];
      if (table && Object.keys(beforeSnapshot).length > 0) {
        await tx.insert(table).values({
          ...cleanSnapshotFields(beforeSnapshot),
          id: resourceId,
          updatedAt: new Date(),
          // biome-ignore lint/suspicious/noExplicitAny: polymorphic table values
        } as any);
        revertSummary = `Restored deleted ${log.resourceType}`;
      }
    }

    // --- Soft-Delete Asset Creation Revert ---
    else if (
      log.action === 'face.create' ||
      log.action === 'background.create' ||
      log.action === 'pose.create' ||
      log.action === 'sample_video.create'
    ) {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing asset ID');
      // biome-ignore lint/suspicious/noExplicitAny: polymorphic table dispatch
      const tableMap: Record<string, any> = {
        'face.create': schema.modelFaces,
        'background.create': schema.modelBackgrounds,
        'pose.create': schema.modelPoseAssets,
        'sample_video.create': schema.sampleVideos,
      };
      const table = tableMap[log.action];
      if (table) {
        await tx
          .update(table)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(table.id, resourceId));
        revertSummary = `Deactivated created ${log.resourceType}`;
      }
    }

    // --- Hard-Delete Resource Creation Revert ---
    else if (
      log.action === 'catalogue_template.create' ||
      log.action === 'catalog_item.create' ||
      log.action === 'catalog_category.create' ||
      log.action === 'credit_plan.create'
    ) {
      if (!resourceId) throw new AppError('INVALID_LOG', 400, 'Missing ID');
      // biome-ignore lint/suspicious/noExplicitAny: polymorphic table dispatch
      const tableMap: Record<string, any> = {
        'catalogue_template.create': schema.catalogueTemplates,
        'catalog_item.create': schema.catalogItems,
        'catalog_category.create': schema.catalogCategories,
        'credit_plan.create': schema.creditPlans,
      };
      const table = tableMap[log.action];
      if (table) {
        // biome-ignore lint/suspicious/noExplicitAny: generic id column match
        await tx.delete(table).where(eq(table.id, resourceId as any));
        revertSummary = `Deleted created ${log.resourceType}`;
      }
    }

    // --- Asset Restore Revert ---
    else if (log.action === 'asset.restore') {
      const type = afterSnapshot.type as string;
      const ids = Array.isArray(afterSnapshot.ids)
        ? (afterSnapshot.ids as string[])
        : resourceId
          ? [resourceId]
          : [];
      if (ids.length > 0) {
        if (type === 'face') {
          await tx
            .update(schema.modelFaces)
            .set({ deletedAt: new Date() })
            .where(inArray(schema.modelFaces.id, ids));
        } else if (type === 'background') {
          await tx
            .update(schema.modelBackgrounds)
            .set({ deletedAt: new Date() })
            .where(inArray(schema.modelBackgrounds.id, ids));
        } else {
          await tx
            .update(schema.modelPoseAssets)
            .set({ deletedAt: new Date() })
            .where(inArray(schema.modelPoseAssets.id, ids));
        }
      }
      revertSummary = 'Moved asset back to recycle bin';
    }

    // --- Fallback generic update with before snapshot ---
    else if (
      log.action.endsWith('.update') &&
      resourceId &&
      Object.keys(beforeSnapshot).length > 0
    ) {
      // biome-ignore lint/suspicious/noExplicitAny: polymorphic table dispatch
      const tableMap: Record<string, any> = {
        face: schema.modelFaces,
        background: schema.modelBackgrounds,
        pose: schema.modelPoseAssets,
        sample_video: schema.sampleVideos,
        saree_style: schema.sareeMannequinStyles,
        catalog_item: schema.catalogItems,
        catalog_category: schema.catalogCategories,
        catalogue_template: schema.catalogueTemplates,
        credit_plan: schema.creditPlans,
        merchant: schema.merchants,
      };
      const table = tableMap[log.resourceType];
      if (!table) {
        throw new AppError(
          'NOT_REVERTIBLE',
          400,
          `Revert not supported for resource type ${log.resourceType}`,
        );
      }

      const [cur] = await tx.select().from(table).where(eq(table.id, resourceId));
      if (!cur) throw new AppError('NOT_FOUND', 404, `${log.resourceType} not found`);
      currentSnapshot = cur;

      const fields = cleanSnapshotFields(beforeSnapshot);
      await tx
        .update(table)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(table.id, resourceId));
      revertSummary = `Restored ${log.resourceType} properties`;
    } else {
      throw new AppError('NOT_REVERTIBLE', 400, `Revert not supported for action ${log.action}`);
    }

    // ==========================================
    // 3. Append the `audit.revert` record
    // ==========================================
    await recordAudit(tx, {
      // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
      actor: { userId: req.userId, role: req.adminRole! },
      action: 'audit.revert',
      resourceType: log.resourceType,
      resourceId: log.resourceId ?? undefined,
      before: currentSnapshot,
      after: {
        revertedLogId: log.id,
        originalAction: log.action,
        summary: revertSummary,
        revertedAt: new Date().toISOString(),
      },
      request: req,
    });

    return {
      ok: true,
      message: revertSummary || 'Activity successfully reverted',
    };
  });
}
