# RECON_MAP.md

Red-team reconnaissance of aivastra_v1. Scope: high-risk trust boundaries (`apps/api`, `apps/dispatcher`, `packages/storage`). Date: 2026-06-09.

## Stack

| Layer    | Tech                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| Runtime  | Node 20+, TS 5.6, ESM, pnpm workspaces                                                  |
| API      | Fastify 5, `fastify-type-provider-zod`, jose (JWT HS256), @node-rs/argon2               |
| DB       | PostgreSQL 16, Drizzle ORM (parameterized)                                              |
| Queue    | Redis 7 Streams (`jobs:priority`/`jobs:normal`, group `dispatcher-cg`), Pub/Sub for SSE |
| Storage  | S3-compatible (R2 prod / MinIO dev), presigned PUT/GET                                  |
| Workers  | ComfyUI VPS over Cloudflare Tunnel, `X-Api-Key` auth, no inbound ports                  |
| Payments | Razorpay (HMAC-SHA256 signature verify)                                                 |
| Auth     | httpOnly refresh cookie + Bearer access JWT; Google OAuth (optional)                    |

## Services

1. **api** (`apps/api`) — auth, credits, catalog, job creation, admin, payments, results panel. Validates → atomic credit deduct → `jobs` insert → `XADD`. Binds `0.0.0.0:4000`.
2. **dispatcher** (`apps/dispatcher`) — only process touching GPU workers. `XREADGROUP` → claim worker (Lua) → R2 download → upload to ComfyUI → patch workflow → submit → poll WS → upload result → refund-on-failure.
3. **web/admin** — out of scope this pass.

## Trust Boundaries (data entry points)

| #   | Boundary                                                                 | File                                                            | Trust posture                                      |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------- |
| TB1 | Unauthenticated HTTP (login/register/refresh/reset/OAuth/payments-plans) | `auth/routes.ts`, `auth/google.routes.ts`, `payments/routes.ts` | Public                                             |
| TB2 | Authenticated user HTTP (jobs, uploads, catalogues, assets, me)          | `jobs/routes.ts`, `uploads/routes.ts`                           | Bearer JWT + emailVerified                         |
| TB3 | Admin HTTP (`/admin/*`)                                                  | `admin/*.routes.ts`                                             | JWT + `admin_users` row + role                     |
| TB4 | Results panel (`/results/*`)                                             | `results/routes.ts`                                             | Separate `results_access_token` cookie, admin-only |
| TB5 | User-controlled R2 keys (`upperGarmentKey`, `lowerGarmentKey`, `?key=`)  | `jobs.ts` types, `uploads/routes.ts`                            | **Weak — string, no namespace check**              |
| TB6 | Redis Stream message → dispatcher                                        | `stream/consumer.ts`, `job/processor.ts`                        | Trusts api-resolved keys                           |
| TB7 | ComfyUI worker responses                                                 | `comfyui/client.ts`                                             | Internal, API-key gated                            |
| TB8 | Razorpay callback signature                                              | `payments/routes.ts`                                            | HMAC verified                                      |
| TB9 | Google OAuth code/userinfo                                               | `auth/google.routes.ts`                                         | state-CSRF protected, OTP handoff                  |

## External Calls

- ComfyUI: `POST /prompt`, `GET /history`, `POST /upload/image`, `GET /view`, WS (worker URL from `WORKER_IDS` env — **not user-controlled**, so no SSRF from request input).
- Razorpay `api.razorpay.com/v1/orders` (Basic auth).
- Google `oauth2.googleapis.com`, `googleapis.com/oauth2/v3/userinfo`.
- Resend (email).

## Secrets Inventory

- `.env`, `.env.production`, `client_secret_*.json` present on disk, **all gitignored**; `git log --all` confirms **never committed**. Working-tree-only exposure.
- Secrets via env: `JWT_SECRET`, `COOKIE_SECRET` (min len 16), `R2_*`, `RAZORPAY_*`, `GOOGLE_*`, `RESEND_API_KEY`.
- Prod config: `CORS_ORIGIN=https://app.aivastra.com` (single origin, not wildcard), `R2_PUBLIC_URL=https://app.aivastra.com/minio/virtual-tryon-prod` (implies a public-read path — see THREAT_MODEL TM5).

## Recon Summary

- No raw string-concatenated SQL found — Drizzle `sql``` templates parameterize.
- Credit mutations bounded (`positive().max(10_000)`), atomic, idempotent refunds.
- The dominant risk theme is **object-storage authorization** (TB5): R2 keys are treated as opaque user strings with no ownership/prefix enforcement on read or job-input paths.

Step 1 complete. Findings so far: 0 critical, 2 high, 7 medium, 3 low (detailed in VULNERABILITY_REPORT.md).
