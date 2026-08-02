import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { AdminMerchantUpdateBody, AssetContentType } from '@aivastra/types';
import { and, count, desc, eq, ilike, or as orOp } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createKioskDevice, generatePairingCode, hashPairingCode } from '../kiosk/provisioning.js';
import { assignMerchantToActiveDemoSets } from '../merchant/demo-catalog-read.js';
import { merchantAdminGrant } from '../merchant/ledger.js';
import { findOrCreateUserForMerchant } from '../merchant/user-link.js';
import { requireAdmin } from './guard.js';

const AdminCreateClient = z
  .object({
    // Either target an already-existing user (e.g. an admin-created, username-only
    // account with no email — see users.ts schema comment) or fall back to the
    // email find-or-create flow used for onboarding a brand-new merchant contact.
    userId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    companyName: z.string().min(1),
    contactName: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    businessAddress: z.string().min(1).optional(),
    initialCredits: z.number().int().min(0).optional(),
  })
  .refine((body) => body.userId || body.email, {
    message: 'userId or email is required',
  });

const AdminCreditBody = z.object({
  amount: z.number().int().positive(),
  reason: z.string().min(1),
});

const AdminKioskDeviceBody = z.object({ label: z.string().min(1).max(120) });
const AdminPatchKioskDeviceBody = z
  .object({
    label: z.string().min(1).max(120).optional(),
    status: z.literal('revoked').optional(),
  })
  .refine((body) => body.label !== undefined || body.status !== undefined, {
    message: 'label or status is required',
  });

function publicKioskDevice(device: typeof schema.kioskDevices.$inferSelect) {
  const { pairingCodeHash: _pairingCodeHash, ...rest } = device;
  return rest;
}

// Save-time shape check for merchant webhook URLs. This rejects the obvious cases
// (non-https, hostnames that are literal private/loopback IPs) so an admin gets an
// immediate error instead of a silent drop. The authoritative SSRF guard — full DNS
// resolution against private ranges — runs at send-time in the dispatcher, since DNS
// can be repointed after save.
function assertWebhookUrlShape(urlStr: string): void {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new AppError('VALIDATION', 400, 'webhookUrl must be a valid URL');
  }
  if (u.protocol !== 'https:') {
    throw new AppError('VALIDATION', 400, 'webhookUrl must use https');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host === '::1' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80')
  ) {
    throw new AppError(
      'VALIDATION',
      400,
      'webhookUrl must not point to a private or loopback address',
    );
  }
}

export async function adminMerchantsRoutes(app: FastifyInstance) {
  app.get(
    '/admin/merchants',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN']) },
    async (req) => {
      const {
        page = '1',
        limit = '20',
        search = '',
      } = req.query as {
        page?: string;
        limit?: string;
        search?: string;
      };
      const p = Math.max(1, parseInt(page, 10) || 1);
      const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (p - 1) * l;

      const where = search
        ? orOp(
            ilike(schema.users.email, `%${search}%`),
            ilike(schema.merchants.companyName, `%${search}%`),
          )
        : undefined;

      const [totalRow] = await app.db
        .select({ n: count() })
        .from(schema.merchants)
        .innerJoin(schema.users, eq(schema.merchants.userId, schema.users.id))
        // biome-ignore lint/suspicious/noExplicitAny: drizzle where-clause union type
        .where(where as any);

      const clients = await app.db
        .select({
          id: schema.merchants.id,
          signupSource: schema.merchants.signupSource,
          companyName: schema.merchants.companyName,
          contactName: schema.merchants.contactName,
          email: schema.users.email,
          phone: schema.merchants.phone,
          businessAddress: schema.merchants.businessAddress,
          isActive: schema.merchants.isActive,
          demoData: schema.merchants.demoData,
          kioskEnabled: schema.merchants.kioskEnabled,
          maxKioskDevices: schema.merchants.maxKioskDevices,
          createdAt: schema.merchants.createdAt,
          updatedAt: schema.merchants.updatedAt,
          creditBalance: schema.merchantCredits.balance,
        })
        .from(schema.merchants)
        .innerJoin(schema.users, eq(schema.merchants.userId, schema.users.id))
        .leftJoin(
          schema.merchantCredits,
          eq(schema.merchants.id, schema.merchantCredits.merchantId),
        )
        // biome-ignore lint/suspicious/noExplicitAny: drizzle where-clause union type
        .where(where as any)
        .orderBy(desc(schema.merchants.createdAt))
        .limit(l)
        .offset(offset);

      return {
        clients,
        total: totalRow?.n ?? 0,
        page: p,
        limit: l,
      };
    },
  );

  app.post(
    '/admin/merchants',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: AdminCreateClient },
    },
    async (req, reply) => {
      const body = req.body as z.infer<typeof AdminCreateClient>;

      const client = await app.db.transaction(async (tx) => {
        let user: typeof schema.users.$inferSelect;
        if (body.userId) {
          const [existing] = await tx
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, body.userId))
            .limit(1);
          if (!existing) throw new AppError('NOT_FOUND', 404, 'User not found');
          user = existing;
        } else {
          ({ user } = await findOrCreateUserForMerchant(tx, {
            // biome-ignore lint/style/noNonNullAssertion: schema refine guarantees email when userId is absent
            email: body.email!,
            password: crypto.randomUUID(),
            displayName: body.contactName || body.companyName,
            phone: body.phone || '0000000000',
          }));
        }

        const [alreadyMerchant] = await tx
          .select({ id: schema.merchants.id })
          .from(schema.merchants)
          .where(eq(schema.merchants.userId, user.id))
          .limit(1);
        if (alreadyMerchant) {
          throw new AppError('CONFLICT', 409, 'This account is already registered as a merchant');
        }

        const [created] = await tx
          .insert(schema.merchants)
          .values({
            companyName: body.companyName,
            contactName: body.contactName || user.displayName || 'Admin Granted',
            phone: body.phone || user.phone || '0000000000',
            businessAddress: body.businessAddress || 'Not Provided',
            userId: user.id,
            // Unlike self-serve /v1/merchant/signup (pending approval by default),
            // an admin creating this record here IS the approval — no separate
            // activation step needed.
            isActive: true,
            demoData: true,
          })
          .returning();

        await tx.insert(schema.merchantCredits).values({
          merchantId: created.id,
          balance: 0,
        });

        return created;
      });

      await assignMerchantToActiveDemoSets(app.db, client.id, req.userId);

      if (body.initialCredits && body.initialCredits > 0) {
        await merchantAdminGrant(
          // biome-ignore lint/suspicious/noExplicitAny: DB type narrowing
          app.db as any,
          client.id,
          body.initialCredits,
          'Initial grant',
          req.userId,
        );
      }

      return reply.code(201).send({ id: client.id });
    },
  );

  app.get(
    '/admin/merchants/:id',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN']) },
    async (req) => {
      const { id } = req.params as { id: string };

      const [client] = await app.db
        .select({
          id: schema.merchants.id,
          companyName: schema.merchants.companyName,
          contactName: schema.merchants.contactName,
          email: schema.users.email,
          phone: schema.merchants.phone,
          businessAddress: schema.merchants.businessAddress,
          isActive: schema.merchants.isActive,
          demoData: schema.merchants.demoData,
          kioskEnabled: schema.merchants.kioskEnabled,
          maxKioskDevices: schema.merchants.maxKioskDevices,
          userId: schema.merchants.userId,
          webhookUrl: schema.merchants.webhookUrl,
          webhookSecret: schema.merchants.webhookSecret,
          createdAt: schema.merchants.createdAt,
          updatedAt: schema.merchants.updatedAt,
          creditBalance: schema.merchantCredits.balance,
          emailVerified: schema.users.emailVerified,
          displayName: schema.users.displayName,
        })
        .from(schema.merchants)
        .innerJoin(schema.users, eq(schema.merchants.userId, schema.users.id))
        .leftJoin(
          schema.merchantCredits,
          eq(schema.merchants.id, schema.merchantCredits.merchantId),
        )
        .where(eq(schema.merchants.id, id))
        .limit(1);

      if (!client) throw new AppError('NOT_FOUND', 404, 'Merchant not found');

      const ledger = await app.db
        .select()
        .from(schema.merchantCreditLedger)
        .where(eq(schema.merchantCreditLedger.merchantId, id))
        .orderBy(desc(schema.merchantCreditLedger.createdAt))
        .limit(20);

      const recentJobs = await app.db
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status,
          creditsCharged: schema.jobs.creditsCharged,
          createdAt: schema.jobs.createdAt,
          completedAt: schema.jobs.completedAt,
        })
        .from(schema.jobs)
        .where(eq(schema.jobs.merchantId, id))
        .orderBy(desc(schema.jobs.createdAt))
        .limit(20);

      // Every merchant is a user with a merchants profile attached — always resolvable.
      const linkedUser = {
        id: client.userId,
        email: client.email,
        displayName: client.displayName,
        emailVerified: client.emailVerified,
      };

      const kioskDevices = await app.db
        .select()
        .from(schema.kioskDevices)
        .where(eq(schema.kioskDevices.merchantId, id))
        .orderBy(desc(schema.kioskDevices.createdAt));

      return {
        ...client,
        ledger,
        recentJobs,
        linkedUser,
        kioskDevices: kioskDevices.map(publicKioskDevice),
      };
    },
  );

  app.patch(
    '/admin/merchants/:id',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: AdminMerchantUpdateBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof AdminMerchantUpdateBody>;

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.isActive !== undefined) updates.isActive = body.isActive;
      if (body.demoData !== undefined) updates.demoData = body.demoData;
      if (body.companyName !== undefined) updates.companyName = body.companyName;
      if (body.contactName !== undefined) updates.contactName = body.contactName;
      if (body.phone !== undefined) updates.phone = body.phone;
      if (body.businessAddress !== undefined) updates.businessAddress = body.businessAddress;
      if (body.kioskEnabled !== undefined) updates.kioskEnabled = body.kioskEnabled;
      if (body.maxKioskDevices !== undefined) updates.maxKioskDevices = body.maxKioskDevices;
      if (body.webhookUrl !== undefined) {
        if (body.webhookUrl) assertWebhookUrlShape(body.webhookUrl);
        updates.webhookUrl = body.webhookUrl || null;
      }
      if (body.webhookSecret !== undefined) {
        updates.webhookSecret = body.webhookSecret || null;
      }
      if (body.logoKey !== undefined) {
        updates.logoKey = body.logoKey;
      }

      const [updated] = await app.db
        .update(schema.merchants)
        .set(updates)
        .where(eq(schema.merchants.id, id))
        .returning();

      if (!updated) throw new AppError('NOT_FOUND', 404, 'Merchant not found');

      if (body.demoData === true) {
        await assignMerchantToActiveDemoSets(app.db, id, req.userId);
      }

      return updated;
    },
  );

  app.post(
    '/admin/merchants/:id/logo/presign',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: z.object({ contentType: AssetContentType }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { contentType } = req.body as { contentType: string };
      const logoKey = keys.merchantLogo(id);
      const presign = await app.storage.presignPut(logoKey, contentType, 2_000_000, 300);
      return { uploadUrl: presign.url, logoKey };
    },
  );

  app.post(
    '/admin/merchants/:id/credits',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: AdminCreditBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { amount, reason } = req.body as z.infer<typeof AdminCreditBody>;

      await merchantAdminGrant(
        // biome-ignore lint/suspicious/noExplicitAny: DB type narrowing
        app.db as any,
        id,
        amount,
        reason,
        req.userId,
      );

      const [credits] = await app.db
        .select({ balance: schema.merchantCredits.balance })
        .from(schema.merchantCredits)
        .where(eq(schema.merchantCredits.merchantId, id))
        .limit(1);

      return { newBalance: credits?.balance ?? amount };
    },
  );
  app.post(
    '/admin/merchants/:id/kiosk-devices',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: AdminKioskDeviceBody },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { label } = req.body as z.infer<typeof AdminKioskDeviceBody>;
      const [client] = await app.db
        .select({ id: schema.merchants.id })
        .from(schema.merchants)
        .where(eq(schema.merchants.id, id))
        .limit(1);
      if (!client) throw new AppError('NOT_FOUND', 404, 'Merchant not found');

      const { device, pairingCode } = await createKioskDevice(app, id, label);
      reply.code(201);
      return { device: publicKioskDevice(device), pairingCode };
    },
  );

  app.patch(
    '/admin/merchants/:id/kiosk-devices/:deviceId',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: AdminPatchKioskDeviceBody },
    },
    async (req) => {
      const { id, deviceId } = req.params as { id: string; deviceId: string };
      const body = req.body as z.infer<typeof AdminPatchKioskDeviceBody>;
      const now = new Date();
      const [updated] = await app.db
        .update(schema.kioskDevices)
        .set({
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.status === 'revoked' ? { status: 'revoked', revokedAt: now } : {}),
          updatedAt: now,
        })
        .where(and(eq(schema.kioskDevices.id, deviceId), eq(schema.kioskDevices.merchantId, id)))
        .returning();
      if (!updated) throw new AppError('NOT_FOUND', 404, 'kiosk device not found');
      return publicKioskDevice(updated);
    },
  );

  app.post(
    '/admin/merchants/:id/kiosk-devices/:deviceId/pairing-code',
    { preHandler: requireAdmin(['SUPER_ADMIN']) },
    async (req) => {
      const { id, deviceId } = req.params as { id: string; deviceId: string };
      const pairingCode = generatePairingCode();
      const now = new Date();
      const [updated] = await app.db
        .update(schema.kioskDevices)
        .set({
          status: 'pending',
          pairingCodeHash: hashPairingCode(pairingCode),
          pairingCodeExpiresAt: new Date(now.getTime() + 15 * 60 * 1000),
          revokedAt: null,
          pairedAt: null,
          updatedAt: now,
        })
        .where(and(eq(schema.kioskDevices.id, deviceId), eq(schema.kioskDevices.merchantId, id)))
        .returning();
      if (!updated) throw new AppError('NOT_FOUND', 404, 'kiosk device not found');
      return { device: publicKioskDevice(updated), pairingCode };
    },
  );
}
