# Fleet contract fixtures

Example responses for the fleet agent admin endpoints, for building and testing UI without a live
agent. Every file is validated against the real Zod schema in `packages/types/src/fleet-agent.ts`
by `apps/api/test/fleet-contract-fixtures.test.ts`, so a fixture cannot drift from the API.

They are **synthetic** (including the "key", which is deliberately not a valid key). Use them in
unit/component tests and in a development-only state gallery. Never render them in live mode or
anywhere a real worker's data is expected: honesty rule 3 still applies.

| File | Endpoint | What it shows |
|---|---|---|
| `agent-status.connected.json` | `GET /admin/fleet/workers/:id/agent` | heartbeat present, one active and one revoked key |
| `agent-status.never-connected.json` | same | no keys, no heartbeat |
| `agent-status.silent.json` | same | key exists and was seen earlier, no heartbeat now |
| `agent-status.rejecting.json` | same | no heartbeat but 42 rejected samples: trying and failing, not silent |
| `agent-summaries.json` | `GET /admin/fleet/agents` | one row per agent-monitored worker for the overview grid; null = unknown |
| `agent-key-created.json` | `POST /admin/fleet/workers/:id/agent-keys` (201) | the one response that carries `key` |
| `agent-telemetry.fresh.json` | `GET /admin/fleet/workers/:id/telemetry` | healthy sample, foreign VRAM computed |
| `agent-telemetry.thermal-collapse.json` | same | 87 C, SM clock 899 of 2430 MHz: `thermalCollapseNow: true` |
| `agent-telemetry.shared-pod.json` | same | no visible processes: `foreignVramMib` is `null` (unknown), not 0 and not all-foreign |
| `agent-telemetry.unknown-fields.json` | same | many `null`s: render "No data", never 0 |
| `agent-telemetry.stale.json` | same | `stale: true`: show as historical |
| `agent-telemetry.none.json` | same | `telemetry: null`: nothing ever reported |
| `agent-telemetry.no-gpu.json` | same | host data but no GPU rows (nvidia-smi unusable) |

Notes: `generatedAt` is the reference clock for freshness; timestamps are ISO strings, `observedAt`
inside `telemetry` is unix milliseconds.

## Alerts and incidents

| File | Endpoint | What it shows |
|---|---|---|
| `incidents.list.json` | `GET /admin/fleet/incidents` | live incidents first (critical box down, open thermal collapse, acknowledged disk), then a recovered one |
| `incidents.empty.json` | same | nothing recorded: the honest state before any agent reports |
| `incidents.summary.json` | `GET /admin/fleet/incidents/summary` | counts for the banner; recovered incidents are not counted |
| `incident.detail.open.json` | `GET /admin/fleet/incidents/:id` | one event: the system opened it (`actor: null`) |
| `incident.detail.acked.json` | same | acknowledged with a note, then a follow-up note |
| `incident.detail.recovered.json` | same | opened, escalated to critical, acknowledged, recovered, then a post-mortem note |
| `alert-rules.json` | `GET /admin/fleet/alert-rules` | all 11 rules; one disabled, one with a tuned threshold (`value` differs from `default`) |

Actions: `POST /admin/fleet/incidents/:id/ack` (`{note?}` -> `{ok, changed, state}`),
`POST /admin/fleet/incidents/:id/notes` (`{text}` -> 201 `{ok, eventId}`),
`PATCH /admin/fleet/alert-rules/:key` (partial `{enabled, severity, forSeconds, clearSeconds, params}` -> the rule view).
`evidence` is a flat map of scalars whose keys depend on the rule; render it as a key/value list. A
person's `email` can be `null`. `actor: null` means the system.

