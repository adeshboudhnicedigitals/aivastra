import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { rotateTokenFamily } from '../auth/routes.js';
import { hashRefresh, newRefreshToken, signAccess } from '../auth/service.js';
import { parseDuration } from '../auth/tokens.js';
import { hashPairingCode } from './provisioning.js';

const KIOSK_REFRESH_EXPIRY = '30d';

const ClaimBody = z.object({
  pairingCode: z.string().min(1),
  appVersion: z.string().max(80).optional(),
  androidId: z.string().max(200).optional(),
});

const RefreshBody = z.object({
  refreshToken: z.string().min(1),
  appVersion: z.string().max(80).optional(),
});

const LogoutBody = z.object({ refreshToken: z.string().min(1) });

async function issueKioskTokens(app: FastifyInstance, kioskDeviceId: string) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);
  const accessToken = await signAccess(
    secret,
    kioskDeviceId,
    { kind: 'access' },
    app.env.JWT_EXPIRY,
    'kiosk',
  );
  const r = newRefreshToken();
  await app.db.insert(schema.refreshTokens).values({
    kioskDeviceId,
    familyId: randomUUID(),
    generation: 1,
    tokenHash: r.hash,
    expiresAt: new Date(Date.now() + parseDuration(KIOSK_REFRESH_EXPIRY)),
    portal: 'kiosk',
  });
  return { accessToken, refreshToken: r.plain };
}

export async function kioskAuthRoutes(app: FastifyInstance) {
  app.post(
    '/v1/kiosk/auth/claim',
    {
      schema: { body: ClaimBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { pairingCode, appVersion, androidId } = req.body as z.infer<typeof ClaimBody>;
      const codeHash = hashPairingCode(pairingCode);
      const now = new Date();

      const device = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.kioskDevices)
          .where(
            and(
              eq(schema.kioskDevices.pairingCodeHash, codeHash),
              gt(schema.kioskDevices.pairingCodeExpiresAt, now),
            ),
          )
          .for('update')
          .limit(1);
        if (!row) return null;

        const [updated] = await tx
          .update(schema.kioskDevices)
          .set({
            status: 'active',
            pairingCodeHash: null,
            pairingCodeExpiresAt: null,
            androidId: androidId ?? null,
            appVersion: appVersion ?? null,
            pairedAt: now,
            revokedAt: null,
            updatedAt: now,
          })
          .where(eq(schema.kioskDevices.id, row.id))
          .returning();
        return updated;
      });

      if (!device) throw new AppError('INVALID_PAIRING_CODE', 401, 'invalid pairing code');
      return issueKioskTokens(app, device.id);
    },
  );

  app.post(
    '/v1/kiosk/auth/refresh',
    {
      schema: { body: RefreshBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { refreshToken, appVersion } = req.body as z.infer<typeof RefreshBody>;
      const tokenHash = hashRefresh(refreshToken);
      const [refreshRow] = await app.db
        .select({
          userId: schema.refreshTokens.userId,
          kioskDeviceId: schema.refreshTokens.kioskDeviceId,
          merchantId: schema.refreshTokens.merchantId,
          portal: schema.refreshTokens.portal,
        })
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash))
        .limit(1);
      if (
        !refreshRow?.kioskDeviceId ||
        refreshRow.userId ||
        refreshRow.merchantId ||
        refreshRow.portal !== 'kiosk'
      ) {
        throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
      }

      const result = await rotateTokenFamily(app, refreshToken, 'kiosk', KIOSK_REFRESH_EXPIRY);
      if (result.kind === 'invalid' || result.ownerType !== 'kioskDevice') {
        throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
      }

      const [device] = await app.db
        .update(schema.kioskDevices)
        .set({
          lastSeenAt: new Date(),
          ...(appVersion !== undefined ? { appVersion } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.kioskDevices.id, result.ownerId), eq(schema.kioskDevices.status, 'active')),
        )
        .returning({ id: schema.kioskDevices.id });
      if (!device) throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');

      const secret = new TextEncoder().encode(app.env.JWT_SECRET);
      return {
        accessToken: await signAccess(
          secret,
          result.ownerId,
          { kind: 'access' },
          app.env.JWT_EXPIRY,
          'kiosk',
        ),
        refreshToken: result.kind === 'rotated' ? result.refreshPlain : null,
      };
    },
  );

  app.post(
    '/v1/kiosk/auth/logout',
    {
      schema: { body: LogoutBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { refreshToken } = req.body as z.infer<typeof LogoutBody>;
      const tokenHash = hashRefresh(refreshToken);
      const [row] = await app.db
        .select({
          familyId: schema.refreshTokens.familyId,
          kioskDeviceId: schema.refreshTokens.kioskDeviceId,
          portal: schema.refreshTokens.portal,
        })
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash))
        .limit(1);

      if (row?.portal === 'kiosk' && row.kioskDeviceId) {
        const kioskDeviceId = row.kioskDeviceId;
        await app.db.transaction(async (tx) => {
          await tx
            .update(schema.refreshTokens)
            .set({ revokedAt: new Date() })
            .where(eq(schema.refreshTokens.familyId, row.familyId));
          await tx
            .update(schema.kioskDevices)
            .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.kioskDevices.id, kioskDeviceId));
        });
      }

      return { ok: true };
    },
  );
}
