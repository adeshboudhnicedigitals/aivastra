# Observability

Aivastra ships logs and metrics to **Grafana Cloud** (free tier) via a single **Grafana Alloy**
agent that runs as one container on the VPS. Apps stay light: they emit structured pino logs to
stdout (already the case) and expose a Prometheus `/metrics` endpoint. Nothing observability-
related is exposed to the public internet.

```
api  ──/metrics──┐
                 ├─ Alloy (scrape + docker log tail) ──► Grafana Cloud (Loki + Prometheus)
dispatcher /metrics┘
container stdout ─┘
```

Milestone 1 (this doc) = **logs + metrics + dashboards + alerts**. Distributed tracing + Sentry
error capture are Milestone 2.

## What is instrumented

**Metrics** (`packages/observability`, exposed at `GET /metrics`):

| Metric | Type | Source | Notes |
|--------|------|--------|-------|
| `http_request_duration_seconds` | histogram | api | labels `method,route,status`; `route` is the matched template |
| `jobs_created_total` | counter | api | label `priority` (priority\|normal) |
| `credits_deducted_total` / `credits_refunded_total` | counter | api | from the credit ledger |
| `jobs_processed_total` | counter | dispatcher | label `outcome` (success\|failed\|retried) |
| `job_processing_duration_seconds` | histogram | dispatcher | label `outcome`; dispatcher-only — timed from when the dispatcher claims the job off Redis, so it excludes queue wait |
| `job_e2e_duration_seconds` | histogram | dispatcher | label `outcome` (completed\|failed\|cancelled); true click-to-result time, `completedAt - createdAt`, includes queue wait. The gap between this and `job_processing_duration_seconds` is queue wait time |
| `job_attempts_total` | counter | dispatcher | one per real processing attempt |
| `comfy_request_duration_seconds` | histogram | dispatcher | submit → completion round-trip |
| `queue_depth` | gauge | dispatcher | label `stream`; sampled every 15s (XLEN) |
| `workers_healthy` | gauge | dispatcher | sampled on the health-monitor tick |
| `nodejs_*` / `process_*` | various | both | prom-client default metrics |

The api endpoint is `api:4000/metrics`; the dispatcher reuses its health server on
`dispatcher:4100/metrics` (bound `0.0.0.0` inside the container so Alloy can reach it over the
Docker network — no host port is published).

**Logs**: pino JSON on stdout. Alloy parses each line, promotes `level` to a Loki label, and
attaches `jobId` / `userId` as structured metadata. Filter in Grafana Explore with e.g.
`{job="aivastra", service="dispatcher"} | jobId="..."`.

## One-time Grafana Cloud setup

1. Create a free stack at <https://grafana.com>.
2. On the stack's **Connections → Details** (or "Send Metrics/Logs") page, copy:
   - Loki: push URL + username (numeric instance ID)
   - Prometheus: remote_write URL + username (numeric instance ID)
3. Create one **Access Policy token** with `logs:write` + `metrics:write`.
4. Fill these in `.env.production` (see `.env.production.example`):
   ```
   GRAFANA_CLOUD_LOKI_URL=
   GRAFANA_CLOUD_LOKI_USER=
   GRAFANA_CLOUD_PROM_URL=
   GRAFANA_CLOUD_PROM_USER=
   GRAFANA_CLOUD_API_KEY=
   ```
5. Deploy: `docker compose -f infra/docker-compose.prod.yml up -d alloy` (rebuild api +
   dispatcher first so they expose `/metrics`).
6. Verify: `docker logs aivastra-prod-alloy` shows no auth errors; in Grafana Cloud, Explore →
   Loki shows `{job="aivastra"}`, and Prometheus has `queue_depth` / `http_request_duration_seconds`.

## Testing locally

**Stage A — metrics endpoints (no credentials).** Confirms instrumentation:

```bash
pnpm docker:up
pnpm --filter @aivastra/api dev          # terminal 1
pnpm --filter @aivastra/dispatcher dev   # terminal 2
curl -s localhost:4000/metrics | grep -E "http_request|jobs_created|credits_"
curl -s localhost:4100/metrics | grep -E "jobs_processed|queue_depth|workers_healthy"
```

**Stage B — full pipeline to Grafana Cloud (needs the 5 `GRAFANA_CLOUD_*` vars in root `.env`).**
To exercise **logs and metrics** locally, run api + dispatcher as containers (Alloy's Docker
discovery can't see host-run `pnpm dev` processes). The `apps` profile runs them as containers on
the local infra network with `NODE_ENV=production` (so logs are JSON); the `observability` profile
runs Alloy, which scrapes `api:4000` / `dispatcher:4100` and tails their container logs.

```bash
# Stop `pnpm dev` first (containers and host apps are separate).
docker compose -f infra/docker-compose.yml --profile apps --profile observability up -d --build
docker logs -f aivastra-alloy            # expect no auth/remote_write errors
```

Then in Grafana Cloud:
- Explore → Prometheus: query `queue_depth`, `http_request_duration_seconds_count`.
- Explore → Loki: `{job="aivastra"}` — logs from `aivastra-api` / `aivastra-dispatcher`, filterable
  by `service` and (structured metadata) `jobId` / `userId`.

The containers reuse your dev Postgres/Redis/MinIO by service name and read the dev root `.env`
(the three host-only URLs — `DATABASE_URL`, `REDIS_URL`, `R2_ENDPOINT` — are overridden to
container hostnames in the compose file). Tear down with
`docker compose -f infra/docker-compose.yml --profile apps --profile observability down`.

## Dashboards

Import `infra/observability/dashboards/aivastra-overview.json` in Grafana
(**Dashboards → New → Import**), selecting your Prometheus data source. Panels: queue depth,
jobs by outcome, job duration p50/p95, E2E job latency p50/p95, workers healthy, HTTP request rate,
HTTP p95 latency, ComfyUI round-trip p50/p95.

### GPU boxes

Import `infra/observability/dashboards/aivastra-gpus.json` the same way. Panels: exporters up,
utilization, VRAM, temperature, power draw, throttling, SM clock, ECC/row-remap errors and a GPU
inventory table, with a `box` variable to pick boxes.

The data comes from `nvidia_gpu_exporter` (port 9835) on each GPU box, scraped by the **prod**
Alloy (`prometheus.scrape "gpus"` in `alloy.alloy`) and labelled `job="gpu"`, `box="gpuN"`. The
targets come from `ALLOY_GPU_TARGETS` in `.env.production` on the VPS (git-ignored, so box
addresses stay out of this public repo), a JSON array such as
`[{"__address__":"<host>:9835","box":"gpu1"}]`; unset means no scraping, which is what staging
gets. Add a box once its exporter is up and its firewall allows the VPS egress IP on 9835; the
box side lives in the aivastra-gpu ops repo, then recreate Alloy (`docker compose up -d alloy`).
Check with `up{job="gpu"}`.

**The dashboard JSON is not read from the repo.** Grafana keeps its own copy, so after editing
`aivastra-gpus.json` it must be re-imported (**Dashboards → New → Import**, same uid) for the change
to show.

**Host metrics (CPU, RAM, disk, network).** The dashboard also has a Host section. GPU boxes run
`node_exporter` (Ubuntu package `prometheus-node-exporter`, port 9100), scraped as `job="node"`
from `ALLOY_NODE_TARGETS` (same JSON format as above, port 9100). The backend VPS reports itself
through the built-in `prometheus.exporter.unix`; the prod Alloy mounts `/proc`, `/sys` and `/`
read-only for that and labels it `box="backend"`. Staging leaves `ALLOY_HOST_BOX` unset, so it
pushes nothing. Check with `up{job="node"}`. Series use `instance=<box>`, never the address.

## Alerts

Create these in Grafana Cloud (**Alerting → Alert rules**), wired to an email/Slack contact point:

| Alert | Condition (PromQL) |
|-------|--------------------|
| No healthy workers | `workers_healthy == 0` for 2m |
| Queue backing up | `sum(queue_depth) > 50` for 10m |
| Job failure rate high | `sum(rate(jobs_processed_total{outcome="failed"}[10m])) / sum(rate(jobs_processed_total[10m])) > 0.2` |
| API 5xx rate high | `sum(rate(http_request_duration_seconds_count{status=~"5.."}[5m])) > 0.5` |
| API p95 latency high | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m]))) > 2` |
| E2E latency high | `histogram_quantile(0.95, sum by (le) (rate(job_e2e_duration_seconds_bucket[10m]))) > 120` |
| Root disk almost full | `max by (box) (1 - node_filesystem_avail_bytes{job="node",mountpoint="/",fstype!~"tmpfs\|overlay\|squashfs"} / node_filesystem_size_bytes{job="node",mountpoint="/",fstype!~"tmpfs\|overlay\|squashfs"}) > 0.9` for 10m |
| Host memory pressure | `max by (box) (1 - node_memory_MemAvailable_bytes{job="node"} / node_memory_MemTotal_bytes{job="node"}) > 0.9` for 10m |
| GPU/host exporter down | `up{job=~"gpu\|node"} == 0` for 5m |

### ComfyUI execution-start timeout (Stage 1 with approved exhaustion cleanup)

These rules use the same Grafana Cloud provisioning procedure above. No runtime quarantine:
queue-budget exhaustion and unconfirmed/conservative cancellation release the worker and refund
through the caller. Exhaustion now attempts bounded scoped deletion and confirmation first;
a confirmed deletion still uses the terminal/refund policy. Enable the queue gate before validating capabilities.

| Alert | Condition (PromQL), any event in 5m |
|-------|-----------------------------------|
| Terminal queue-budget exhaustion after cleanup | `increase(comfy_queue_cleanup_failed_total[5m]) > 0` |
| Unconfirmed or conservative scoped cancellation | `increase(comfy_cancels_total{mode="conservative"}[5m]) > 0 or increase(comfy_cancels_total{mode="safe_scoped",outcome!="confirmed"}[5m]) > 0` |
| Live destructive authorization denied | `increase(comfy_destructive_calls_skipped_total[5m]) > 0` |
| Validated version missing or changed | `increase(comfy_version_guard_mismatches_total[5m]) > 0` |
| Capability read unreadable (all workers/contexts) | `increase(comfy_capability_read_unreadable_total[5m]) > 0` |
| Configured worker has no queue gate | `increase(comfy_capability_gate_drift_total[5m]) > 0` |
| Cancel ratchet after configuration loss | `increase(comfy_cancel_config_loss_total[5m]) > 0` |

Runtime key `config:comfy-timeout` contains JSON `{ "maxQueueWaitMs": 900000 }` when
Ops elect to enable the timeout feature. This value is a proposal, not a default.
A missing, malformed or non-positive budget keeps timeout polling in LEGACY. Optional
engineering fields are `queueStateUnknownGraceMs` (10000), `cancelConfirmationTimeoutMs`
(20000), `cancelAbsentRecheckMs` (2000), and `requestTimeoutMs` (5000); all must be
positive integers. The dispatcher reads them per submission. Following review scope approval,
`queueCleanupTimeoutMs` defaults to 30000 and must be at least
`queueStateUnknownGraceMs + 2 * 3000`. This default keeps the previously approved
max-queue-budget-only enablement usable while providing a finite cleanup bound.
Admin display reads emit warnings, while monitor reads own drift and unreadable alerts.

`GET/PUT/DELETE /admin/workers/:id/capabilities` reads/replaces/clears worker validation.
PUT accepts the three validation booleans, `validatedComfyVersion`, `validatedAt`, and
`validationReference`. Setting scoped-interrupt validation requires a reference to a
recorded two-real-prompts test on that worker/version. These are operator assertions;
mock tests never authorize production enablement. Partial revocation is immediate.
Complete clear, version change, protected rename or disabling the gate requires DRAINING;
the operator must separately verify that ComfyUI's queue is empty.

Queue-aware timeout requires identity and delete capabilities, a matching fresh version,
the gate and a valid queue budget. Safe scoped cancel requires all three capabilities and
a matching version, independently of budgets and the gate. Every submission now uses typed
completion handling and the rewritten loop; execution-vs-queue clocks split only when
the timeout feature is effective. RUNNING polls history only. Mid-flight LEGACY entry
starts a full execution allowance; a submission starting LEGACY keeps its original budget.

## Security: keep `/metrics` off the public internet

Alloy scrapes `/metrics` directly over the Docker network, so the endpoints do **not** need to be
publicly routable. The API is reverse-proxied by CloudPanel NGINX (`rankplex.cloud/v1/` →
`localhost:4000`). Add a deny rule in the API vhost so `/v1/metrics` is not exposed:

```nginx
location = /v1/metrics {
    return 403;
}
```

The dispatcher publishes no host port, so its `/metrics` is already private.
