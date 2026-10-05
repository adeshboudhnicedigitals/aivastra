import { randomBytes, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendWelcomeEmail } from '../../lib/mailer.js';
import {
  connectWordpressForUser,
  isTrustedWordpressCallback,
  mintWordpressConnectCode,
} from '../merchant/wordpress-shared.js';
import { resolveCampaignId } from './campaign.js';
import { resolveFreeCredits, upsertGoogleUser } from './google-upsert.js';
import { createSessionTokens } from './tokens.js';

/**
 * `next` for the WordPress "Continue with Google" path is the plugin's own
 * /connect/wordpress?state=&site_url=&site_name=&redirect_uri= consent-page
 * URL (handle_connect_start() in wordpress-plugin/admin/class-settings-page.php)
 * — kept in that exact shape even though the callback below skips ever
 * navigating to it, so a connect attempt that can't be completed
 * server-to-server (see the catch below) still falls back to the real page
 * unchanged. Parsed with the WHATWG URL parser (not hand-split) so percent-
 * encoding matches exactly what that PHP page's own `searchParams.get(...)`
 * reads once a browser does land there.
 */
function parseWordpressConnectNext(
  next: string,
): { state: string; siteUrl: string; siteName: string; redirectUri: string } | null {
  try {
    const url = new URL(next, 'http://internal.invalid');
    if (url.pathname !== '/connect/wordpress') return null;
    const state = url.searchParams.get('state');
    const siteUrl = url.searchParams.get('site_url');
    const redirectUri = url.searchParams.get('redirect_uri');
    if (!state || !siteUrl || !redirectUri) return null;
    return { state, siteUrl, siteName: url.searchParams.get('site_name') ?? '', redirectUri };
  } catch {
    return null;
  }
}

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
    const { next, src } = req.query as { next?: string; src?: string };
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
    if (src) {
      reply.setCookie('google_src', encodeURIComponent(src), {
        httpOnly: true,
        secure: app.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/v1/auth/google',
        maxAge: 300,
        signed: false,
      });
    } else {
      reply.clearCookie('google_src', { path: '/v1/auth/google' });
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
    const src = req.cookies.google_src ? decodeURIComponent(req.cookies.google_src) : undefined;

    // A failed round trip here previously surfaced as a raw JSON error page —
    // a dead end on mobile, where there's no back button affordance next to
    // the address bar the way desktop has. Redirect back to login with a
    // reason code instead so the user always lands somewhere they can retry.
    const failRedirect = (reason: string) => {
      reply.clearCookie('google_state', { path: '/v1/auth/google' });
      if (next) reply.clearCookie('google_next', { path: '/v1/auth/google' });
      if (src) reply.clearCookie('google_src', { path: '/v1/auth/google' });
      const url = new URL(`${webUrl}/login`);
      url.searchParams.set('error', reason);
      if (next) url.searchParams.set('next', next);
      return reply.redirect(url.toString(), 302);
    };

    if (!code || !state || !storedState || state !== storedState) {
      return failRedirect('google_invalid_state');
    }

    reply.clearCookie('google_state', { path: '/v1/auth/google' });
    if (next) reply.clearCookie('google_next', { path: '/v1/auth/google' });
    if (src) reply.clearCookie('google_src', { path: '/v1/auth/google' });

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
    if (!tokenRes.ok) return failRedirect('google_token_failed');
    const { access_token: googleAccessToken } = (await tokenRes.json()) as { access_token: string };

    // Fetch Google user profile
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${googleAccessToken}` },
    });
    if (!userRes.ok) return failRedirect('google_userinfo_failed');
    const googleUser = (await userRes.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
    };

    const { userId, isNewUser } = await app.db.transaction(async (tx) => {
      const campaignId = await resolveCampaignId(tx, src);
      const freeCredits = await resolveFreeCredits(tx, campaignId);
      return upsertGoogleUser(
        tx,
        {
          sub: googleUser.sub,
          email: googleUser.email.toLowerCase(),
          name: googleUser.name,
          picture: googleUser.picture,
        },
        freeCredits,
        campaignId,
      );
    });

    if (isNewUser) {
      try {
        await sendWelcomeEmail(app.env.RESEND_API_KEY, app.env.EMAIL_FROM, googleUser.email);
      } catch (err) {
        app.log.error({ err }, 'Failed to send welcome email');
      }
    }

    // WordPress "Continue with Google" skip-path: complete the connect
    // server-to-server and land straight back on wp-admin, instead of
    // routing the browser through app.aivastra.com/connect/wordpress's own
    // consent page first (wordpress-plugin/admin/class-settings-page.php's
    // handle_connect_start() doc comment explains why that page used to be
    // unavoidable — it no longer is, for this path). No WP-side change
    // needed: ensureMerchantForUser (wordpress-shared.ts) already treats
    // phone as optional, so this can finish a brand-new merchant's first
    // connection too, not just a returning one.
    if (src === 'wordpress_plugin' && next) {
      const parsed = parseWordpressConnectNext(next);
      if (parsed && isTrustedWordpressCallback(parsed.redirectUri, parsed.siteUrl)) {
        try {
          const payload = await app.db.transaction((tx) =>
            connectWordpressForUser(tx, userId, {
              siteUrl: parsed.siteUrl,
              siteName: parsed.siteName || undefined,
            }),
          );
          const code = await mintWordpressConnectCode(app.redis, payload);
          const wpRedirectUrl = new URL(parsed.redirectUri);
          wpRedirectUrl.searchParams.set('state', parsed.state);
          wpRedirectUrl.searchParams.set('code', code);
          return reply.redirect(wpRedirectUrl.toString(), 302);
        } catch (err) {
          // Merchant exists but deactivated, or some other connect-time
          // failure — fall through to the normal OTP/consent-page flow below
          // so the merchant still sees that page's own explanatory screen
          // (e.g. "Merchant account inactive") instead of a dead end here.
          app.log.warn(
            { err },
            'wordpress google connect skip-path failed, falling back to consent page',
          );
        }
      }
    }

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
      schema: {
        body: z.object({
          code: z.string().min(1),
          portal: z.enum(['web', 'catalog-app']).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { code, portal } = req.body as { code: string; portal?: 'web' | 'catalog-app' };
      const userId = await app.redis.getdel(`oauth:otp:${code}`);
      if (!userId) throw new AppError('INVALID_OTP', 400, 'invalid or expired OTP');
      if (portal === 'catalog-app') {
        const [merchant] = await app.db
          .select({ id: schema.merchants.id, isActive: schema.merchants.isActive })
          .from(schema.merchants)
          .where(eq(schema.merchants.userId, userId))
          .limit(1);
        if (!merchant?.isActive) {
          throw new AppError('NOT_A_MERCHANT', 403, 'This account has no Try On Library access.');
        }
      }
      return createSessionTokens(app, userId, reply, 200, portal ?? 'web');
    },
  );
}
