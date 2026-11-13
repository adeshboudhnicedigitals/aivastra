import { randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendMerchantInviteEmail } from '../../lib/mailer.js';
import { hashPassword } from './service.js';

// Account console, onboarding invite (spec §5.1). An admin-created merchant gets a single-use,
// 72h set-password link instead of a random password nobody knows. Same pattern as
// `email:reset:*`, with a per-user pointer so a resend invalidates the previous link.

const INVITE_TTL_S = 72 * 3600;
const tokenKey = (t: string) => `email:invite:${t}`;
const userKey = (id: string) => `email:invite:user:${id}`;

export type InviteStatus = 'pending' | 'accepted' | 'expired';

/** Issues a fresh token for the user and invalidates any earlier one. */
export async function issueInvite(app: FastifyInstance, userId: string): Promise<string> {
  const previous = await app.redis.get(userKey(userId));
  if (previous) await app.redis.del(tokenKey(previous));
  const token = randomBytes(32).toString('hex');
  await app.redis.set(tokenKey(token), userId, 'EX', INVITE_TTL_S);
  await app.redis.set(userKey(userId), token, 'EX', INVITE_TTL_S);
  return token;
}

/** Issues and emails an invite. A mail failure is reported, never thrown: the account exists. */
export async function sendInvite(
  app: FastifyInstance,
  user: { id: string; email: string; displayName: string | null },
  companyName: string,
): Promise<'sent' | 'failed'> {
  const token = await issueInvite(app, user.id);
  try {
    await sendMerchantInviteEmail(
      app.env.RESEND_API_KEY,
      app.env.EMAIL_FROM,
      app.env.MERCHANT_WEB_URL,
      user.email,
      token,
      companyName,
      user.displayName,
    );
    return 'sent';
  } catch (err) {
    app.log.error({ err, userId: user.id }, 'failed to send merchant invite email');
    return 'failed';
  }
}

/**
 * pending: a live link exists. accepted: the address is verified (an invite sets that, as does any
 * earlier sign-up). expired: unverified and no live link, so the console offers Resend.
 */
export async function inviteStatus(app: FastifyInstance, userId: string): Promise<InviteStatus> {
  if (await app.redis.get(userKey(userId))) return 'pending';
  const [u] = await app.db
    .select({ emailVerified: schema.users.emailVerified })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return u?.emailVerified ? 'accepted' : 'expired';
}

export async function inviteRoutes(app: FastifyInstance) {
  app.post(
    '/v1/auth/accept-invite',
    {
      schema: { body: z.object({ token: z.string().min(1), newPassword: z.string().min(8) }) },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { token, newPassword } = req.body as { token: string; newPassword: string };
      // getdel makes the link single-use even if two requests race.
      const userId = await app.redis.getdel(tokenKey(token));
      if (!userId) throw new AppError('INVALID_OR_EXPIRED_TOKEN', 400, 'invalid or expired token');
      await app.redis.del(userKey(userId));
      const passwordHash = await hashPassword(newPassword);
      await app.db
        .update(schema.users)
        .set({ passwordHash, emailVerified: true })
        .where(eq(schema.users.id, userId));
      await app.db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.userId, userId));
      return { ok: true };
    },
  );
}
