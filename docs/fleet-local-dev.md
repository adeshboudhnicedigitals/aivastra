# GPU fleet dashboard: running it locally against the real GPUs

Local development only. None of this runs in production; the production design (an agent on each
box reporting to the API) is in `fleet-agent-design.md`.

## What runs

| Piece | Command | Purpose |
|---|---|---|
| API | `pnpm --filter @aivastra/api dev` | serves `/admin/fleet/*`, runs the evaluator (15 s) and rollups (60 s) |
| Dispatcher | `pnpm --filter @aivastra/dispatcher dev` | probes each worker and writes `worker:health:*` |
| Collector | `pnpm --filter @aivastra/api fleet:collect` | stands in for the agent: SSHes to each box every 15 s and posts telemetry to the local API |
| Dashboard | `pnpm --filter @aivastra/gpu-ops dev` | the UI, with `VITE_FLEET_API_URL=http://127.0.0.1:4000` |

The API's `CORS_ORIGIN` must include the dashboard's origin.

## Collector (`apps/api/scripts/fleet-ssh-collector.mts`)

- Reads `~/.ssh/config` aliases `w1`..`w7`. Boxes are mapped to worker ids in `WORKER_IDS`.
- **Read-only on the boxes**: `nvidia-smi`, `/proc`, `df`, `systemctl is-active`, `journalctl`, and a
  loopback request to ComfyUI's `/queue` reduced to two counts. Nothing is written or installed.
- Refuses to run unless `DATABASE_URL` and the API are on localhost, and never creates or deletes
  worker rows. The workers must already exist (see the importer below).
- `-- --once` collects a single round; `-- --cleanup` deletes only the collector's own keys,
  samples, rollups and incidents.
- `FLEET_LOG_WINDOW` (default `30 min ago`) is how far back it looks for ComfyUI error lines.
  Only lines matching error|traceback|exception|out of memory|oom|failed are kept (max 40 lines of
  300 characters), ANSI codes and control characters are removed, and values after
  `api_key|token|secret|password|authorization` are redacted.
- GPU slowdown counters (`clocks_event_reasons_counters.*`) are cumulative microseconds. They are
  rolled up per minute; the dashboard charts the rise between buckets, and the `thermal_slowdown`
  rule uses the rise over the last 15 minutes. A counter that falls (driver reload) or a window
  with fewer than two readings is "unknown", never "fine".

## Importer (`apps/api/scripts/fleet-import-workers.mts`)

Copies worker rows into the **local** database from JSON on stdin (it refuses a non-local
`DATABASE_URL`) and prints only id, url, active, job types and key length, never keys. To copy from
production use a read-only transaction on the production side, for example
`PGOPTIONS='-c default_transaction_read_only=on'`.

## Alert emails

Managed in the dashboard (Alert rules page, super admin only, audited). A list saved there wins,
and an empty saved list means off on purpose. With nothing saved, the server's `FLEET_ALERT_EMAILS`
applies, and with neither nothing is ever sent. That default matters because the dev `.env` holds a
real `RESEND_API_KEY`. Only warning and critical incidents are mailed (open, escalate, recover);
info incidents stay on the dashboard. `FLEET_DASHBOARD_URL` adds a link to the email.

## Control commands (Actions tab on a worker)

Two actions, requested by a super admin (`fleet.operate`) with a reason, audited in the same
transaction as the request:

| Action | What it does | Needs |
|---|---|---|
| Clear queue | removes ComfyUI's *pending* prompts; a running one is left alone | loopback API call, no root |
| Restart ComfyUI | restarts the service on the box | `sudo -n` on the box |

Both are refused unless the worker is **drained**, holds no **reservation**, and the dispatcher's
and the agent's own readings of the ComfyUI queue are fresh (`commands-core.ts`). Restart also needs
both to show nothing running or waiting; clear-queue refuses an already empty queue. One live
command per worker.

The API only records and guards the request. The collector claims `PENDING` rows every 3 s, **checks
the same guard again against live Redis**, runs a fixed script over SSH (`command-exec.ts`; the only
inputs are the worker's own unit name and port), re-checks on the box that ComfyUI is idle before a
restart, and writes the outcome. A request nobody ran within 10 minutes is cancelled.

Known limits:

- The boxes have no passwordless sudo, so **restart reports "Needs root on the box"** until the
  on-box agent (runs as root) exists. Clear-queue works now.
- Clearing pending prompts while the dispatcher still expects them leaves those jobs failing later
  and being refunded by the dispatcher's sweeper. That is why it requires a drained worker.
- In production the claiming side is the on-box agent, which does not exist yet. It needs an
  agent-authenticated claim/complete endpoint; only the local collector reads the table directly.
- Drain state lives in the dispatcher's memory (a dispatcher restart clears it).
