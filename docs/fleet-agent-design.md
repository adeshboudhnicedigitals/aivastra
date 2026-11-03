# Fleet agent and in-dashboard monitoring — design

Status: **design, nothing built.** Branch `feat/fleet-api-read`. Written 2026-11-02.
Thresholds and unit names below are starting points; Phase 0 discovery (`scripts/fleet/discover-box.sh`)
replaces guesses with facts before any of it is final.

## 1. Goal

Everything an on-call engineer needs to monitor, debug and operate the GPU workers is in the
`apps/gpu-ops` dashboard. No Grafana, SSH or provider consoles for routine work.

Non-goals: replacing Grafana for the VPS/API/dispatcher metrics that already flow there (they are
unchanged; the dashboard simply stops needing it for GPUs), and giving the dashboard arbitrary shell
access to a box (see 8).

## 2. What the existing evidence says (and the design must respect)

From `docs/progress.md` (2026-08-28 to 2026-08-30) and the current code:

- **Thermal collapse is fleet-wide.** Passively cooled Server Edition cards hold 85–88 °C under load
  and drop the SM clock from ~2,400 MHz to ~900 MHz. `nvidia-smi` reported clock throttle reasons
  `0x0` in all 568 samples, so the reason flag is unusable here. The signal has to be derived from
  temperature plus the SM-clock-to-max-clock ratio.
- **The boxes are rented VMs and shared pods** (a QEMU/KVM guest; gpu8 is a shared-GPU pod where
  `nvidia-smi` shows other tenants' load). Device-wide numbers are not "ours". Anything attributing
  load to us must come from per-process data, and must say "unknown" when that data is not visible.
- **RAM is oversubscribed fleet-wide** (e.g. 208 GB of models on 82 GB RAM), so swap and page-cache
  pressure matter.
- **How the dispatcher reaches workers is unverified** (the `cloudflared` claim was retracted; ports
  80/443/8443 are bound by something unconfirmed). Hence: **the agent only makes outbound connections.**
- Already built and kept: `worker:system:{id}` (ComfyUI `/system_stats` view, TTL 60 s),
  `worker:history:{id}` (1 h, 360 points), `GET /admin/fleet`, `GET /admin/fleet/workers/:id/history`,
  audited drain/undrain. The agent adds a second, independent view; it replaces none of these.

## 3. Architecture

```
GPU box                                    Aivastra (existing api + postgres + redis)
┌─────────────────────────┐  HTTPS, outbound  ┌────────────────────────────────────────┐
│ fleet-agent (systemd)   │ ── telemetry ────►│ POST /v1/fleet/agent/ingest            │
│  nvidia-smi, /proc, df, │   every 15 s      │   validate → Redis latest+recent       │
│  systemd, local ComfyUI │                   │            → Postgres history          │
│  /system_stats, /queue  │ ◄─ commands ──────│ GET  /v1/fleet/agent/commands (poll)   │
│                         │ ── results ──────►│ POST /v1/fleet/agent/commands/:id/result│
└─────────────────────────┘                   │ alert evaluator (api background loop)  │
                                              │   → incidents → dashboard + email      │
                                              └──────────────────┬─────────────────────┘
                                                                 ▼
                                                    gpu-ops (reads /admin/fleet/*)
```

Two independent liveness views are kept on purpose: the **dispatcher's probe** of ComfyUI and the
**agent's heartbeat**. Together they separate "box dead", "agent dead" and "ComfyUI dead".

## 4. Agent

- **Python 3, standard library only**, one file plus one systemd unit. Rationale: ComfyUI needs Python
  so it is on every box; nothing to compile or release. (Go would be faster and static but needs a build
  and distribution pipeline. Phase 0 confirms the Python version and `ssl`/`urllib` on each box.)
- Runs as an unprivileged user in its own systemd unit with `MemoryMax=64M`, `CPUQuota=10%`,
  `Restart=always`, `Nice=10`. It must never be able to harm ComfyUI.
- Reads only: `nvidia-smi --query-gpu`/`--query-compute-apps`, `/proc` (meminfo, loadavg, pressure),
  `os.statvfs`, `systemctl show` for **allowlisted units**, and the local ComfyUI
  `/system_stats` and `/queue` (it holds the ComfyUI key locally; the server never sees it).
- Config in `/etc/aivastra-agent.json`: `workerId`, ingest URL, agent key, and the **unit-name map**
  (`{"comfyui": "<unit>"}`). Commands refer to logical names; the server never sends a unit name, a
  path or a shell string.
- Spools up to 5 minutes of samples in memory when the API is unreachable and sends them on reconnect
  (oldest dropped first); history gaps beyond that are real gaps.

### 4.1 Telemetry payload (v1)

Unknown is `null`, never `0`. Hard limit 32 KiB. Unknown fields are rejected, not stored.

```jsonc
{
  "v": 1,
  "workerId": "tryon-worker-4",      // must equal the worker the key is bound to
  "agentVersion": "0.1.0",
  "bootId": "uuid-per-agent-start",
  "seq": 12345,                      // monotonic within a bootId
  "observedAt": 1793604695000,       // agent clock, ms; server records receivedAt and the skew
  "gpus": [{
    "index": 0, "name": "NVIDIA RTX PRO 6000 Blackwell Server Edition",
    "tempC": 86, "memTempC": null, "fanPct": null, "pstate": "P0",
    "smClockMhz": 899, "smClockMaxMhz": 2430, "memClockMhz": 14001,
    "powerW": 209.4, "powerLimitW": 600,
    "utilGpuPct": 100, "utilMemPct": 61,
    "vramUsedMib": 48240, "vramTotalMib": 97887,
    "throttleReasons": null,         // raw bitmask when supported; null when "N/A"
    "eccUncorrected": null
  }],
  "computeApps": [                   // may be empty on shared pods/VMs: that means "not visible"
    { "gpuIndex": 0, "name": "python", "vramMib": 47000 }   // name only, never arguments
  ],
  "host": {
    "cpuCount": 16, "load1": 3.2, "load5": 2.9, "load15": 2.4,
    "ramTotalMib": 84480, "ramAvailMib": 6100,
    "swapTotalMib": 8192, "swapUsedMib": 2300,
    "memPsiSome10": 0.0, "uptimeSec": 123456, "ntpSynced": true,
    "disks": [{ "mount": "/", "totalGb": 960, "usedGb": 710, "inodeUsedPct": 12 }]
  },
  "services": [ { "name": "comfyui", "active": "active", "sub": "running", "restarts": 0 } ],
  "comfy": [ { "instance": "main", "reachable": true, "running": 1, "pending": 0 } ]
}
```

### 4.2 Derived signals (computed server-side, so rules can change without redeploying agents)

| Signal | Definition (initial) |
|---|---|
| `clockRatio` | `smClockMhz / smClockMaxMhz` (null if either is null) |
| `thermalCollapse` | `clockRatio < 0.6` **and** `tempC >= 80`, sustained for the rule window |
| `foreignVramMib` | device `vramUsedMib` minus the sum of `computeApps.vramMib`, **only** when `computeApps` is non-empty; otherwise `null` (unknown) |
| `clockSkewMs` | `receivedAt - observedAt` (includes network time; a persistent large value means a wrong clock) |

## 5. Ingest API (`apps/api/src/modules/fleet/`) — implemented

Not an admin route and not browser-facing: no CORS, no cookies. Contract:
`packages/types/src/fleet-agent.ts`. Tests: `apps/api/test/fleet-agent-schema.test.ts` and
`apps/api/test/integration/fleet-agent-ingest.test.ts`.

- **Auth:** `Authorization: Bearer fa_<43 chars base64url>`. The server stores `sha256(key)` only, bound
  to one `worker_id`. Auth runs in `preValidation`, before the body is validated, so a stranger learns
  nothing about the schema. Unknown, malformed and revoked keys all get the same `401 UNAUTHORIZED`.
  A payload `workerId` that differs from the key's worker gets `403 WORKER_MISMATCH`.
- **Keys:** created and revoked by SUPER_ADMIN (`fleet.operate`) via
  `POST /admin/fleet/workers/:id/agent-keys` and `DELETE /admin/fleet/agent-keys/:keyId`, each with an
  audit row (`fleet.agent_key.create` / `.revoke`) that holds the prefix and label, never the key or hash.
  The plaintext is returned once. At most 3 active keys per worker (rotation = create, redeploy, revoke).
- **Idempotency:** `(worker_id, boot_id, seq)` is unique; a replay answers `200 {duplicate:true}`.
- **Limits:** 30 requests/min per key (4/min is the normal cadence; the rest is headroom for flushing
  up to 5 minutes of spooled samples), 32 KiB body (`413`), strict schema (`400 VALIDATION`, counted
  per worker), sample time within -10 min / +2 min of server time (`422 CLOCK_SKEW`, with `serverTime`).
- **Response:** `{ ok, duplicate, serverTime, commandsPending }`. `commandsPending` is always 0 until
  the control channel exists.
- **Write path:** Redis first (`fleet:agent:{id}` heartbeat, TTL 90 s; `fleet:latest:{id}`, TTL 60 s,
  replaced only by a newer `observedAt` via compare-and-set so a spool flush cannot move the live view
  backwards), then Postgres in one transaction (host row = idempotency anchor, then GPU rows). A Postgres
  failure answers `503 INGEST_UNAVAILABLE` so the agent retries from its spool; the heartbeat and live
  view stay current meanwhile.
- **Read views (`fleet.view`):** `GET /admin/fleet/workers/:id/agent` (keys, heartbeat, rejects in the
  last hour) and `GET /admin/fleet/workers/:id/telemetry` (latest sample, `stale`, clock skew, derived
  per-GPU signals). The sample is `null` when nothing was reported, never an empty sample.

## 6. Storage (Postgres via the normal migration pipeline; never ad hoc on production)

Implemented in migration `0241_fleet_agent_telemetry`: `fleet_agents`, `fleet_host_samples`, `fleet_gpu_samples`
(the per-GPU sample table is one row per GPU per sample; there is no rollup, incident, command or host
inventory table yet).

| Table | Purpose / key columns |
|---|---|
| `fleet_agents` | `worker_id` unique, `key_hash` unique, `key_prefix` (display), `created_at`, `rotated_at`, `revoked_at`, `last_seen_at`, `agent_version`, `boot_id`, `clock_skew_ms` |
| `fleet_gpu_samples` | one row per worker, sample and GPU: typed columns for every plotted field + `observed_at`, `received_at`, `boot_id`, `seq`. Unique `(worker_id, boot_id, seq, gpu_index)`. Index `(worker_id, observed_at)`. |
| `fleet_host_samples` | one row per worker and sample: load, RAM, swap, PSI, root-disk and inode %, service states as `jsonb`. |
| `fleet_gpu_rollups_1m`, `fleet_host_rollups_1m` | per-minute avg/min/max written by a rollup loop. |
| `fleet_alert_rules` | `key` pk, `severity`, `params jsonb`, `for_seconds`, `enabled`, `updated_by`, `updated_at` |
| `fleet_incidents` | `rule_key`, `worker_id`, `state` (`OPEN`/`ACK`/`RECOVERED`), `severity`, `opened_at`, `acked_at/by`, `recovered_at`, `summary`, `evidence jsonb` (a snapshot taken when it opened). Partial unique index on `(rule_key, worker_id)` where state is not `RECOVERED` — the dedupe. |
| `fleet_incident_events` | append-only timeline: opened, ack, note, recovered, reopened. |
| `fleet_commands` | see 8. |
| `fleet_hosts`, `fleet_host_workers` | inventory (provider, GPU model, region, notes) and the worker-to-host mapping, editable in the dashboard. |

**Retention: raw-sample deletion is implemented** (`apps/api/src/modules/fleet/retention.ts`, 48 h window,
bounded batches); the 1-minute rollups below are not built yet. Design:

**Retention** (loops in `apps/api/src/main.ts`, same style as the existing sweepers: `setInterval`, a
re-entrancy guard, an exported tick, and an advisory lock so two api processes do not both run it):
raw samples 48 h, 1-minute rollups 30 days, resolved incidents kept. Volume at 15 s intervals for 7
boxes is roughly 40,000 rows/day per table, which is small for Postgres.

Migration numbers are assigned at implementation time (this branch is at `0240`; `dev` will have moved).

## 7. Alerting and incidents (replaces the fixture "Incidents" page)

An evaluator loop runs every 15 s over the latest data. A rule fires after its condition holds for
`for_seconds`, recovers after it has been clear for the same window (hysteresis, so flapping does not
spam), and writes `fleet_incidents` plus a timeline event. Delivery: dashboard banner and incident list,
plus email through the existing Resend setup to a configured list. WhatsApp is a later option.

| Rule (initial values) | Fires when |
|---|---|
| `agent_silent` | no heartbeat for 90 s (warn), 5 min (critical) |
| `comfy_down_box_up` | dispatcher probe `UNREACHABLE` for 60 s while the agent heartbeats |
| `box_unreachable` | agent silent **and** probe unreachable for 2 min |
| `thermal_collapse` | `thermalCollapse` for 3 min |
| `gpu_temp_high` | `tempC >= 88` for 5 min (warn) |
| `disk_high` | disk or inode use >= 90% |
| `swap_active` | swap used > 1 GiB for 10 min |
| `ram_low` | available RAM < 10% for 5 min |
| `foreign_vram` | `foreignVramMib` > 4 GiB for 5 min (info; shared pods) |
| `clock_skew` | skew > 30 s for 5 min |
| `queue_stuck` | a lane has waiting entries whose oldest is older than 10 min while a healthy idle worker exists |
| `failure_spike` | >= 3 failures and >= 50% of a worker's jobs in 15 min |
| `agent_outdated` | version below the configured minimum |
| `ingest_rejected` | repeated invalid payloads from one key |

Acknowledging and noting an incident writes an audit row. Who may acknowledge is an open question (11).

## 8. Control channel (built last)

Commands are the highest-risk part, so the design is deliberately narrow.

- **Allowlist only:** `comfyui.start`, `comfyui.stop`, `comfyui.restart`, `logs.collect`, `agent.restart`.
  No arbitrary command, argument or path ever comes from the server. The agent maps `comfyui` to the unit
  named in its own local config.
- **Flow:** dashboard → `POST /admin/fleet/workers/:id/commands` (permission `fleet.operate`, a typed
  reason, an audit row in the same transaction) → row `QUEUED` → agent polls outbound → `RUNNING` →
  `SUCCEEDED` / `FAILED`. A command expires after 2 minutes unless picked up; the agent also refuses one
  whose `expires_at` has passed.
- **Server-side preconditions:** stop/restart require the worker to be `DRAINING` and to hold no
  reservation or running prompt, unless the operator sets `force` with an extra confirmation that shows
  what will be interrupted. Restart does not undrain; the operator does that.
- **`logs.collect`:** the agent returns the last N lines of the allowlisted unit's journal, redacted
  (tokens, keys, `Authorization`, emails), capped at 200 KiB, stored 24 h, shown in the dashboard. This
  is "debug without SSH".
- `fleet.operate` is SUPER_ADMIN only today; widening it is a one-line migration, narrowing is not.

## 9. Security checklist

- Outbound-only agent; no new inbound port on any box.
- Per-worker keys, hashed at rest, rotatable, revocable, bound to one `worker_id`.
- Strict schema with field allowlists; the agent sends names and numbers only, never command lines,
  environment, paths or UUIDs/serials (same discipline as `extractSystemSample`).
- Ingest rate-limited and size-capped; a flood from one key cannot starve others.
- Commands: allowlist, local unit-name map, expiry, reason, audit, server-side preconditions.
- Admin reads of fleet data require `fleet.view`; writes require `fleet.operate`.
- Nothing in this design writes to production data outside the migration pipeline.

## 10. Rollout

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | `scripts/fleet/discover-box.sh` run on all 7 boxes | reports collected; Python/ssl, `nvidia-smi` field support, process visibility, egress to the API, who owns ports 80/443/8443 all known per box |
| 1 | agent v0 on **one** box in shadow mode; ingest + latest panels | numbers match `nvidia-smi` by eye for a day; no impact on ComfyUI latency |
| 2 | history tables, rollups, charts; alert evaluator; incidents; email | thermal collapse and a pulled agent are each detected and recovered in a staged test |
| 3 | rollout to all boxes; per-box key rotation tested | 7/7 reporting; one key rotated without data loss |
| 4 | control commands + log collection | restart of a drained test worker works end to end, audited |
| 5 | inventory editor, evidence page | hosts editable; Grafana links removed from the live UI |

Testing: payload/schema unit tests; ingest integration tests (auth, wrong-worker key, replay, rate limit,
oversize, Postgres-down path); agent tests against **recorded** `nvidia-smi` outputs from each box type
(fixtures captured in Phase 0), including `N/A` and empty-process cases; rule tests with synthetic series,
including flapping.

## 11. Open questions

1. Where do the agent and installer live long-term: here (`apps/fleet-agent`) or `aivastra-gpu`? Default: here, so the ingest contract and the agent version together.
2. Who may acknowledge incidents: `fleet.operate` (SUPER_ADMIN only) is too narrow for on-call; a separate `fleet.ack` held by ADMIN is likely right.
3. Email recipients and where the list is configured (a system-config key, name to be chosen).
4. Do any boxes run more than one ComfyUI instance on the same GPU (gpu1 was meant to)? That makes GPU-to-worker many-to-one and needs `instance` in the payload (already reserved in `comfy[]`).
5. Provider rules: some hosts may forbid custom services or restrict egress. Phase 0 shows which.
