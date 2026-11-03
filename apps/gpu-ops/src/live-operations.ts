import { AuthError, type AuthRecovery, fetchWithRefresh } from './auth';

export type MaintenanceStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
export type MaintenanceWindow = {
  id: string;
  workerId: string;
  startsAt: string;
  endsAt: string;
  owner: string;
  reason: string;
  status: MaintenanceStatus;
  createdAt: string;
};
export type Reservation = {
  workerId: string;
  owner: string;
  reason: string;
  until: string | null;
  createdAt: string;
};
export type Operations = {
  generatedAt: string;
  maintenance: MaintenanceWindow[];
  reservations: Reservation[];
};
export type MaintenanceInput = {
  workerId: string;
  startsAt: string;
  endsAt: string;
  owner: string;
  reason: string;
};
export type ReservationInput = { owner: string; until: string | null; reason: string };

export class FleetOperationsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isDate = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const STATUSES: readonly string[] = ['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED'];
const bad = (where: string): never => {
  throw new FleetOperationsApiError(
    0,
    `Fleet API returned an unexpected operations response (${where}).`,
  );
};
const arr = (v: unknown, where: string): unknown[] => (Array.isArray(v) ? v : bad(where));

function parseWindow(v: unknown, i: number): MaintenanceWindow {
  const at = `maintenance[${i}]`;
  if (!isObj(v) || !isStr(v.id) || !isStr(v.workerId)) return bad(at);
  if (!isDate(v.startsAt) || !isDate(v.endsAt) || !isDate(v.createdAt)) return bad(`${at}.times`);
  if (!isStr(v.owner) || !isStr(v.reason)) return bad(`${at}.text`);
  if (!isStr(v.status) || !STATUSES.includes(v.status)) return bad(`${at}.status`);
  return {
    id: v.id,
    workerId: v.workerId,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    owner: v.owner,
    reason: v.reason,
    status: v.status as MaintenanceStatus,
    createdAt: v.createdAt,
  };
}
function parseReservation(v: unknown, i: number): Reservation {
  const at = `reservations[${i}]`;
  if (!isObj(v) || !isStr(v.workerId) || !isStr(v.owner) || !isStr(v.reason)) return bad(at);
  if (!isDate(v.createdAt)) return bad(`${at}.createdAt`);
  if (v.until !== null && !isDate(v.until)) return bad(`${at}.until`);
  return {
    workerId: v.workerId,
    owner: v.owner,
    reason: v.reason,
    until: v.until as string | null,
    createdAt: v.createdAt,
  };
}
export function parseOperations(value: unknown): Operations {
  if (!isObj(value)) return bad('root');
  if (!isDate(value.generatedAt)) return bad('generatedAt');
  return {
    generatedAt: value.generatedAt,
    maintenance: arr(value.maintenance, 'maintenance').map(parseWindow),
    reservations: arr(value.reservations, 'reservations').map(parseReservation),
  };
}

export function operationsErrorMessage(
  error: unknown,
  capability: 'view' | 'edit' = 'view',
): string {
  if (error instanceof FleetOperationsApiError && error.status === 401)
    return 'Session expired, sign in again.';
  if (error instanceof FleetOperationsApiError && error.status === 403)
    return capability === 'edit'
      ? 'Your role lacks fleet.operate (SUPER_ADMIN).'
      : 'Your role lacks fleet.view.';
  return error instanceof Error ? error.message : 'Fleet API request failed.';
}

type RequestOptions = { recovery?: AuthRecovery; fetchImpl?: typeof fetch };
async function request(
  baseUrl: string,
  token: string,
  path: string,
  options: RequestOptions & { method?: string; body?: unknown } = {},
): Promise<Operations> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const send = (accessToken: string) =>
    fetchImpl(`${baseUrl.replace(/\/$/, '')}/admin/fleet/operations${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(10_000),
    });
  let response: Response;
  try {
    response = options.recovery
      ? await fetchWithRefresh(send, token, options.recovery)
      : await send(token);
  } catch (cause) {
    if (cause instanceof AuthError) throw new FleetOperationsApiError(401, cause.message);
    throw new FleetOperationsApiError(0, 'Fleet API unavailable.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    // The API's error envelope is { error: { code, message } }.
    const message =
      isObj(payload) && isObj(payload.error) && isStr(payload.error.message)
        ? payload.error.message
        : `Fleet API returned ${response.status}.`;
    throw new FleetOperationsApiError(response.status, message);
  }
  return parseOperations(await response.json().catch(() => null));
}

const seg = encodeURIComponent;
export const loadOperations = (b: string, t: string, o?: RequestOptions) => request(b, t, '', o);
export const scheduleMaintenance = (
  b: string,
  t: string,
  input: MaintenanceInput,
  o?: RequestOptions,
) => request(b, t, '/maintenance', { ...o, method: 'POST', body: input });
export const cancelMaintenance = (
  b: string,
  t: string,
  id: string,
  reason: string,
  o?: RequestOptions,
) => request(b, t, `/maintenance/${seg(id)}/cancel`, { ...o, method: 'POST', body: { reason } });
export const setReservation = (
  b: string,
  t: string,
  workerId: string,
  input: ReservationInput,
  o?: RequestOptions,
) => request(b, t, `/reservations/${seg(workerId)}`, { ...o, method: 'PUT', body: input });
export const releaseReservation = (
  b: string,
  t: string,
  workerId: string,
  reason: string,
  o?: RequestOptions,
) => request(b, t, `/reservations/${seg(workerId)}`, { ...o, method: 'DELETE', body: { reason } });

/** Client-side mirror of the server's window rules, so the form can explain before sending. */
export function windowFormError(startsAt: string, endsAt: string, now: number): string | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Choose a start and end time.';
  if (start <= now) return 'Maintenance must start in the future.';
  if (end <= start) return 'End time must be after the start time.';
  if (end - start > 14 * 86_400_000) return 'A maintenance window can last at most 14 days.';
  return null;
}
