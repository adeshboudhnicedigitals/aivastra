import type { FleetActivityItem } from '@aivastra/types';

// Pure shaping and merging for the activity log; the route does the queries. Kept free of I/O so the
// rules (what is shown, how it is worded, how sources interleave) are unit-tested.

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const AUDIT_WORDS: Record<string, string> = {
  'fleet.agent_key.create': 'created an agent key',
  'fleet.agent_key.revoke': 'revoked an agent key',
  'fleet.box.enroll': 'enrolled a box (new agent key)',
  'fleet.enroll_token.create': 'created an enrolment token',
  'fleet.enroll_token.revoke': 'revoked an enrolment token',
  'fleet.alert_rule.update': 'changed an alert rule',
  'fleet.command.request': 'requested a command',
  'fleet.command.cancel': 'cancelled a command',
  'fleet.incident.ack': 'acknowledged an incident',
  'fleet.incident.note': 'added a note to an incident',
  'fleet.notification_settings.update': 'changed the alert recipients',
  'fleet.inventory.host.upsert': 'edited a host',
  'fleet.inventory.host.delete': 'deleted a host',
  'fleet.inventory.host.review': 'recorded a host review',
  'fleet.inventory.gpu.upsert': 'edited a GPU',
  'fleet.inventory.gpu.delete': 'deleted a GPU',
  'fleet.inventory.worker.map': 'changed a worker mapping',
  'fleet.maintenance.schedule': 'scheduled a maintenance window',
  'fleet.maintenance.cancel': 'cancelled a maintenance window',
  'fleet.job.cancel': 'cancelled a queued job',
  'fleet.job.retry': 'retried a failed job',
  'fleet.reservation.set': 'set a reservation note',
  'fleet.reservation.release': 'released a reservation note',
};

export type AuditRow = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorEmail: string | null;
  createdAt: Date;
};

export function auditItem(r: AuditRow): FleetActivityItem {
  const what = AUDIT_WORDS[r.action] ?? r.action;
  // Box ids (fleet_host) share the "workerId" slot: the activity log filters by the id the fleet
  // pages use, and agent/enrolment events are recorded against the box.
  const worker =
    r.resourceType === 'worker' ||
    r.resourceType === 'fleet_reservation' ||
    r.resourceType === 'fleet_host'
      ? r.resourceId
      : null;
  return {
    id: `audit:${r.id}`,
    at: r.createdAt.toISOString(),
    source: 'AUDIT',
    action: r.action,
    actor: r.actorEmail,
    workerId: worker,
    summary: clip(`${r.actorEmail ?? 'An admin'} ${what}${worker ? ` on ${worker}` : ''}`, 400),
  };
}

export type IncidentEventRow = {
  id: number;
  kind: string;
  at: Date;
  text: string | null;
  actorEmail: string | null;
  ruleKey: string;
  workerId: string;
  incidentSummary: string;
};

export function incidentEventItem(r: IncidentEventRow): FleetActivityItem {
  const kind = r.kind.toUpperCase();
  const base = `${r.ruleKey} on ${r.workerId}`;
  const verb: Record<string, string> = {
    OPENED: `Incident opened: ${base}`,
    ACK: `${r.actorEmail ?? 'An admin'} acknowledged ${base}`,
    NOTE: `${r.actorEmail ?? 'An admin'} noted on ${base}${r.text ? `: ${r.text}` : ''}`,
    RECOVERED: `Incident recovered: ${base}`,
    REOPENED: `Incident reopened: ${base}`,
    ESCALATED: `Incident escalated: ${base}`,
  };
  return {
    id: `incident:${r.id}`,
    at: r.at.toISOString(),
    source: 'INCIDENT',
    action: kind,
    actor: r.actorEmail,
    workerId: r.workerId,
    summary: clip(verb[kind] ?? `${kind}: ${base}`, 400),
  };
}

export type CommandRow = {
  id: string;
  workerId: string;
  kind: string;
  state: string;
  finishedAt: Date | null;
  result: string | null;
};

/** Only the outcome: the request itself is already in the audit trail, so it is not listed twice. */
export function commandItem(r: CommandRow): FleetActivityItem | null {
  if (!r.finishedAt || r.state === 'PENDING' || r.state === 'RUNNING') return null;
  const outcome = r.state.toLowerCase();
  return {
    id: `command:${r.id}`,
    at: r.finishedAt.toISOString(),
    source: 'COMMAND',
    action: `command.${outcome}`,
    actor: null,
    workerId: r.workerId,
    summary: clip(`${r.kind} on ${r.workerId} ${outcome}${r.result ? `: ${r.result}` : ''}`, 400),
  };
}

/**
 * Newest first, ties broken by id so paging never repeats or skips a row. Each source was fetched
 * with limit = offset + limit + 1, so a hit beyond the page proves there is more.
 */
export function mergeActivity(lists: FleetActivityItem[][], limit: number, offset: number) {
  const all = lists
    .flat()
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
  return { items: all.slice(offset, offset + limit), hasMore: all.length > offset + limit };
}
