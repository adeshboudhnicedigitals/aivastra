import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('debug'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  R2_ENDPOINT: z.string().url(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET: z.string(),
  R2_PUBLIC_URL: z.string().url(),
  R2_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  DISPATCHER_HEALTH_PORT: z.coerce.number().default(4100),
  // How long a pending stream entry must be idle before recovery claims it (ms)
  XPENDING_CLAIM_THRESHOLD_MS: z.coerce.number().default(60_000),
  SENTRY_DSN: z.string().url().optional(),
  // Widget VPS — dedicated ComfyUI instance for widget try-on jobs
  WIDGET_COMFYUI_URL: z.string().url().optional(),
  WIDGET_COMFYUI_BASIC_AUTH: z.string().optional(), // "user:password"
});

export type Env = z.infer<typeof Env>;

export function loadEnv(): Env {
  return Env.parse(process.env);
}
