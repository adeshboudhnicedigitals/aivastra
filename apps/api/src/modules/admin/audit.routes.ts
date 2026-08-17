import { schema } from '@aivastra/db';
import { and, count, desc, eq, gte, ilike, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from './guard.js';

const AuditLogsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  actorUserId: z.string().uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
});

export async function adminAuditRoutes(app: FastifyInstance) {
  const GUARD = requirePermission('audit.read');

  app.get(
    '/admin/audit-logs',
    {
      preHandler: GUARD,
      schema: { querystring: AuditLogsQuery },
    },
    async (req) => {
      const query = req.query as z.infer<typeof AuditLogsQuery>;
      const { page, pageSize, actorUserId, action, resourceType, resourceId, startDate, endDate } =
        query;

      const conditions = [];

      if (actorUserId) conditions.push(eq(schema.auditLogs.actorUserId, actorUserId));
      if (action) conditions.push(ilike(schema.auditLogs.action, `%${action}%`));
      if (resourceType) conditions.push(eq(schema.auditLogs.resourceType, resourceType));
      if (resourceId) conditions.push(eq(schema.auditLogs.resourceId, resourceId));
      if (startDate) conditions.push(gte(schema.auditLogs.createdAt, new Date(startDate)));
      if (endDate) conditions.push(lte(schema.auditLogs.createdAt, new Date(endDate)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ total }] = await app.db
        .select({ total: count() })
        .from(schema.auditLogs)
        .where(where);

      const rows = await app.db
        .select({
          id: schema.auditLogs.id,
          actorUserId: schema.auditLogs.actorUserId,
          actorRole: schema.auditLogs.actorRole,
          actorEmail: schema.users.email,
          actorDisplayName: schema.users.displayName,
          action: schema.auditLogs.action,
          resourceType: schema.auditLogs.resourceType,
          resourceId: schema.auditLogs.resourceId,
          before: schema.auditLogs.before,
          after: schema.auditLogs.after,
          ipAddress: schema.auditLogs.ipAddress,
          userAgent: schema.auditLogs.userAgent,
          requestId: schema.auditLogs.requestId,
          createdAt: schema.auditLogs.createdAt,
        })
        .from(schema.auditLogs)
        .leftJoin(schema.users, eq(schema.auditLogs.actorUserId, schema.users.id))
        .where(where)
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        page,
        pageSize,
        total: Number(total),
        items: rows,
      };
    },
  );
}
