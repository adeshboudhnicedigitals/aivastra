# Staging Environment VPS Provisioning Runbook

This document describes the manual, one-time VPS provisioning steps needed to set up the staging environment. The staging clone resides on the same VPS as production (`app.aivastra.com`), under a separate `aivastra-staging` Compose project, so the environment can be rebuilt without re-deriving these steps from scratch.

## 1. Reclaim build cache first

The box is at 80% disk (79 G free) and carries 176.8 G of reclaimable Docker build cache. Staging adds a second build pipeline to the same filesystem, so clear it before the first staging build:

```bash
docker system df                # confirm the reclaimable figure
docker builder prune -f         # frees ~176 G; next builds are slower, nothing else is lost
df -h /
```

**Note:** The host has a single `/dev/sda1` filesystem shared by Docker, CloudPanel sites and everything else — there is no separate Docker mount to fill independently.

## 2. Capacity baseline

Record before and after: `free -h`, `df -h /`, `docker system df`. Expected staging footprint: ~15.6 G of MinIO objects plus a ~205 MB database.

**Flag:** Swap is 2 GiB and already fully consumed, so watch `free -h` after staging's first boot — three other Compose projects (`propicly-prod`, `plane-app`, the stray local `aivastra`) share this host.

## 3. Clone

The staging clone is a sibling of the production clone so the guardrail's relative path resolves:

```bash
git clone https://github.com/adeshboudhnicedigitals/aivastra.git \
  /home/aivastra-app/htdocs/staging-app.aivastra.com
cd /home/aivastra-app/htdocs/staging-app.aivastra.com
git checkout dev
```

Production sits at `/home/aivastra-app/htdocs/app.aivastra.com` with `.env.production` at its root. If the staging path differs from the above, update the `../app.aivastra.com/.env.production` argument in `.github/workflows/ci.yml` to match.

## 4. Env file

```bash
cp .env.staging.example .env.staging
chmod 600 .env.staging      # prod's is 644; staging holds an unscrubbed snapshot's keys
# fill every change_me, then:
bash scripts/staging/check-staging-env.sh .env.staging ../app.aivastra.com/.env.production
```

`COMPOSE_PROJECT_NAME=aivastra-staging` is the one line that must never be copied from production — see Task 3. The script `scripts/staging/check-staging-env.sh` must pass before any deploy, or the build aborts.

## 5. GitHub secret

Add `STAGING_DEPLOY_PATH` = `/home/aivastra-app/htdocs/staging-app.aivastra.com`. `VPS_HOST`, `VPS_USER` and `VPS_SSH_KEY` are reused unchanged.

## 6. DNS + CloudPanel

Create **two** CloudPanel sites — `staging-app.aivastra.com` and `staging-admin.aivastra.com` — as reverse proxies to the ports below. Certificates go through CloudPanel's Let's Encrypt integration (`clpctl` 6.0.8), **not** raw certbot: only the unrelated `rankplex.cloud` uses certbot directly on this box, and everything else including `app.aivastra.com` is CloudPanel-managed. Vhost files land in `/etc/nginx/sites-enabled/`.

### Vhost port routing

| host | path | upstream |
|---|---|---|
| `staging-app.aivastra.com` | `/` | 3100 |
| | `/v1/` | 4100 |
| | `/minio/` | 9100 |
| | `/chatbot/` | 4300 |
| `staging-admin.aivastra.com` | `/` | 3101 |
| | `/admin/`, `/v1/` | 4100 |
| | `/shopify-admin` | 3103 |
| | `/chatbot/` | 4300 |

**Note:** Port 9101 (MinIO console) has no public vhost. It is bound to `127.0.0.1:9101` (see `infra/docker-compose.staging.yml`) for SSH-tunnel-only access, same as production's MinIO console on 9001 — neither is proxied through CloudPanel/nginx.

### ChatBot WebSocket configuration

The chatbot has no subdomain. It is mounted at `/chatbot/` on both vhosts so the web app and admin SPA each reach it same-origin. The trailing slash on `proxy_pass` is what strips the prefix — without it the chatbot receives `/chatbot/ws-ticket` and 404s. Both locations need WebSocket upgrade headers:

```nginx
location /chatbot/ {
    proxy_pass http://127.0.0.1:4300/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
}
```

**Critical:** `proxy_read_timeout` matters — the default 60s silently drops idle chat sockets.

## 7. Staging GPU worker — deferred

Staging ships with an empty `workers` table, so jobs enqueue and stay `QUEUED`. Nothing to configure now. When a dedicated ComfyUI box exists: provision it, install `cloudflared`, register it through the staging admin panel, restart the staging dispatcher, and add a matching INSERT to `scripts/staging/post-restore.sql` so the row survives the next sync.

## 8. Grafana Cloud

New free-tier account. Copy its Loki/Prometheus URLs, users and API key into `.env.staging`. Do not reuse production's.

## 9. First boot

```bash
docker compose -f infra/docker-compose.staging.yml --env-file .env.staging config | head -3
# MUST print: name: aivastra-staging
docker compose -f infra/docker-compose.staging.yml --env-file .env.staging up -d --build
docker compose -f infra/docker-compose.staging.yml --env-file .env.staging ps
```

**Critical:** Check the `config | head -3` output before the `up`. If it prints `aivastra-prod`, stop — `COMPOSE_PROJECT_NAME` is wrong and the next command would recreate production.

## 10. First sync

```bash
scripts/staging/sync-from-prod.sh --dry-run   # read every line
scripts/staging/sync-from-prod.sh
```

`PROD_ROOT` defaults to `/home/aivastra-app/htdocs/app.aivastra.com`; override it only if the layout changed. Expect the mirror to move ~15.6 G.

## 11. Re-sync cadence

Whenever staging data drifts too far to be useful. The environment is disposable — a broken staging database is fixed by re-running the sync, not by restoring a backup.
