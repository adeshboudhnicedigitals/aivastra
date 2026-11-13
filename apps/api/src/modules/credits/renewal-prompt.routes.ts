// Renewal popup for the virtual try-on Android app. The app asks on every launch
// and resume; the server decides whether to show it and with what copy, so going
// live (or pulling it) never waits on a Play Store release.
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getActiveUnlimitedPlan } from './unlimited-plan.js';

const CONFIG_KEY = 'config:system';

export interface RenewalPromptConfig {
  enabled: boolean;
  startsAt: string | null;
  blocking: boolean;
  title: string;
  message: string;
  ctaLabel: string;
  supportWhatsapp: string | null;
  supportEmail: string | null;
}

// Off until an admin switches it on (Settings → Renewal popup), so deploying this
// changes nothing for anyone.
export const DEFAULT_RENEWAL_PROMPT: RenewalPromptConfig = {
  enabled: false,
  startsAt: null,
  blocking: true,
  title: 'Subscription Expired!',
  message:
    'Your AI Vastra subscription has expired. Please renew your subscription to continue using AI Vastra Virtual Try-On.',
  ctaLabel: 'Click Here to Renew',
  supportWhatsapp: '+91 7729883692',
  supportEmail: 'support@aivastra.com',
};

export async function readRenewalPromptConfig(app: FastifyInstance): Promise<RenewalPromptConfig> {
  const raw = await app.redis.get(CONFIG_KEY);
  const cfg = raw ? (JSON.parse(raw) as { renewalPrompt?: Partial<RenewalPromptConfig> }) : {};
  return { ...DEFAULT_RENEWAL_PROMPT, ...cfg.renewalPrompt };
}

export async function renewalPromptRoutes(app: FastifyInstance) {
  app.get('/v1/app/renewal-prompt', { preHandler: app.requireUser }, async (req) => {
    const cfg = await readRenewalPromptConfig(app);
    const live = cfg.enabled && (!cfg.startsAt || Date.parse(cfg.startsAt) <= Date.now());
    if (!live) return { show: false as const };
    // Anyone with a plan in force is exempt, paid or admin-granted alike — the popup
    // exists to move everyone else onto one.
    if (await getActiveUnlimitedPlan(app.db, req.userId)) return { show: false as const };
    // A credits user (starter/growth/pro/pay-as-you-go) with balance left is not "expired":
    // their try-ons run off credits, and the app has its own low-credit popup for when those
    // dwindle. Only someone with neither a plan nor credits is blocked.
    const [bal] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, req.userId));
    if ((bal?.balance ?? 0) > 0) return { show: false as const };
    return {
      show: true as const,
      blocking: cfg.blocking,
      title: cfg.title,
      message: cfg.message,
      ctaLabel: cfg.ctaLabel,
      supportWhatsapp: cfg.supportWhatsapp || null,
      supportEmail: cfg.supportEmail || null,
    };
  });
}
