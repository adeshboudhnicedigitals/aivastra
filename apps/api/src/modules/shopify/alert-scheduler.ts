import { schema } from '@aivastra/db';
import { eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { sendLowCreditsEmail } from '../../lib/mailer.js';
import { buildPostInstallRedirect } from './auth.routes.js';
import { ALERT_LEVEL_RANK, type AlertLevel, computeRunway } from './runway.js';

/**
 * Deep link to the embedded app, for the email's "Add credits" button.
 *
 * SHOPIFY_API_KEY is optional in the env schema, and buildPostInstallRedirect
 * would happily produce `.../apps/` with an empty handle — a link that 404s the
 * merchant at the exact moment we are asking them to spend money. Fall back to
 * the shop's app list, which is one extra click but always works.
 */
function appLinkFor(app: FastifyInstance, shopDomain: string): string {
  const apiKey = app.env.SHOPIFY_API_KEY;
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/, '');
  return apiKey
    ? buildPostInstallRedirect(shopDomain, apiKey)
    : `https://admin.shopify.com/store/${storeHandle}/apps`;
}

interface SendEmailArgs {
  to: string;
  shopDomain: string;
  appUrl: string;
  level: 'warning' | 'critical' | 'empty';
  balance: number;
  tryOnsRemaining: number;
  daysRemaining: number | null;
}

async function defaultSendEmail(app: FastifyInstance, args: SendEmailArgs): Promise<void> {
  await sendLowCreditsEmail(app.env.RESEND_API_KEY, app.env.EMAIL_FROM, args.to, {
    shopDomain: args.shopDomain,
    appUrl: args.appUrl,
    level: args.level,
    balance: args.balance,
    tryOnsRemaining: args.tryOnsRemaining,
    daysRemaining: args.daysRemaining,
  });
}

interface TickDeps {
  sendEmail?: (app: FastifyInstance, args: SendEmailArgs) => Promise<void>;
}

/**
 * Evaluates every installed store's runway and emails the ones that have got
 * worse since we last told them.
 *
 * Escalation, not state: the email fires only when the current level ranks
 * strictly worse than `last_alert_level`. `last_alert_level` is then rewritten
 * unconditionally — including down to 'ok' — so a merchant who tops up is
 * automatically re-armed and will be warned again the next time they decline.
 * Storing "have we ever warned this store" instead would alert once per install
 * and then go quiet forever.
 *
 * One pass, continue past a single failure, never throw — mirrors the shape of
 * the billing sync tick this replaces.
 */
export async function runAlertTick(app: FastifyInstance, deps: TickDeps = {}): Promise<void> {
  const sendEmail = deps.sendEmail ?? defaultSendEmail;

  const stores = await app.db
    .select()
    .from(schema.shopifyStores)
    .where(isNull(schema.shopifyStores.uninstalledAt));

  for (const store of stores) {
    try {
      const runway = await computeRunway(app, store.id);
      const previous = (store.lastAlertLevel ?? 'ok') as AlertLevel;
      const worsened = ALERT_LEVEL_RANK[runway.level] > ALERT_LEVEL_RANK[previous];

      if (worsened && runway.level !== 'ok') {
        if (!store.shopEmail) {
          // Nothing we can do about it here — the address is captured at
          // install and refreshed on reinstall. Logged rather than silent so a
          // store that can never be reached is visible to an operator.
          app.log.warn(
            { storeId: store.id, shopDomain: store.shopDomain, level: runway.level },
            'low-credit alert not sent — store has no shop email on record',
          );
        } else {
          await sendEmail(app, {
            to: store.shopEmail,
            shopDomain: store.shopDomain,
            appUrl: appLinkFor(app, store.shopDomain),
            level: runway.level,
            balance: runway.balance,
            tryOnsRemaining: runway.tryOnsRemaining,
            daysRemaining: runway.daysRemaining,
          });
          app.log.info(
            { storeId: store.id, level: runway.level, balance: runway.balance },
            'low-credit alert sent',
          );
        }
      }

      await app.db
        .update(schema.shopifyStores)
        .set({
          lastAlertLevel: runway.level,
          // Only stamped when something was actually sent, so this stays a
          // record of "when we last contacted them" rather than "when the
          // scheduler last ran", which the logs already tell us.
          ...(worsened && runway.level !== 'ok' && store.shopEmail
            ? { lastAlertAt: new Date() }
            : {}),
        })
        .where(eq(schema.shopifyStores.id, store.id));
    } catch (err) {
      app.log.error({ err, storeId: store.id }, 'low-credit alert evaluation failed');
    }
  }
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Hourly is deliberate. Unlike a spend cap, where staleness has a direct dollar
 * cost, a runway measured in days does not become materially wrong inside an
 * hour — and a tighter interval would only increase the chance of emailing a
 * merchant twice about the same decline.
 *
 * Call once after `app.listen(...)`.
 */
export function startAlertScheduler(
  app: FastifyInstance,
  intervalMs: number = ONE_HOUR_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('alert tick still running — skipping this interval');
      return;
    }
    running = true;
    void runAlertTick(app)
      .catch((err) => {
        app.log.error({ err }, 'alert tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
