import { schema } from '@aivastra/db';
import { RegisterBody, WordpressLoginBody, type WordpressLoginResponse } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendVerificationEmail } from '../../lib/mailer.js';
import { resolveCampaignId } from '../auth/campaign.js';
import { findUserByIdentifier, makeToken } from '../auth/routes.js';
import { hashPassword, verifyPassword } from '../auth/service.js';
import { ensureMerchantForUser, mintWordpressKeyPair } from './wordpress-shared.js';

/**
 * The embedded, no-redirect WordPress connect path
 * (docs/wordpress-plugin-design.md §4.1): the plugin posts this
 * server-to-server (PHP wp_remote_post, never a browser) after collecting
 * email+password directly in wp-admin. Logs an existing, verified account in
 * and mints its keys in one request; registers a brand-new account the same
 * way /v1/auth/register does (reusing its verification-email mechanism)
 * rather than skipping verification — an unverified email must never be able
 * to mint a working API key, same invariant every other login path in this
 * codebase already enforces.
 */
export async function wordpressLoginRoutes(app: FastifyInstance) {
  const dummyHash = await hashPassword('__timing_dummy__');

  app.post(
    '/v1/merchant/wordpress-login',
    {
      schema: { body: WordpressLoginBody },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply): Promise<WordpressLoginResponse> => {
      const { email, password, siteUrl, siteName, displayName, phone } = req.body as z.infer<
        typeof WordpressLoginBody
      >;

      const user = await findUserByIdentifier(app, email);

      // Unlike /v1/auth/login this endpoint is deliberately "log in or sign
      // up with this email", so it must branch on account existence by
      // design (same as any "continue with email" flow) — there is no
      // enumeration-resistance to preserve on the not-found path the way a
      // login-only route needs.
      if (!user) {
        // WordpressLoginBody.password accepts any non-empty string (it also
        // carries a login attempt against an existing account), so a
        // brand-new account still needs /v1/auth/register's own complexity
        // check applied explicitly, here, before it's hashed and stored.
        const passwordCheck = RegisterBody.shape.password.safeParse(password);
        if (!passwordCheck.success) {
          throw new AppError(
            'VALIDATION',
            400,
            passwordCheck.error.issues[0]?.message ?? 'invalid password',
          );
        }

        const createdUser = await app.db.transaction(async (tx) => {
          const signupCampaignId = await resolveCampaignId(tx, 'wordpress_plugin');
          const passwordHash = await hashPassword(password);
          const [inserted] = await tx
            .insert(schema.users)
            .values({
              email,
              passwordHash,
              displayName: displayName || email.split('@')[0],
              companyName: null,
              tier: 'free',
              signupCampaignId,
            })
            .returning();
          if (!inserted) throw new AppError('INTERNAL', 500, 'failed to create user');
          await tx.insert(schema.userCredits).values({ userId: inserted.id, balance: 0 });
          await ensureMerchantForUser(tx, inserted.id, {
            companyName: siteName,
            contactName: displayName,
            phone,
          });
          return inserted;
        });

        const token = makeToken();
        await app.redis.set(`email:verify:${token}`, createdUser.id, 'EX', 86400);
        try {
          await sendVerificationEmail(
            app.env.RESEND_API_KEY,
            app.env.EMAIL_FROM,
            app.env.WEB_URL,
            email,
            token,
          );
        } catch (err) {
          app.log.error({ err }, 'Failed to send verification email (wordpress-login)');
        }

        reply.code(202);
        return { status: 'verification_required' };
      }

      // Existing account — same generic error/message for "banned", "no
      // password set" (e.g. a Google-only account) and "wrong password" as
      // /v1/auth/login uses, so none of those are distinguishable to a caller.
      if (user.isBanned || !user.passwordHash) {
        await verifyPassword(dummyHash, password); // constant-time: keep this branch's timing indistinguishable from a real compare
        throw new AppError('INVALID', 401, 'invalid credentials');
      }
      if (!(await verifyPassword(user.passwordHash, password))) {
        throw new AppError('INVALID', 401, 'invalid credentials');
      }

      if (!user.emailVerified) {
        const token = makeToken();
        await app.redis.set(`email:verify:${token}`, user.id, 'EX', 86400);
        try {
          await sendVerificationEmail(
            app.env.RESEND_API_KEY,
            app.env.EMAIL_FROM,
            app.env.WEB_URL,
            email,
            token,
          );
        } catch (err) {
          app.log.error({ err }, 'Failed to resend verification email (wordpress-login)');
        }
        throw new AppError('EMAIL_NOT_VERIFIED', 403, 'email not verified');
      }

      const connected = await app.db.transaction(async (tx) => {
        const { merchantId } = await ensureMerchantForUser(tx, user.id, {
          companyName: siteName,
          contactName: displayName,
          phone,
        });
        const [row] = await tx
          .select({
            companyName: schema.merchants.companyName,
            credits: schema.userCredits.balance,
          })
          .from(schema.merchants)
          .leftJoin(schema.userCredits, eq(schema.userCredits.userId, schema.merchants.userId))
          .where(eq(schema.merchants.id, merchantId))
          .limit(1);
        if (!row) throw new AppError('NOT_FOUND', 404, 'merchant not found');

        const { fullKey, widgetKey } = await mintWordpressKeyPair(
          tx,
          merchantId,
          siteUrl,
          siteName,
        );
        return { fullKey, widgetKey, companyName: row.companyName, credits: row.credits ?? 0 };
      });

      app.log.info({ userId: user.id, siteUrl }, 'wordpress plugin connected (embedded login)');
      reply.code(200);
      return { status: 'connected', ...connected };
    },
  );
}
