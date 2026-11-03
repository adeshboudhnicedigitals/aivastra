import type { FleetSnapshot, IncidentView } from './contracts';

export type Reservation = { owner: string; reason: string; until: string | null };
export type Maintenance = {
  id: string;
  workerId: string;
  owner: string;
  reason: string;
  from: string;
  until: string;
  state: 'SCHEDULED' | 'CANCELLED';
};
export type OperationEntry = {
  id: string;
  at: string;
  target: string;
  workerId?: string;
  actor: string;
  action: string;
  note: string;
};
export type OperationsDemo = {
  reservations: Record<string, Reservation | null>;
  routing: Record<string, 'DRAINING' | 'RESUMED'>;
  maintenance: Maintenance[];
  incidents: Record<string, { acknowledged: boolean; entries: OperationEntry[] }>;
  history: OperationEntry[];
};
export function seedOperations(data: FleetSnapshot): OperationsDemo {
  return {
    reservations: Object.fromEntries(
      data.workers
        .filter((worker) => worker.reservation)
        .map((worker) => [
          worker.workerId,
          {
            owner: worker.reservation?.owner ?? '',
            reason: worker.reservation?.reason ?? '',
            until: worker.reservation?.until ?? null,
          },
        ]),
    ),
    routing: {},
    maintenance: [],
    incidents: {},
    history: [],
  };
}
export function windowError(from: string, until: string, now: string): string | null {
  const start = Date.parse(from),
    end = Date.parse(until),
    current = Date.parse(now);
  if (![start, end, current].every(Number.isFinite)) return 'Choose valid start and end times.';
  if (start <= current) return 'Maintenance must start in the future.';
  if (end <= start) return 'End time must be after the start time.';
  return null;
}
export function reservationError(until: string, now: string): string | null {
  if (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.parse(now))
    return 'Reservation end must be in the future.';
  return null;
}
export type OperationsEvent =
  | { type: 'RESET'; data: FleetSnapshot }
  | { type: 'RESERVE'; entry: OperationEntry; reservation: Reservation }
  | { type: 'RELEASE' | 'DRAIN' | 'RESUME' | 'ACK' | 'NOTE'; entry: OperationEntry }
  | { type: 'SCHEDULE'; entry: OperationEntry; maintenance: Maintenance }
  | { type: 'CANCEL_MAINTENANCE'; entry: OperationEntry; id: string };
// Preview intent is separate from observed dispatcher state. These events have no transport.
export function operationsReducer(state: OperationsDemo, event: OperationsEvent): OperationsDemo {
  if (event.type === 'RESET') return seedOperations(event.data);
  const { entry } = event;
  if (!entry.actor.trim() || !entry.note.trim()) return state;
  let next = state;
  switch (event.type) {
    case 'RESERVE':
      if (state.reservations[entry.target]) return state;
      next = {
        ...state,
        reservations: { ...state.reservations, [entry.target]: event.reservation },
      };
      break;
    case 'RELEASE':
      if (!state.reservations[entry.target]) return state;
      next = { ...state, reservations: { ...state.reservations, [entry.target]: null } };
      break;
    case 'DRAIN':
    case 'RESUME':
      next = {
        ...state,
        routing: {
          ...state.routing,
          [entry.target]: event.type === 'DRAIN' ? 'DRAINING' : 'RESUMED',
        },
      };
      break;
    case 'SCHEDULE':
      if (windowError(event.maintenance.from, event.maintenance.until, entry.at)) return state;
      if (
        state.maintenance.some(
          (item) =>
            item.workerId === event.maintenance.workerId &&
            item.state === 'SCHEDULED' &&
            Date.parse(item.from) < Date.parse(event.maintenance.until) &&
            Date.parse(event.maintenance.from) < Date.parse(item.until),
        )
      )
        return state;
      next = { ...state, maintenance: [...state.maintenance, event.maintenance] };
      break;
    case 'CANCEL_MAINTENANCE':
      if (!state.maintenance.some((item) => item.id === event.id && item.state === 'SCHEDULED'))
        return state;
      next = {
        ...state,
        maintenance: state.maintenance.map((item) =>
          item.id === event.id ? { ...item, state: 'CANCELLED' } : item,
        ),
      };
      break;
    case 'ACK':
    case 'NOTE': {
      const previous = state.incidents[entry.target] ?? { acknowledged: false, entries: [] };
      if (event.type === 'ACK' && previous.acknowledged) return state;
      next = {
        ...state,
        incidents: {
          ...state.incidents,
          [entry.target]: {
            acknowledged: previous.acknowledged || event.type === 'ACK',
            entries: [...previous.entries, entry],
          },
        },
      };
      break;
    }
  }
  return { ...next, history: [entry, ...state.history] };
}
export function incidentPreview(incident: IncidentView, state: OperationsDemo): IncidentView {
  const overlay = state.incidents[incident.id];
  if (!overlay) return incident;
  return {
    ...incident,
    state: incident.state === 'OPEN' && overlay.acknowledged ? 'ACK' : incident.state,
    updatedAt: overlay.entries.at(-1)?.at ?? incident.updatedAt,
    notes: [
      ...incident.notes,
      ...overlay.entries
        .filter((entry) => entry.action === 'NOTE')
        .map((entry) => `[Demo · ${entry.actor} · ${entry.at}] ${entry.note}`),
    ],
    audit: [
      ...incident.audit,
      ...overlay.entries.map((entry) => ({
        at: entry.at,
        actor: `${entry.actor} (browser demo)`,
        action: `${entry.action} · ${entry.note}`,
      })),
    ],
  };
}
