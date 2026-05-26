import { z } from 'zod';
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('debug'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
  R2_ENDPOINT: z.string().url(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET: z.string(),
  R2_PUBLIC_URL: z.string().url(),
  R2_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  /** Public-facing base URL for browser-side presigned uploads, e.g. https://rankplex.cloud/minio */
  R2_PUBLIC_PRESIGN_BASE: z.string().url().optional(),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(8).optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  COOKIE_SECRET: z.string().min(16),
});
export type Env = z.infer<typeof Env>;
export function loadEnv(): Env {
  return Env.parse(process.env);
}
