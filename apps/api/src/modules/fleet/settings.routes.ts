import { schema } from '@aivastra/db';
import {
  fleetNotificationSettingsPatchSchema,
  fleetNotificationSettingsSchema,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { recordAudit } from '../admin/audit.js';
import { requirePermission } from '../admin/guard.js';
import { ALERT_EMAILS_SETTING, loadAlertRecipients } from './notify.js';

/**
 * Who is emailed about incidents. A saved list (even an empty one, which means "off on purpose")
 * wins over the server environment's FLEET_ALERT_EMAILS; with neither, nothing is sent.
 */
export async function fleetSettingsRoutes(app: FastifyInstance) {
  app.get(
    '/admin/fleet/notification-settings',
    { preHandler: requirePermission('fleet.view') },
    async () => {
      const r = await loadAlertRecipients(app);
      return fleetNotificationSettingsSchema.parse({
        generatedAt: new Date().toISOString(),
        emails: r.emails,
        source: r.source,
        updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      });
    },
  );

  app.put(
    '/admin/fleet/notification-settings',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { body: fleetNotificationSettingsPatchSchema },
    },
    async (req) => {
      const { emails: raw } = req.body as z.infer<typeof fleetNotificationSettingsPatchSchema>;
      const emails = [...new Set(raw)];
      await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.fleetSettings)
          .where(eq(schema.fleetSettings.key, ALERT_EMAILS_SETTING));
        await tx
          .insert(schema.fleetSettings)
          .values({ key: ALERT_EMAILS_SETTING, value: emails, updatedBy: req.userId })
          .onConflictDoUpdate({
            target: schema.fleetSettings.key,
            set: { value: emails, updatedBy: req.userId, updatedAt: new Date() },
          });
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'fleet.notification_settings.update',
          resourceType: 'fleet_settings',
          resourceId: ALERT_EMAILS_SETTING,
          before: { emails: before?.value ?? null },
          after: { emails },
          request: req,
        });
      });
      const r = await loadAlertRecipients(app);
      return fleetNotificationSettingsSchema.parse({
        generatedAt: new Date().toISOString(),
        emails: r.emails,
        source: r.source,
        updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      });
    },
  );
}
