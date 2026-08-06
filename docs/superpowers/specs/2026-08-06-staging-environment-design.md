# Staging Environment on the Production VPS — Design

Date: 2026-08-06
Status: approved (design), not yet implemented

## Goal

A second, fully isolated environment on the same VPS as production, so changes can be
exercised against production-shaped data before they reach customers. Production must
keep working unchanged throughout.

## Decisions

These were settled during brainstorming and are not open for re-litigation during
implementation:

| Question | Decision |
|---|---|
| Data model | Snapshot copy. Staging runs its own Postgres, Redis and MinIO. |
| Asset seeding | Mirror everything except `inputs/*` (user garments) and `outputs/*` (results). |
| GPU workers | Dedicated staging ComfyUI worker. Staging never dispatches to a prod GPU. |
| Data scrubbing | None. The snapshot is a raw copy of production rows. |
| Branch flow | `feature → dev → main`. Merge to `dev` deploys staging; `dev → main` PR deploys prod. |
| Service scope | All 11 services, Alloy included, shipping to a separate Grafana Cloud account. |
| Reachability | `staging-*.aivastra.com` subdomains via new CloudPanel vhosts. |
| Pipeline shape | One workflow (`ci.yml`), deploy target parameterized by `github.ref`. |

## Non-goals

- No change to how production is built, migrated or deployed beyond the ref-based
  branching in the deploy job and one added env var on the Alloy service.
- No automatic prod → staging sync. The sync is a script an operator runs deliberately.
- No staging data flowing back to production, ever, in any direction.

---

## 1. Branch and pipeline

`.github/workflows/ci.yml` gains `dev` in both the `push` and `pull_request` branch
filters. The `detect`, `lint`, `typecheck`, `test` and `ci-scripts` jobs need no change —
none of them are ref-specific.

The `deploy` job resolves its target from `github.ref`:

| ref | compose file | env file | deploy path secret | concurrency group |
|---|---|---|---|---|
| `refs/heads/main` | `infra/docker-compose.prod.yml` | `.env.production` | `DEPLOY_PATH` | `aivastra-production` |
| `refs/heads/dev` | `infra/docker-compose.staging.yml` | `.env.staging` | `STAGING_DEPLOY_PATH` | `aivastra-staging` |

Implementation notes:

- The existing `if:` gate changes from `github.ref == 'refs/heads/main'` to a check that
  the ref is either `main` or `dev`. Everything else in that condition — the
  `!cancelled()` guard, the two `needs.*.result` checks, the event-name filter, the
  `has_deployable` check — stays exactly as written. The comment block above it explains
  why `!cancelled()` is load-bearing; keep it.
- A resolve step maps ref → `{COMPOSE_FILE, ENV_FILE, DEPLOY_PATH}` and writes them to
  `$GITHUB_ENV`. `DEPLOY_PATH` is selected between the two secrets in that step, so both
  secrets are referenced but only one is used.
- Concurrency becomes an expression on the resolved target name. Prod and staging deploys
  must never share a group — a staging deploy must not be able to cancel or queue behind a
  prod deploy.
- The SSH block's `git fetch ... main` becomes `git fetch ... $BRANCH` where `$BRANCH` is
  `main` or `dev`. The `git reset --hard $DEPLOY_SHA` behaviour is unchanged and still the
  reason the deployed SHA equals the tested SHA.

New GitHub secret: `STAGING_DEPLOY_PATH`. `VPS_HOST`, `VPS_USER` and `VPS_SSH_KEY` are
reused as-is — same box, same key. No GitHub Environments are introduced; moving the
existing repo-level secrets into an environment would change the production path for no
benefit.

## 2. Compose stack

New file `infra/docker-compose.staging.yml`, derived from `docker-compose.prod.yml` with
these differences and no others:

- `name: aivastra-staging`
- every `container_name` becomes `aivastra-staging-*`
- network renamed `aivastra-staging-net`
- env-file mounts point at `../.env.staging` (both the `api`/`chatbot` volume mounts and
  the `dispatcher` `env_file:`)
- host port bindings shifted (below)
- the `alloy` service gains `ALLOY_CONTAINER_REGEX: /aivastra-staging-.*`

Volume keys stay `pgdata`, `redisdata`, `miniodata`, `alloydata`. Compose namespaces
volumes by project name, so they materialise as `aivastra-staging_pgdata` and cannot
collide with the prod stack's `aivastra-prod_pgdata`.

Host ports are production + 100:

| service | prod | staging |
|---|---|---|
| web | 3000 | 3100 |
| admin | 3001 | 3101 |
| shopify-admin | 3003 | 3103 |
| api | 4000 | 4100 |
| chatbot | 4200 | 4300 |
| minio | 9000 | 9100 |
| minio console | 9001 | 9101 |

Staging api's host port 4100 is unrelated to the dispatcher's internal metrics port 4100;
that one is never published to the host, and the two live on different Docker networks.

All bindings stay on `127.0.0.1`, as in production. Public reach is via CloudPanel only.

## 3. Environment file and domains

`.env.staging` sits at the root of the staging clone, git-ignored and hand-created, the
same handling `.env.production` gets today. A committed `.env.staging.example` documents
it.

Values that must differ from production:

- `DATABASE_URL`, `REDIS_URL` — point at the staging containers (service names resolve
  inside `aivastra-staging-net`, so the URLs are textually similar; the isolation comes
  from the network, not the string)
- `POSTGRES_*`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` — independent credentials
- `JWT_SECRET`, `COOKIE_SECRET`, `SHOPIFY_TOKEN_ENC_KEY` — independent secrets. Note that
  because the DB is a raw prod copy, a *different* `SHOPIFY_TOKEN_ENC_KEY` renders the
  copied `shopify_stores` access tokens undecryptable in staging. That is the desired
  outcome: it means staging structurally cannot call a live merchant storefront, without
  needing a scrub step to achieve it.
- `WEB_URL`, `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL`, `CHATBOT_URL`,
  `NEXT_PUBLIC_CHATBOT_URL`, `VITE_CHATBOT_URL`, `VITE_AIVASTRA_APP_URL`,
  `VITE_API_BASE_URL`, `GOOGLE_CALLBACK_URL`, `SHOPIFY_APP_URL` — staging domains
- `RAZORPAY_*` — test-mode keys
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `VITE_SHOPIFY_API_KEY` — a separate Shopify
  dev app
- `RESEND_API_KEY`, `EMAIL_FROM` — non-production sender
- `GRAFANA_CLOUD_*` — the new free-tier Grafana Cloud account
- `WORKER_*` — the dedicated staging ComfyUI worker's tunnel URL and key
- `AIVASTRA_ENV=staging` — new marker, read only by the deploy guardrail (see §6). No
  application code reads it, so no code change is needed to introduce it.
- `VIDEO_CONCURRENCY=0` — see Open Questions

CloudPanel vhosts to create:

| host | path | upstream |
|---|---|---|
| `staging-app.aivastra.com` | `/` | 3100 |
| | `/v1/` | 4100 |
| | `/minio/` | 9100 |
| `staging-admin.aivastra.com` | `/` | 3101 |
| | `/admin/`, `/v1/` | 4100 |
| | `/shopify-admin` | 3103 |
| `staging-chatbot.aivastra.com` | `/` | 4300 (WebSocket upgrade) |

The staging clone is a separate checkout on the VPS at `STAGING_DEPLOY_PATH`, tracking
`dev`.

## 4. Observability separation

Alloy discovers containers off the Docker socket and currently keeps everything matching
`/aivastra-.*`. Both stacks run on the same host and both mount the same socket, so
without a change **each environment's Alloy would ingest the other's logs and metrics**.

`infra/observability/alloy.alloy` changes in two places:

- the `keep` rule's regex becomes `coalesce(sys.env("ALLOY_CONTAINER_REGEX"), "/aivastra-.*")`
- the `service` label regex widens to `/aivastra-(?:prod-|staging-)?(.*)` so the label is
  still just `api`, `dispatcher`, … in both environments

`infra/docker-compose.prod.yml` sets `ALLOY_CONTAINER_REGEX: /aivastra-prod-.*` on its
Alloy service; the staging compose sets `/aivastra-staging-.*`. The `coalesce` default
preserves current behaviour for the local `docker-compose.yml` stack, whose containers are
named `aivastra-*` with no environment segment.

Because staging Alloy writes to a different Grafana Cloud account entirely, no dashboard
or query in the production account needs an `env` filter added.

## 5. Data sync

`scripts/staging/sync-from-prod.sh`, run by an operator on the VPS. It is never invoked
from CI, and it never writes to production.

Steps:

1. `pg_dump -Fc` from `aivastra-prod-postgres`, reading credentials from
   `.env.production`. Read-only against prod; this is the only prod resource the script
   touches.
2. Drop and recreate the staging database, then `pg_restore` the dump into
   `aivastra-staging-postgres`.
3. `mc mirror` from the prod MinIO to the staging MinIO with
   `--exclude 'inputs/*' --exclude 'outputs/*'`. Everything else — `models/`, `catalog/`,
   `merchant-catalog/`, `demo-catalog/`, `saree/`, `saree-styles/`, `tryon/`,
   `sample-videos/`, `user-backgrounds/`, `config/`, `support/`, `merchant-logo/`, `dev/` —
   is copied. The exclusions are exactly the two prefixes that hold regenerable
   user-generated content, per `packages/storage/src/keys.ts`.
4. Apply `scripts/staging/post-restore.sql`: `DELETE FROM workers`, then insert the single
   staging ComfyUI worker row.
5. Re-run migrations against staging (`docker compose ... run --rm api pnpm db:migrate:prod`,
   which resolves `/app/.env` from the mounted `.env.staging`). The restore reset the
   schema to production's, so any migration that exists on `dev` but not on `main` has to
   be re-applied.
6. Restart the staging dispatcher so it re-reads the worker registry from the rewritten
   `workers` table.

Redis is deliberately not copied. Staging Redis starts empty; the job streams, consumer
group and worker registry are all rebuilt by the dispatcher on boot, and nothing durable
lives there that a snapshot would need to preserve.

Re-syncing is also the rollback story for staging: the environment is disposable, so a
broken staging database is fixed by running the script again rather than by restoring a
backup.

## 6. Deploy guardrails

The snapshot is unscrubbed, so it contains real customer emails, real merchant records and
real payment history. Nothing in the data prevents staging from acting on them; the
outbound credentials in `.env.staging` are the only barrier. The staging deploy therefore
aborts before touching any container unless `.env.staging` passes all of:

- contains a line `AIVASTRA_ENV=staging`
- contains no occurrence of `rzp_live_`
- `SHOPIFY_API_KEY` differs from the value in `.env.production`
- `EMAIL_FROM` is not the production sender address

These checks run inside the SSH block on the VPS, before `compose build`, and are fatal on
failure. They are cheap and they fail closed: a `.env.staging` accidentally copied from
production cannot deploy.

The distinct `SHOPIFY_TOKEN_ENC_KEY` described in §3 is a second, structural layer — even
if a guardrail were bypassed, copied Shopify tokens do not decrypt in staging.

## 7. Files touched

New:

- `infra/docker-compose.staging.yml`
- `scripts/staging/sync-from-prod.sh`
- `scripts/staging/post-restore.sql`
- `.env.staging.example`

Edited:

- `.github/workflows/ci.yml` — `dev` triggers, ref-based deploy target, concurrency
  expression, branch-aware fetch
- `infra/observability/alloy.alloy` — env-driven container filter, widened service regex
- `infra/docker-compose.prod.yml` — one `ALLOY_CONTAINER_REGEX` line on the Alloy service

Manual, outside the repo:

- `STAGING_DEPLOY_PATH` GitHub secret
- staging clone on the VPS, tracking `dev`
- `.env.staging` on the VPS
- three CloudPanel vhosts + DNS records + certs
- dedicated staging ComfyUI VPS with its own cloudflared tunnel
- new Grafana Cloud account

## 8. Verification

Staging is working when, in order:

1. A push to `dev` runs the full pipeline and deploys only to `STAGING_DEPLOY_PATH`, with
   prod containers untouched (`docker ps` shows unchanged prod uptimes).
2. `staging-app.aivastra.com` serves the web app and a login succeeds against
   snapshot data.
3. The admin panel at `staging-admin.aivastra.com` lists faces, backgrounds, poses and
   catalog items with images rendering — proving the MinIO mirror covered the admin
   asset prefixes.
4. A try-on job submitted in staging dispatches to the staging GPU worker and completes,
   with no entry appearing in the production `jobs` table.
5. Prod Grafana shows no `aivastra-staging-*` containers; the staging Grafana account
   shows no `aivastra-prod-*` containers.
6. A deliberately malformed `.env.staging` (prod Shopify key) is rejected by the deploy
   guardrail before any container is rebuilt.

## Open questions

- **PixVerse.** Deferred by decision. Staging shares the production PixVerse key, so a
  staging catalog-video job would bill the real account. Until this is resolved,
  `.env.staging.example` ships `VIDEO_CONCURRENCY=0` so the video lane never dispatches —
  the deferral fails closed rather than open. Resolving it means either a second PixVerse
  key or accepting the spend and raising the concurrency.
- **VPS capacity.** A second full stack roughly doubles container RAM and adds a second
  Postgres and MinIO data volume. Disk headroom should be checked against the size of the
  prod MinIO volume minus `inputs/` and `outputs/` before the first sync.
