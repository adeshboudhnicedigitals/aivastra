import { randomBytes, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createSessionTokens } from './tokens.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export async function googleAuthRoutes(app: FastifyInstance) {
  // Skip if Google OAuth not configured
  if (!app.env.GOOGLE_CLIENT_ID || !app.env.GOOGLE_CLIENT_SECRET || !app.env.GOOGLE_CALLBACK_URL) {
    app.log.warn('Google OAuth not configured — /v1/auth/google/* routes disabled');
    return;
  }

  const clientId = app.env.GOOGLE_CLIENT_ID;
  const clientSecret = app.env.GOOGLE_CLIENT_SECRET;
  const callbackUrl = app.env.GOOGLE_CALLBACK_URL;
  const webUrl = app.env.WEB_URL;

  // ── Init ─────────────────────────────────────────────────────────────────
  app.get('/v1/auth/google/init', async (req, reply) => {
    // helmet's default Cross-Origin-Opener-Policy: same-origin severs
    // window.opener on any response in a popup's navigation chain — breaks
    // the merchant/shopper account-link flow, which relies on the popup
    // posting back to window.opener after this OAuth round trip completes.
    reply.header('Cross-Origin-Opener-Policy', 'unsafe-none');
    const { next } = req.query as { next?: string };
    const state = randomBytes(32).toString('base64url');
    reply.setCookie('google_state', state, {
      httpOnly: true,
      secure: app.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/v1/auth/google',
      // 5 minutes — long enough to survive Google's own consent/account-picker/2FA flow,
      // which routinely takes longer than the 60s this used to be set to, causing a
      // guaranteed INVALID_STATE on any login that isn't instant.
      maxAge: 300,
      signed: false,
    });
    if (next) {
      reply.setCookie('google_next', encodeURIComponent(next), {
        httpOnly: true,
        secure: app.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/v1/auth/google',
        maxAge: 300,
        signed: false,
      });
    }
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    return reply.redirect(url.toString(), 302);
  });

  // ── Callback ──────────────────────────────────────────────────────────────
  app.get('/v1/auth/google/callback', async (req, reply) => {
    reply.header('Cross-Origin-Opener-Policy', 'unsafe-none');
    const { code, state } = req.query as { code?: string; state?: string };
    const storedState = req.cookies.google_state;
    const next = req.cookies.google_next ? decodeURIComponent(req.cookies.google_next) : undefined;

    if (!code || !state || !storedState || state !== storedState) {
      throw new AppError('INVALID_STATE', 400, 'invalid OAuth state');
    }

    reply.clearCookie('google_state', { path: '/v1/auth/google' });
    if (next) reply.clearCookie('google_next', { path: '/v1/auth/google' });

    // Exchange code for Google access token
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok)
      throw new AppError('GOOGLE_TOKEN_FAILED', 400, 'Google token exchange failed');
    const { access_token: googleAccessToken } = (await tokenRes.json()) as { access_token: string };

    // Fetch Google user profile
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${googleAccessToken}` },
    });
    if (!userRes.ok)
      throw new AppError('GOOGLE_USERINFO_FAILED', 400, 'Google userinfo fetch failed');
    const googleUser = (await userRes.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
    };

    const [freePlan] = await app.db
      .select({ credits: schema.creditPlans.credits })
      .from(schema.creditPlans)
      .where(and(eq(schema.creditPlans.slug, 'free'), eq(schema.creditPlans.isActive, true)));
    const freeCredits = freePlan?.credits ?? 0;

    // Upsert user in a transaction
    const userId = await app.db.transaction(async (tx) => {
      // 1. Find existing OAuth link
      const [existing] = await tx
        .select({ userId: schema.oauthAccounts.userId })
        .from(schema.oauthAccounts)
        .where(
          and(
            eq(schema.oauthAccounts.provider, 'google'),
            eq(schema.oauthAccounts.providerId, googleUser.sub),
          ),
        );

      if (existing) {
        await tx
          .update(schema.oauthAccounts)
          .set({ displayName: googleUser.name, avatarUrl: googleUser.picture })
          .where(
            and(
              eq(schema.oauthAccounts.provider, 'google'),
              eq(schema.oauthAccounts.providerId, googleUser.sub),
            ),
          );
        const [user] = await tx
          .select({ isBanned: schema.users.isBanned })
          .from(schema.users)
          .where(eq(schema.users.id, existing.userId));
        if (user?.isBanned) throw new AppError('BANNED', 403, 'account banned');
        // Ensure emailVerified on every Google login (handles pre-existing unverified accounts)
        await tx
          .update(schema.users)
          .set({ emailVerified: true })
          .where(eq(schema.users.id, existing.userId));
        return existing.userId;
      }

      // 2. Find user by email (link Google to existing account)
      let uid: string;
      const [byEmail] = await tx
        .select({ id: schema.users.id, isBanned: schema.users.isBanned })
        .from(schema.users)
        .where(eq(schema.users.email, googleUser.email));

      if (byEmail) {
        if (byEmail.isBanned) throw new AppError('BANNED', 403, 'account banned');
        uid = byEmail.id;
        // Mark email as verified — Google confirmed ownership
        await tx.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, uid));
      } else {
        // 3. Create new user — Google accounts are pre-verified
        const [newUser] = await tx
          .insert(schema.users)
          .values({
            email: googleUser.email,
            passwordHash: null,
            displayName: googleUser.name ?? null,
            companyName: null,
            emailVerified: true,
            tier: 'free',
          })
          .returning({ id: schema.users.id });
        uid = newUser?.id;
        await tx.insert(schema.userCredits).values({ userId: uid, balance: 0 });
        if (freeCredits > 0) {
          await tx
            .update(schema.userCredits)
            .set({
              balance: sql`${schema.userCredits.balance} + ${freeCredits}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.userCredits.userId, uid));
          await tx
            .insert(schema.creditLedger)
            .values({ userId: uid, delta: freeCredits, reason: 'FREE_TRIAL' });
        }
      }

      // 4. Create OAuth link (onConflictDoNothing guards against concurrent inserts)
      await tx
        .insert(schema.oauthAccounts)
        .values({
          userId: uid,
          provider: 'google',
          providerId: googleUser.sub,
          email: googleUser.email,
          displayName: googleUser.name ?? null,
          avatarUrl: googleUser.picture ?? null,
        })
        .onConflictDoNothing();

      // Re-fetch the actual linked userId — handles the rare case where a concurrent
      // request already inserted the same (provider, providerId) pair.
      const [linked] = await tx
        .select({ userId: schema.oauthAccounts.userId })
        .from(schema.oauthAccounts)
        .where(
          and(
            eq(schema.oauthAccounts.provider, 'google'),
            eq(schema.oauthAccounts.providerId, googleUser.sub),
          ),
        );

      return linked?.userId;
    });

    // Issue one-time OTP for web handoff
    const otp = randomUUID();
    await app.redis.set(`oauth:otp:${otp}`, userId, 'EX', 60);

    const redirectUrl = new URL(`${webUrl}/api/auth/google/callback`);
    redirectUrl.searchParams.set('code', otp);
    if (next) redirectUrl.searchParams.set('next', next);
    return reply.redirect(redirectUrl.toString(), 302);
  });

  // ── Exchange ──────────────────────────────────────────────────────────────
  app.post(
    '/v1/auth/google/exchange',
    {
      schema: { body: z.object({ code: z.string().min(1) }) },
    },
    async (req, reply) => {
      const { code } = req.body as { code: string };
      const userId = await app.redis.getdel(`oauth:otp:${code}`);
      if (!userId) throw new AppError('INVALID_OTP', 400, 'invalid or expired OTP');
      return createSessionTokens(app, userId, reply, 200);
    },
  );
}
