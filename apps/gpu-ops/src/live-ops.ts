export type LiveJob = {
  id: string;
  status: string;
  workerId: string | null;
  jobType: string | null;
  attempts: number;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  userEmail: string | null;
};
export type LiveJobPage = { page: number; pageSize: number; total: number; items: LiveJob[] };
export type LiveJobEvent = { id: string; eventType: string; payload: unknown; createdAt: string };
export type LiveJobDetail = LiveJob & { creditsCharged: number; events: LiveJobEvent[] };
export type LiveWorkerConfig = {
  id: string;
  label: string;
  isActive: boolean;
  allowedJobTypes: string[];
  status: string;
  inRegistry: boolean;
  healthy: boolean;
  lastSeen: number | null;
};
export type LiveWorkerHistory = {
  workerId: string;
  generatedAt: string;
  windowMinutes: number;
  points: {
    t: number;
    vramUsedMb: number | null;
    vramTotalMb: number | null;
    ramUsedGb: number | null;
    ramTotalGb: number | null;
  }[];
};

export class OpsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const nullableString = (value: unknown): value is string | null => value === null || string(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const nullable = <T>(value: unknown, isValue: (value: unknown) => value is T): value is T | null =>
  value === null || isValue(value);
const date = (value: unknown): value is string => string(value) && !Number.isNaN(Date.parse(value));

function parseJob(value: unknown): LiveJob {
  if (
    !record(value) ||
    !string(value.id) ||
    !string(value.status) ||
    !nullableString(value.workerId) ||
    !nullableString(value.jobType) ||
    !finite(value.attempts) ||
    !nullableString(value.errorCode) ||
    !date(value.createdAt) ||
    !nullableString(value.startedAt) ||
    !nullableString(value.completedAt) ||
    !nullableString(value.userEmail)
  )
    throw new Error('Unexpected jobs response: item');
  return {
    id: value.id,
    status: value.status,
    workerId: value.workerId,
    jobType: value.jobType,
    attempts: value.attempts,
    errorCode: value.errorCode,
    createdAt: value.createdAt,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    userEmail: value.userEmail,
  };
}

export function parseLiveJobPage(value: unknown): LiveJobPage {
  if (
    !record(value) ||
    !finite(value.page) ||
    !finite(value.pageSize) ||
    !finite(value.total) ||
    !Array.isArray(value.items)
  )
    throw new Error('Unexpected jobs response: page');
  return {
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
    items: value.items.map(parseJob),
  };
}

export function parseLiveJobDetail(value: unknown): LiveJobDetail {
  const job = parseJob(value);
  if (!record(value) || !finite(value.creditsCharged) || !Array.isArray(value.events))
    throw new Error('Unexpected job detail response');
  const events = value.events.map((event): LiveJobEvent => {
    if (
      !record(event) ||
      !string(event.id) ||
      !string(event.eventType) ||
      !date(event.createdAt) ||
      !('payload' in event)
    )
      throw new Error('Unexpected job detail response: event');
    return {
      id: event.id,
      eventType: event.eventType,
      payload: event.payload,
      createdAt: event.createdAt,
    };
  });
  return { ...job, creditsCharged: value.creditsCharged, events };
}

export function parseLiveWorkerConfig(value: unknown): LiveWorkerConfig {
  if (
    !record(value) ||
    !string(value.id) ||
    !string(value.label) ||
    (!finite(value.lastSeen) && value.lastSeen !== null) ||
    typeof value.isActive !== 'boolean' ||
    typeof value.inRegistry !== 'boolean' ||
    typeof value.healthy !== 'boolean' ||
    !string(value.status) ||
    !Array.isArray(value.allowedJobTypes) ||
    !value.allowedJobTypes.every(string)
  )
    throw new Error('Unexpected worker response');
  return {
    id: value.id,
    label: value.label,
    isActive: value.isActive,
    allowedJobTypes: value.allowedJobTypes,
    status: value.status,
    inRegistry: value.inRegistry,
    healthy: value.healthy,
    lastSeen: value.lastSeen,
  };
}

export function parseLiveWorkerConfigs(value: unknown): LiveWorkerConfig[] {
  if (!Array.isArray(value)) throw new Error('Unexpected workers response: list');
  return value.map(parseLiveWorkerConfig);
}

export function parseLiveWorkerHistory(value: unknown): LiveWorkerHistory {
  if (
    !record(value) ||
    !string(value.workerId) ||
    !date(value.generatedAt) ||
    !finite(value.windowMinutes) ||
    !Number.isInteger(value.windowMinutes) ||
    value.windowMinutes <= 0 ||
    !Array.isArray(value.points)
  )
    throw new Error('Unexpected worker history response');
  const points = value.points.map((point) => {
    if (
      !record(point) ||
      !finite(point.t) ||
      !Number.isInteger(point.t) ||
      point.t < 0 ||
      !nullable(point.vramUsedMb, finite) ||
      !nullable(point.vramTotalMb, finite) ||
      !nullable(point.ramUsedGb, finite) ||
      !nullable(point.ramTotalGb, finite)
    )
      throw new Error('Unexpected worker history response: point');
    return {
      t: point.t,
      vramUsedMb: point.vramUsedMb,
      vramTotalMb: point.vramTotalMb,
      ramUsedGb: point.ramUsedGb,
      ramTotalGb: point.ramTotalGb,
    };
  });
  return {
    workerId: value.workerId,
    generatedAt: value.generatedAt,
    windowMinutes: value.windowMinutes,
    points,
  };
}

async function request<T>(
  baseUrl: string,
  token: string,
  path: string,
  parse: (value: unknown) => T,
  params?: URLSearchParams,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}${params ? `?${params}` : ''}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OpsApiError(0, 'Could not reach the fleet API.');
  }
  if (response.status === 403) throw new OpsApiError(403, 'Forbidden');
  if (!response.ok)
    throw new OpsApiError(response.status, `Fleet API returned ${response.status}.`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Unexpected API response: not JSON');
  }
  return parse(body);
}

export function loadJobs(
  baseUrl: string,
  token: string,
  filters: {
    page?: number;
    pageSize?: number;
    workerId?: string;
    status?: string;
    search?: string;
    jobType?: string;
    createdFrom?: string;
    createdTo?: string;
  },
) {
  const params = new URLSearchParams();
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 25));
  if (filters.workerId) params.set('workerId', filters.workerId);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.jobType) params.set('jobType', filters.jobType);
  if (filters.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters.createdTo) params.set('createdTo', filters.createdTo);
  return request(baseUrl, token, '/admin/jobs', parseLiveJobPage, params);
}

export function loadJob(baseUrl: string, token: string, id: string) {
  return request(baseUrl, token, `/admin/jobs/${encodeURIComponent(id)}`, parseLiveJobDetail);
}

export function loadJobSources(baseUrl: string, token: string) {
  return request(baseUrl, token, '/admin/jobs/sources', (value) => {
    if (!Array.isArray(value) || !value.every(string))
      throw new Error('Unexpected job sources response');
    return value;
  });
}

export function loadWorkerHistory(baseUrl: string, token: string, id: string, minutes = 60) {
  const params = new URLSearchParams({ minutes: String(minutes) });
  return request(
    baseUrl,
    token,
    `/admin/fleet/workers/${encodeURIComponent(id)}/history`,
    parseLiveWorkerHistory,
    params,
  ).then((history) => {
    if (history.workerId !== id)
      throw new Error('Unexpected worker history response: workerId mismatch');
    return history;
  });
}

export function loadWorkerConfig(baseUrl: string, token: string, id: string) {
  return request(baseUrl, token, '/admin/workers', parseLiveWorkerConfigs).then((workers) => {
    const worker = workers.find((item) => item.id === id);
    if (!worker) throw new OpsApiError(404, 'Worker configuration was not found.');
    return worker;
  });
}
