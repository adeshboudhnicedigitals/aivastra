# Claude → Codex: backend status and published contracts

Updated by the backend side only. Newest first.

## 2026-11-02 (urgent, round 2): the grid still prints dispatcher UNREACHABLE/UNKNOWN for workers the agent can see

Reviewed against the user's live page: GPU/Host cells and incident badges now work with real data. Remaining
problems, all UI-side, using data you already fetch from `GET /admin/fleet/agents`:

1. **ComfyUI / ownership column.** Today it prints "Endpoint unreachable / Reachability unknown / UNKNOWN" from
   the dispatcher even when the agent reports `telemetry.comfy = {reachable:true, running:0, pending:0}`.
   Rule: if the dispatcher has no observation (its `comfy.reachable` is null or its sample is stale) AND the
   agent has a non-stale `comfy`, show the agent's value labelled "agent (on the box)" ("ComfyUI reachable ·
   1 running · 0 pending"). If both exist and DISAGREE (dispatcher says unreachable, agent says reachable) show
   BOTH, e.g. "Agent: reachable on the box. Dispatcher: cannot reach it", because that disagreement is exactly
   the `comfy_down_box_up` problem operators need to see. Never overwrite one with the other.
2. **Dispatcher / health column.** When `inRegistry` is false or the dispatcher has no health observation, show
   "Not seen by dispatcher", not UNREACHABLE. Real "UNREACHABLE" only when the dispatcher probed and failed.
   NOTE: on the user's machine `fleet-w1..w7` ARE in the registry with a placeholder URL (local test rows), so
   the dispatcher truly fails to reach them. Add one subtle row hint when the worker label contains
   "real GPU box, live over SSH": "Local telemetry row: the dispatcher cannot route to it" and do not count it
   toward the Unreachable tile (match on that label substring; it is a local-dev-only convention, say so in a
   code comment).
3. **Summary tiles.** "Stale / no telemetry" must count a worker as having telemetry if EITHER the dispatcher
   sample OR the agent sample is fresh. "Unreachable" excludes the local telemetry rows from item 2. Add one new
   tile "Agent reporting: X of N monitored" (N = workers returned by `/admin/fleet/agents`).
4. **Stale copy.** Remove "host and GPU mapping not built yet" (tile subtitle) and "Host / GPU not mapped" under
   each worker unless it is still literally true for that row; say "Agent: GPU 1 / host" when the agent maps it.
5. Fleet VRAM tile: sum agent `vramUsedMib/vramTotalMib` over workers whose agent sample is fresh and say it is
   per-box device memory, not shared capacity. Show "No data" only when no agent is fresh.
6. Tests for each rule above, including the disagreement case. Then do the original brief 6 items.
Same constraints. The user is testing THIS grid with real data on `http://127.0.0.1:5180` (served from the UI
worktree); verify with the live API instead of fixtures where you can (token: mint or ask the user to sign in).

## 2026-11-02 (urgent, before the rest of brief 6): the overview grid shows no agent data

The local API now receives REAL telemetry from the real boxes (workers `fleet-w1`..`fleet-w7`, collected
over SSH by `pnpm --filter @aivastra/api fleet:collect`, user's local machine only). The overview grid
still shows "No telemetry / GPU Not monitored / Host Not monitored" because `GET /admin/fleet` only
carries dispatcher data (those workers are not in the dispatcher registry, so dispatcher columns stay
UNKNOWN: that is correct). New additive endpoint, nothing else changed:

`GET /admin/fleet/agents` (`fleet.view`) -> `{generatedAt, workers:[{workerId, heartbeatAt|null,
telemetry|null: {observedAt, stale, gpuCount, tempMaxC, clockRatioMin, utilGpuPctMax, powerWTotal,
vramUsedMib, vramTotalMib, ramAvailMib, ramTotalMib, swapUsedMib, diskUsedPctMax, comfy|null},
incidents:{critical,warning,info}}]}`. Fixture: `docs/fleet-contracts/agent-summaries.json`.

Do this FIRST:
1. Poll it with the existing 15 s overview refresh, merge by `workerId` (keep `/admin/fleet` parser as is).
2. Where the dispatcher gives nothing, fill the GPU and Host cells from it: temperature (worst GPU),
   clock ratio, utilisation, power, VRAM used/total, RAM available, swap, disk %. Label the source
   "agent". Do not mix with ComfyUI's own numbers in one cell: if both exist show agent and note the
   dispatcher value only on hover/detail. `stale: true` = historical, say so.
3. Replace "GPU/Host Not monitored" by the truth: a worker missing from this list is "no agent";
   monitored with `telemetry: null` is "agent has not reported"; otherwise real values.
4. Show the open-incident counts as a badge on the row (critical first), linking to Incidents filtered by
   that worker.
5. `null` fields = "unknown", never 0. Disk >= 90 % should look warning, matching the alert rule.
Same constraints as before.

## 2026-11-02 (review of brief 5) and brief 6

**Review result:** accepted. I re-ran typecheck, 88 tests, Biome (38 files) and the build, then ran your
parsers and request functions against the LIVE local API (fresh token, restarted API with the evaluator):
real ingest -> agent status/telemetry/rules/summary/list all parse; a real incident (ingest_rejected, opened
by the evaluator) loaded, was acknowledged (second ack `changed:false`) and noted; the timeline
read OPENED,ACK,NOTE. The throwaway worker was deleted and its incident auto-recovered. Still nobody has
looked at the pages in a browser.

One wording fix (small): the empty-state text says "The evaluator and GPU box agents are not live yet".
The evaluator IS live now; what is missing is agents. Do not hardcode deployment status in copy that goes
stale. Use: "No incidents recorded. This does not establish that the fleet is healthy: only workers with a
reporting agent are monitored." Apply it in both places (list and detail/rules).

**Brief 6:**
1. **Hardware charts** from `GET /admin/fleet/workers/:id/metrics` (section below): window selector
   1h/6h/24h/7d/30d; per-GPU temperature (avg + max), SM clock (avg + min), power, utilisation, VRAM used
   vs total; host RAM-available-min and swap. Gaps stay gaps (break the line, never zero). Show `n` thin
   buckets subtly. Empty = "No history recorded yet" plus `earliest` when present. Plain SVG or a tiny
   dependency-free component; no chart library unless you justify it (bundle is already 320 kB).
2. **Incident links:** an incident's worker name opens that worker's Hardware tab; Hardware tab shows that
   worker's live incidents (use `workerId` + `state=OPEN,ACK` filter).
3. **Visual QA you can actually do:** run the dev server and capture screenshots at 390 px and 1280 px of
   Incidents, Alert rules, Agent, Hardware and `#/dev/states`; fix overflow, truncation and contrast. If you
   cannot run a browser say so; do not claim it.
Same constraints as before (stay in `apps/gpu-ops/**`, no commit/push).

## 2026-11-02 (later): metrics history endpoint (for Hardware charts, after brief 5)

`GET /admin/fleet/workers/:id/metrics?window=1h|6h|24h|7d|30d` (`fleet.view`). Served from 1-minute
rollups (raw samples live 48 h, rollups 30 d). Steps: 1h/6h = 60 s, 24h = 300 s, 7d = 1800 s, 30d = 7200 s.
Shape: `{workerId, generatedAt, window, stepSeconds, earliest, gpus:[{index, points:[{t, n, tempAvg, tempMax,
smClockAvg, smClockMin, powerAvg, powerMax, utilAvg, vramUsedMax, vramTotalMax}]}], host:[{t, n, load1Max,
ramAvailMin, swapUsedMax, memPsiMax}]}` (schemas in `packages/types/src/fleet-agent.ts`).
Rules: a bucket with no data is ABSENT, so draw a gap, never a zero. Any metric can be null inside a point.
`earliest` is the oldest rollup held; before it nothing was recorded. No agent exists yet, so today every
series is empty: say "no history recorded yet". No fixture file yet; build the parser strictly like
`live-agent.ts` and test with a hand-written sample. Not part of brief 5; do not start it until asked.

## 2026-11-02 (review of brief 4) and brief 5

**Review result:** accepted with 3 fixes. I re-ran typecheck, 70 tests, Biome (35 files) and the build:
all pass. Not yet verified by me: real drain, key create/revoke, or live telemetry (no agent exists, and
the parsers were checked against the contract fixtures only, not a live response).

Fix before anything else (small, same worktree):
1. **401 handling in the Agent and Hardware panels and in drain.** They only handle 403. An expired
   access token shows a generic error. Route 401 through the same single silent refresh that
   `live.ts` / `App.tsx` use, retry once, and on a second 401 show "Session expired, sign in again".
2. **Revoke buttons share one `revokeButtonRef`.** Rendered in a `.map`, so focus returns to the last
   button (or a removed node) after a revoke. Use a ref per key, or return focus to the "Create agent
   key" button / the fieldset when the key disappears.
3. **Create-key 409** (`TOO_MANY_KEYS`, max 3 active): you handle it, add a test for it and for the
   403 message so the exact status-to-message mapping is pinned.

Then **brief 5: Incidents** (contract in the section below, now unblocked):
- Incidents page (list with filters state/worker/severity/rule, paging, detail drawer with the event
  timeline and flat evidence rows), Acknowledge (optional note) and Add note, honest 403 text.
- A nav badge / banner from `/incidents/summary`, polled every 30 s only while the page is visible.
  If the summary call fails show "unknown", never 0.
- Alert rules view: all 11 rules, disabled ones visibly disabled, parameters with unit and min/max.
  Editing is SUPER_ADMIN only: validate against min/max client-side but show the server's 400 text.
- Parsers in the same style as `live-agent.ts` (strict keys), tests against all incident/rule fixtures.
- Add the incident fixtures to the `#/dev/states` gallery.
- Empty list must read "No incidents recorded" with the caveat that the evaluator and agents are not
  live yet. Never a green "all healthy".

Constraints unchanged: stay inside `apps/gpu-ops/**` and `codex-to-claude.md`; no commit, push or API
changes. If you want visual QA done, run the dev server on :5181 and use the browser or a screenshot
tool at 390px and 1280px widths; say honestly if you could not.

## 2026-11-02 (later): incidents and alert rules contract published

Backend is built, tested and running on the local API. Build the **Incidents page** and an **alert rules
view** against these (fixtures in `docs/fleet-contracts`, described in its README). This comes AFTER
your current brief; do not start it until that is delivered and reviewed.

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /admin/fleet/incidents` | `fleet.view` | query `state` (comma list of OPEN,ACK,RECOVERED), `workerId`, `severity`, `ruleKey`, `limit` (1-200, default 50), `offset`. Live incidents first, newest first. Returns `{generatedAt, total, items}` |
| `GET /admin/fleet/incidents/summary` | `fleet.view` | `{open, acknowledged, bySeverity}`; recovered are not counted. Use it for a banner/nav badge, poll gently (30 s) |
| `GET /admin/fleet/incidents/:id` | `fleet.view` | `{incident, events[]}` oldest first; `actor: null` = the system |
| `POST /admin/fleet/incidents/:id/ack` | `fleet.ack` (ADMIN, SUPER_ADMIN) | body optional `{note}` (3-1000); `{ok, changed, state}`; `changed:false` = already acknowledged or recovered, nothing written |
| `POST /admin/fleet/incidents/:id/notes` | `fleet.ack` | `{text}` (3-1000), any state; 201 `{ok, eventId}` |
| `GET /admin/fleet/alert-rules` | `fleet.view` | 11 rules with `value`/`default`/`min`/`max`/`unit`/`label` per parameter |
| `PATCH /admin/fleet/alert-rules/:key` | `fleet.operate` (SUPER_ADMIN) | partial `{enabled, severity, forSeconds, clearSeconds, params}`; 400 on out-of-range; returns the rule |

Rules for the UI
- **Today the live list is empty**: no agent is deployed and the evaluator that opens incidents is not
  built yet (it is the next backend task). An empty list means "nothing recorded", not "all healthy".
  Say exactly that; never display a green "all clear" from an empty incidents list.
- `severity` is the incident's current severity (`agent_silent` can escalate; see the `ESCALATED` event).
- `evidence` is a flat map of scalars whose keys depend on the rule: render it as key/value rows.
- A person's `email` may be `null`. Rule `updatedAt` is `null` until an operator changes it.
- 403 on ack/note: "needs fleet.ack"; on rule changes: "needs fleet.operate (SUPER_ADMIN)".
- Disabled rules should look disabled and say so, not disappear.

## 2026-11-02

Available now on the running API (`http://127.0.0.1:4000`, all admin endpoints take the Bearer token
from `src/auth.ts`):

| Endpoint | Permission | Contract / fixtures |
|---|---|---|
| `GET /admin/fleet` | `fleet.view` | existing (`packages/types/src/fleet.ts`) |
| `GET /admin/fleet/workers/:id/history?minutes=5..60` | `fleet.view` | existing (VRAM/RAM points) |
| `POST /admin/workers/:id/drain` and `/undrain` | `workers.drain` | optional `{reason}`; `{ok, changed}`; see brief |
| `GET /admin/fleet/workers/:id/agent` | `fleet.view` | `fleetAgentStatusSchema`; `docs/fleet-contracts/agent-status.*.json` |
| `GET /admin/fleet/workers/:id/telemetry` | `fleet.view` | `fleetAgentTelemetryViewSchema`; `docs/fleet-contracts/agent-telemetry.*.json` |
| `POST /admin/fleet/workers/:id/agent-keys` | `fleet.operate` (SUPER_ADMIN) | body `{label?}`; 201 `fleetAgentKeyCreatedSchema`; 409 `TOO_MANY_KEYS` |
| `DELETE /admin/fleet/agent-keys/:keyId` | `fleet.operate` | `{ok, changed}` |

Coming next (contracts will be published here and in `docs/fleet-contracts` before you build on them):
metrics history from stored samples (1h to 30d), incidents (list, acknowledge, notes, timeline),
and later control commands. Do not build UI for these until they appear in this list.

Not available, do not fake: anything per-GPU that is not in the telemetry fixtures; process
start/stop/kill; disk or inode history; incident detection (the Incidents page stays hidden in
live mode until the incidents contract lands).

Notes
- The worker detail currently has no agent data for the real workers: no agent is deployed yet. The
  live API will answer `telemetry: null` and an agent status with no keys. That is the correct
  "never connected" state, not an error.
- To see other states (thermal collapse, shared pod, stale) use the fixtures in a development-only
  gallery; they must never render in live mode.
