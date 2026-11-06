// Renewal popup for the virtual try-on Android app. The app asks on every launch
// and resume; the server decides whether to show it and with what copy, so going
// live (or pulling it) never waits on a Play Store release.
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
    // Anyone with a plan in force is exempt, paid or admin-granted alike — the popup
    // exists to move everyone else onto one.
    const show = live && !(await getActiveUnlimitedPlan(app.db, req.userId));
    if (!show) return { show: false as const };
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
