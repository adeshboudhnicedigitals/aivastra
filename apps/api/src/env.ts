import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('debug'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('1h'),
  R2_ENDPOINT: z.string().url(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET: z.string(),
  R2_PUBLIC_URL: z.string().url(),
  R2_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  /** Endpoint used for presigned URL signing (SigV4 Host header). Set to the public
   *  domain when MinIO is behind a reverse proxy so the signed Host matches the
   *  header forwarded by Nginx. Falls back to R2_ENDPOINT when omitted. */
  R2_SIGN_ENDPOINT: z.string().url().optional(),
  /** Public-facing base URL for browser-side presigned uploads, e.g. https://rankplex.cloud/minio */
  R2_PUBLIC_PRESIGN_BASE: z.string().url().optional(),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(8).optional(),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((s) =>
      s
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  COOKIE_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1).default('noreply@aivastra.com'),
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),
  CHATBOT_URL: z.string().url().optional(),
  CHATBOT_SERVICE_TOKEN: z.string().optional(),
  SHOPIFY_API_KEY: z.string().optional(),
  SHOPIFY_API_SECRET: z.string().optional(),
  // Used to build the OAuth redirect_uri (/v1/shopify/auth/callback) — must be a
  // host that proxies /v1/* to this API, NOT necessarily where the embedded admin
  // SPA itself is served (see SHOPIFY_ADMIN_URL below).
  SHOPIFY_APP_URL: z.string().url().optional(),
  // Where the embedded admin SPA (apps/shopify) is actually served — used for the
  // post-install redirect. Falls back to SHOPIFY_APP_URL when unset (dev: both
  // point at the same ngrok tunnel, so no split is needed there).
  SHOPIFY_ADMIN_URL: z.string().url().optional(),
  SHOPIFY_SCOPES: z.string().default('read_products'),
  // 32-byte key, base64-encoded (44 chars). Required only when Shopify is enabled.
  SHOPIFY_TOKEN_ENC_KEY: z.string().optional(),
});
export type Env = z.infer<typeof Env>;
export function loadEnv(): Env {
  return Env.parse(process.env);
}
