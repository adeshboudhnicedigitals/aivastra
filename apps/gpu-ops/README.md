# AIVASTRA Fleet Operations

Standalone React/Vite workspace application in its own folder, independent of admin-web,
API, database and GPU hosts. All observations and incidents are synthetic fixtures. This is
an operations control surface; detailed charts remain in Grafana. No live mutation controls
or authentication are implemented, and the fixture UI makes no network calls to the fleet.

From the repository root:

```sh
pnpm install
pnpm --filter @aivastra/gpu-ops dev
pnpm --filter @aivastra/gpu-ops build
pnpm --filter @aivastra/gpu-ops test
```

Open http://127.0.0.1:5180. Preview a build with `pnpm --filter @aivastra/gpu-ops preview`.
The folder can also be extracted into its own repository: it has no workspace imports.
Dependency versions follow the existing admin SPA (React 18, Vite 6).

## Scope

- Fleet search and attention / state / monitoring filters; worker details and shared-GPU identity.
- Hosts → GPUs → workers reconciliation, including registry-only, monitored-only, rented-only,
  inactive-but-billed, exporter missing/unverified and inventory mismatch.
- OPEN / ACK / RECOVERED incident records with classifications, evidence availability, notes
  and audit timelines. Browser-only acknowledgment previews OPEN → ACK; local notes render as
  plain text. Classification and evidence are unchanged. GPU load and foreign prompts do not
  establish compromise.
- Browser-only reservations support owner/reason/end-time capture and confirmed release. Routing
  drain/resume intent is shown separately from observed dispatcher state. Maintenance supports
  future windows, overlap validation and cancellation; scheduled records never auto-run commands.
  Operator/reason entries appear in local history. Reset operations preview clears these overlays
  and incident edits, restores fixture reservations, and leaves the process simulation untouched.
- Browser-only ComfyUI lifecycle previews support
  start, graceful stop, restart, force kill and creating stopped, unregistered instances.
  Confirmations show fixture queue and shared-GPU impact; force kill requires typing the name.
  Creation validates unique names, host/GPU mapping and host-scoped ports. Approved demo profiles
  are fixed options, with no arbitrary command text. Unknown-state instances cannot be controlled.
  All transitions and history are in memory, persist across view navigation and reset on reload
  or Reset demo. The process preview never edits fleet observations, jobs, incidents or registry. Operations
  intent and incident annotations are separate in-memory overlays, never persisted to a backend.
  No SSH, firewall, process management, rebuild, incident transitions or note writes are connected.
- Grafana links with contextual `var-host`, `var-gpu`, `var-worker` query parameters. Copy
  `.env.example` to `.env.local` to configure your dashboard URLs. These are public build-time
  values: rebuild after changing them. Adjust Grafana variable names when connecting dashboards.
  Unconfigured links are explicitly labeled; there are no fake clickable dashboards.

## Live mode (read-only)

Set `VITE_FLEET_API_URL` (see `.env.example`) to read the API instead of the fixtures. The app
then asks you to sign in with an admin account that has `fleet.view` (the same `/admin/auth/*`
routes `admin-web` uses), keeps the access token in memory only, and
polls `GET /admin/fleet` every 15 s and shows only the Fleet overview and worker detail.

Sign-in persistence is the API's httpOnly `refresh` cookie, so a reload or new tab signs back in
without a prompt, and an expired access token is renewed once before you are asked again. This
needs the API's `CORS_ORIGIN` to list this app's origin and both to be the same site: use
`127.0.0.1` for both locally, since `localhost` and `127.0.0.1` are different sites. "Sign out"
revokes the session.

- Real: worker id/label, dispatcher state, health, routing, ComfyUI queue (with staleness),
  registry presence, job types, last job activity.
- Not connected, shown as unknown/empty: hosts and GPU mapping, GPU/exporter telemetry, host
  disk/RAM, ownership, prompts, incidents, jobs.
- Hidden in live mode: Inventory, Incidents, Operations, Queue, Configuration, Evidence,
  Activity and every start/stop/reserve control. They are browser-only demos and must not sit
  next to real worker names.
- Timestamps: freshness is measured against the API's `generatedAt`, so a snapshot that stops
  refreshing ages to stale; a failed refresh keeps the last snapshot and says so.
- A stale queue sample is shown as unknown, not as its last value. Responses are validated by
  hand in `src/live.ts` (this folder has no workspace imports) and an unexpected shape is an
  error, never a healthy-looking default.

## Data boundary

`src/contracts.ts` defines the normalized view and `FleetRepository.load()` boundary.
`src/fixtures.ts` is the default source and `src/live.ts` the API source: eight synthetic hosts/GPUs, nine logical workers,
healthy/busy/draining/foreign/unattributed/unreachable/unmonitored/stale states, a shared GPU,
and all reconciliation cases. These are not claims about the actual rented fleet.

Freshness is measured against the displayed frozen fixture `asOf`, not the wall clock. A live
adapter must supply current snapshots and independent observation timestamps for each source,
validate payloads, protect access, handle refresh/error states, and avoid treating request time
as telemetry observation time. The two-minute freshness threshold is a preview policy, not a
production SLO. `false` exporter status means a failed observation; `null` means unknown. Neither
becomes zero. A stale GPU value is labeled historical. No per-worker GPU capacity is summed.
The app never derives ownership or incident classification from utilization alone.

Before live wiring, settle the authoritative inventory source, backend authentication and
Grafana access. The UI does not implement collection, incident detection or a new state machine.
The rev 1.4.2 incident execution baseline is untouched.

## Additional UI previews

Job queue includes owned-job cancellation and distinct retry attempts. Instance configuration
allows stopped-instance profiles, ports and host/GPU assignment. Evidence uses synthetic manifests
and coverage with separate review notes; no real evidence hashes are claimed. Inventory edits are
drafts and do not change observed fleet identities. Activity combines browser-session action logs
with worker/operator/type/time filters. These controls do not call a backend.

Worker Detail also shows host-wide disk used/free/total, inode usage, RAM used/available/total
and swap used/total. RAM used is total minus available, separate from GPU VRAM. Disk and memory
have independent observation timestamps/freshness. Unknown values stay No data. Synthetic normal
and pressure examples use preview thresholds (under 10% disk/RAM available, at least 90% inodes);
these are not incident classifications. Detailed trends remain Grafana-backed.
