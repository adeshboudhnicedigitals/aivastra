// "Update available" popup for the virtual try-on Android app. The app sends the
// versionCode it is running and the server decides, so the on/off switch, the target
// version and the copy all change from the admin panel without a Play Store release.
// Deliberately not Play's in-app-update API: that depends on per-device Play state,
// which skips some devices and can keep offering a build that is already installed.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const CONFIG_KEY = 'config:system';

export interface AndroidUpdateConfig {
  enabled: boolean;
  latestVersionCode: number;
  title: string;
  message: string;
  ctaLabel: string;
}

// Off until an admin switches it on (Settings → App update), so deploying this
// changes nothing for anyone.
export const DEFAULT_ANDROID_UPDATE: AndroidUpdateConfig = {
  enabled: false,
  latestVersionCode: 0,
  title: 'Update available',
  message:
    'A new version of AI Vastra is available. Please update to get the latest features and fixes.',
  ctaLabel: 'Update now',
};

export async function readAndroidUpdateConfig(app: FastifyInstance): Promise<AndroidUpdateConfig> {
  const raw = await app.redis.get(CONFIG_KEY);
  const cfg = raw ? (JSON.parse(raw) as { androidUpdate?: Partial<AndroidUpdateConfig> }) : {};
  return { ...DEFAULT_ANDROID_UPDATE, ...cfg.androidUpdate };
}

const Query = z.object({ versionCode: z.coerce.number().int().min(0).max(2_100_000_000) });

export async function appUpdatePromptRoutes(app: FastifyInstance) {
  // Public on purpose: the check runs on launch, before (and regardless of) login, and
  // reveals nothing but a version number the Play listing already shows.
  app.get('/v1/app/update-prompt', async (req) => {
    const parsed = Query.safeParse(req.query);
    // A missing or garbled versionCode means we can't compare, so say nothing rather
    // than nag every user.
    if (!parsed.success) return { show: false as const };
    const cfg = await readAndroidUpdateConfig(app);
    if (!cfg.enabled || parsed.data.versionCode >= cfg.latestVersionCode) {
      return { show: false as const };
    }
    return {
      show: true as const,
      latestVersionCode: cfg.latestVersionCode,
      title: cfg.title,
      message: cfg.message,
      ctaLabel: cfg.ctaLabel,
    };
  });
}
