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
  // Comma-separated: "worker-a,worker-b"
  WORKER_IDS: z.string().min(1),
  // How long a pending stream entry must be idle before recovery claims it (ms)
  XPENDING_CLAIM_THRESHOLD_MS: z.coerce.number().default(60_000),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(): Env {
  return Env.parse(process.env);
}

/** Read per-worker URL from env: WORKER_A_URL, WORKER_B_URL, etc. */
export function workerUrl(env: NodeJS.ProcessEnv, workerId: string): string {
  const key = `WORKER_${workerId.toUpperCase().replace(/-/g, '_')}_URL`;
  const val = env[key];
  if (!val) throw new Error(`Missing env var ${key} for worker ${workerId}`);
  return val;
}

/** Read per-worker API key from env: WORKER_A_API_KEY, WORKER_B_API_KEY, etc. */
export function workerApiKey(env: NodeJS.ProcessEnv, workerId: string): string {
  const key = `WORKER_${workerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  const val = env[key];
  if (!val) throw new Error(`Missing env var ${key} for worker ${workerId}`);
  return val;
}
