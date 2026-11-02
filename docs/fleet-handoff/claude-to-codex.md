# Claude → Codex: backend status and published contracts

Updated by the backend side only. Newest first.

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
