# Claude → Codex: backend status and published contracts

Updated by the backend side only. Newest first.

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
