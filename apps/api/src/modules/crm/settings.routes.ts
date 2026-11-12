import { schema } from '@aivastra/db';
import {
  CrmSettingsPutBody,
  type CrmSettingsResponse,
  WhatsappChannelPutBody,
  type WhatsappChannelResponse,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { channelForMerchant, identifyBlockers, verifyChannelCredentials } from './channel.js';
import { sealSecret } from './crypto.js';

const MERCHANT_ADMIN_ACTOR_ROLE = 'MERCHANT_ADMIN';

// CRM phase 2, Task 3: the merchant admin connects the brand's WhatsApp number and chooses
// retention. Merchant admin only: staff never see or change either. Secrets go in, never out.
export async function crmSettingsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/merchant/whatsapp-channel',
    { preHandler: app.requireMerchantAdmin },
    async (req): Promise<WhatsappChannelResponse> => {
      const row = await channelForMerchant(app.db, req.merchantMember!.merchantId);
      return {
        connected: row !== null,
        wabaId: row?.wabaId ?? null,
        phoneNumberId: row?.phoneNumberId ?? null,
        displayNumber: row?.displayNumber ?? null,
        connectedAt: row?.connectedAt.toISOString() ?? null,
      };
    },
  );

  app.put(
    '/v1/merchant/whatsapp-channel',
    {
      preHandler: app.requireMerchantAdmin,
      schema: { body: WhatsappChannelPutBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<WhatsappChannelResponse> => {
      const m = req.merchantMember!;
      const body = req.body as WhatsappChannelPutBody;
      if (!app.env.CRM_DATA_KEY) {
        throw new AppError('CRM_NOT_CONFIGURED', 503, 'customer data encryption is not configured');
      }
      const owner = await app.db
        .select({ merchantId: schema.merchantWhatsappChannels.merchantId })
        .from(schema.merchantWhatsappChannels)
        .where(eq(schema.merchantWhatsappChannels.phoneNumberId, body.phoneNumberId))
        .limit(1);
      if (owner[0] && owner[0].merchantId !== m.merchantId) {
        throw new AppError(
          'WHATSAPP_NUMBER_TAKEN',
          409,
          'this WhatsApp number is connected to another account',
        );
      }
      // Checked against Meta before anything is stored (plan Task 3).
      const displayNumber = await verifyChannelCredentials(
        app,
        body.phoneNumberId,
        body.accessToken,
      );

      const values = {
        wabaId: body.wabaId,
        phoneNumberId: body.phoneNumberId,
        displayNumber,
        accessTokenEnc: sealSecret(app.env.CRM_DATA_KEY, body.accessToken),
        appSecretEnc: sealSecret(app.env.CRM_DATA_KEY, body.appSecret),
        connectedBy: m.userId,
        updatedAt: new Date(),
      };
      const row = await app.db.transaction(async (tx) => {
        const [saved] = await tx
          .insert(schema.merchantWhatsappChannels)
          .values({ merchantId: m.merchantId, ...values, connectedAt: new Date() })
          .onConflictDoUpdate({ target: schema.merchantWhatsappChannels.merchantId, set: values })
          .returning();
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'merchant_whatsapp_channel.connect',
          resourceType: 'merchant_whatsapp_channel',
          resourceId: m.merchantId,
          // Identifiers only: the sealed secrets stay out of the audit log.
          after: { wabaId: body.wabaId, phoneNumberId: body.phoneNumberId, displayNumber },
          request: req,
        });
        return saved!;
      });
      return {
        connected: true,
        wabaId: row.wabaId,
        phoneNumberId: row.phoneNumberId,
        displayNumber: row.displayNumber,
        connectedAt: row.connectedAt.toISOString(),
      };
    },
  );

  app.delete(
    '/v1/merchant/whatsapp-channel',
    { preHandler: app.requireMerchantAdmin },
    async (req, reply) => {
      const m = req.merchantMember!;
      await app.db.transaction(async (tx) => {
        const removed = await tx
          .delete(schema.merchantWhatsappChannels)
          .where(eq(schema.merchantWhatsappChannels.merchantId, m.merchantId))
          .returning({ phoneNumberId: schema.merchantWhatsappChannels.phoneNumberId });
        if (removed.length === 0) return;
        // Disconnecting stops new identifications only; captured customers stay the merchant's
        // (spec §4: moving away from a mode never deletes customers).
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'merchant_whatsapp_channel.disconnect',
          resourceType: 'merchant_whatsapp_channel',
          resourceId: m.merchantId,
          before: { phoneNumberId: removed[0]!.phoneNumberId },
          request: req,
        });
      });
      return reply.code(204).send();
    },
  );

  const settingsResponse = async (merchantId: string): Promise<CrmSettingsResponse> => {
    const [row] = await app.db
      .select()
      .from(schema.merchantCrmSettings)
      .where(eq(schema.merchantCrmSettings.merchantId, merchantId))
      .limit(1);
    const blockers = await identifyBlockers(app, merchantId);
    return {
      identifyAt: row?.identifyAt ?? 'end',
      photoRetentionDays: row?.photoRetentionDays ?? null,
      profileRetentionDays: row?.profileRetentionDays ?? null,
      identification: { enabled: blockers.length === 0, blockers },
    };
  };

  app.get('/v1/merchant/crm-settings', { preHandler: app.requireMerchantAdmin }, async (req) =>
    settingsResponse(req.merchantMember!.merchantId),
  );

  app.put(
    '/v1/merchant/crm-settings',
    { preHandler: app.requireMerchantAdmin, schema: { body: CrmSettingsPutBody } },
    async (req) => {
      const m = req.merchantMember!;
      const body = req.body as CrmSettingsPutBody;
      await app.db.transaction(async (tx) => {
        const values = { ...body, updatedAt: new Date(), updatedBy: m.userId };
        await tx
          .insert(schema.merchantCrmSettings)
          .values({ merchantId: m.merchantId, ...values })
          .onConflictDoUpdate({ target: schema.merchantCrmSettings.merchantId, set: values });
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'merchant_crm_settings.update',
          resourceType: 'merchant_crm_settings',
          resourceId: m.merchantId,
          after: body,
          request: req,
        });
      });
      return settingsResponse(m.merchantId);
    },
  );
}
