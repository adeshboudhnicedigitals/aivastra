import { AuthError, type AuthRecovery, fetchWithRefresh } from './auth';

export type IncidentState = 'OPEN' | 'ACK' | 'RECOVERED';
export type IncidentSeverity = 'info' | 'warning' | 'critical';
export type IncidentEventKind = 'OPENED' | 'ESCALATED' | 'ACK' | 'NOTE' | 'RECOVERED';
export type IncidentPerson = { id: string; email: string | null };
export type FleetIncident = {
  id: string;
  ruleKey: string;
  workerId: string;
  state: IncidentState;
  severity: IncidentSeverity;
  summary: string;
  evidence: Record<string, string | number | boolean | null>;
  openedAt: string;
  ackedAt: string | null;
  ackedBy: IncidentPerson | null;
  recoveredAt: string | null;
};
export type IncidentEvent = {
  id: number;
  kind: IncidentEventKind;
  at: string;
  actor: IncidentPerson | null;
  text: string | null;
};
export type IncidentList = { generatedAt: string; total: number; items: FleetIncident[] };
export type IncidentDetail = {
  generatedAt: string;
  incident: FleetIncident;
  events: IncidentEvent[];
};
export type IncidentSummary = {
  generatedAt: string;
  open: number;
  acknowledged: number;
  bySeverity: { critical: number; warning: number; info: number };
};
export type AlertRuleParam = {
  value: number;
  default: number;
  min: number;
  max: number;
  unit: string;
  label: string;
};
export type AlertRule = {
  key: string;
  description: string;
  severity: IncidentSeverity;
  enabled: boolean;
  forSeconds: number;
  clearSeconds: number;
  params: Record<string, AlertRuleParam>;
  updatedAt: string | null;
};
export type AlertRules = { generatedAt: string; rules: AlertRule[] };
export type IncidentFilters = {
  state?: IncidentState[];
  workerId?: string;
  severity?: IncidentSeverity;
  ruleKey?: string;
  limit?: number;
  offset?: number;
};
export type AlertRulePatch = {
  enabled?: boolean;
  severity?: IncidentSeverity;
  forSeconds?: number;
  clearSeconds?: number;
  params?: Record<string, number>;
};
export type IncidentRequestOptions = { fetchImpl?: typeof fetch; recovery?: AuthRecovery };

const ruleKeys = new Set([
  'agent_silent',
  'comfy_down_box_up',
  'box_unreachable',
  'thermal_collapse',
  'gpu_temp_high',
  'disk_high',
  'swap_active',
  'ram_low',
  'foreign_vram',
  'clock_skew',
  'ingest_rejected',
]);
const states = new Set<IncidentState>(['OPEN', 'ACK', 'RECOVERED']);
const severities = new Set<IncidentSeverity>(['info', 'warning', 'critical']);
const eventKinds = new Set<IncidentEventKind>(['OPENED', 'ESCALATED', 'ACK', 'NOTE', 'RECOVERED']);
type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStr = (value: unknown): value is string => typeof value === 'string';
const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
const isNum = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isInt = (value: unknown): value is number => isNum(value) && Number.isInteger(value);
const isDate = (value: unknown): value is string =>
  isStr(value) && !Number.isNaN(Date.parse(value));
const invalid = (where: string): never => {
  throw new Error(`Unexpected fleet incidents response: ${where}`);
};

function object(value: unknown, keys: string[], where: string): Obj {
  if (!isObj(value)) return invalid(where);
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value)))
    return invalid(where);
  return value;
}
function str(value: unknown, where: string): string {
  return isStr(value) ? value : invalid(where);
}
function date(value: unknown, where: string): string {
  return isDate(value) ? value : invalid(where);
}
function int(value: unknown, where: string, minimum = Number.MIN_SAFE_INTEGER): number {
  return isInt(value) && value >= minimum ? value : invalid(where);
}
function nullable<T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
  where: string,
): T | null {
  return value === null || guard(value) ? value : invalid(where);
}
function list<T>(value: unknown, where: string, parse: (item: unknown, index: number) => T): T[] {
  if (!Array.isArray(value) || value.length > 10_000) return invalid(where);
  return value.map(parse);
}
function parsePerson(value: unknown, where: string): IncidentPerson | null {
  if (value === null) return null;
  const x = object(value, ['id', 'email'], where);
  return { id: str(x.id, `${where}.id`), email: nullable(x.email, isStr, `${where}.email`) };
}
function parseIncident(value: unknown, index: number): FleetIncident {
  const at = `items[${index}]`;
  const x = object(
    value,
    [
      'id',
      'ruleKey',
      'workerId',
      'state',
      'severity',
      'summary',
      'evidence',
      'openedAt',
      'ackedAt',
      'ackedBy',
      'recoveredAt',
    ],
    at,
  );
  if (!isStr(x.ruleKey) || !ruleKeys.has(x.ruleKey)) return invalid(`${at}.ruleKey`);
  if (!isStr(x.state) || !states.has(x.state as IncidentState)) return invalid(`${at}.state`);
  if (!isStr(x.severity) || !severities.has(x.severity as IncidentSeverity))
    return invalid(`${at}.severity`);
  if (!isObj(x.evidence)) return invalid(`${at}.evidence`);
  const evidence: FleetIncident['evidence'] = {};
  for (const [key, value] of Object.entries(x.evidence)) {
    if (!(value === null || isStr(value) || isBool(value) || isNum(value)))
      return invalid(`${at}.evidence.${key}`);
    evidence[key] = value;
  }
  return {
    id: str(x.id, `${at}.id`),
    ruleKey: x.ruleKey,
    workerId: str(x.workerId, `${at}.workerId`),
    state: x.state as IncidentState,
    severity: x.severity as IncidentSeverity,
    summary: str(x.summary, `${at}.summary`),
    evidence,
    openedAt: date(x.openedAt, `${at}.openedAt`),
    ackedAt: nullable(x.ackedAt, isDate, `${at}.ackedAt`),
    ackedBy: parsePerson(x.ackedBy, `${at}.ackedBy`),
    recoveredAt: nullable(x.recoveredAt, isDate, `${at}.recoveredAt`),
  };
}
function parseListIncident(value: unknown, index: number): FleetIncident {
  return parseIncident(value, index);
}
function parseEvent(value: unknown, index: number): IncidentEvent {
  const at = `events[${index}]`;
  const x = object(value, ['id', 'kind', 'at', 'actor', 'text'], at);
  if (!isStr(x.kind) || !eventKinds.has(x.kind as IncidentEventKind)) return invalid(`${at}.kind`);
  return {
    id: int(x.id, `${at}.id`),
    kind: x.kind as IncidentEventKind,
    at: date(x.at, `${at}.at`),
    actor: parsePerson(x.actor, `${at}.actor`),
    text: nullable(x.text, isStr, `${at}.text`),
  };
}
function generatedAt(x: Obj, where: string) {
  return date(x.generatedAt, `${where}.generatedAt`);
}

export function parseIncidentList(value: unknown): IncidentList {
  const x = object(value, ['generatedAt', 'total', 'items'], 'list');
  return {
    generatedAt: generatedAt(x, 'list'),
    total: int(x.total, 'list.total', 0),
    items: list(x.items, 'list.items', parseListIncident),
  };
}
export function parseIncidentDetail(value: unknown): IncidentDetail {
  const x = object(value, ['generatedAt', 'incident', 'events'], 'detail');
  return {
    generatedAt: generatedAt(x, 'detail'),
    incident: parseIncident(x.incident, 0),
    events: list(x.events, 'detail.events', parseEvent),
  };
}
export function parseIncidentSummary(value: unknown): IncidentSummary {
  const x = object(value, ['generatedAt', 'open', 'acknowledged', 'bySeverity'], 'summary');
  const counts = object(x.bySeverity, ['critical', 'warning', 'info'], 'summary.bySeverity');
  return {
    generatedAt: generatedAt(x, 'summary'),
    open: int(x.open, 'summary.open', 0),
    acknowledged: int(x.acknowledged, 'summary.acknowledged', 0),
    bySeverity: {
      critical: int(counts.critical, 'summary.bySeverity.critical', 0),
      warning: int(counts.warning, 'summary.bySeverity.warning', 0),
      info: int(counts.info, 'summary.bySeverity.info', 0),
    },
  };
}
function parseParam(value: unknown, where: string): AlertRuleParam {
  const x = object(value, ['value', 'default', 'min', 'max', 'unit', 'label'], where);
  if (![x.value, x.default, x.min, x.max].every(isNum)) return invalid(where);
  if ((x.min as number) > (x.max as number)) return invalid(`${where}.min/max`);
  return {
    value: x.value as number,
    default: x.default as number,
    min: x.min as number,
    max: x.max as number,
    unit: str(x.unit, `${where}.unit`),
    label: str(x.label, `${where}.label`),
  };
}
function parseRule(value: unknown, index: number): AlertRule {
  const at = `rules[${index}]`;
  const x = object(
    value,
    [
      'key',
      'description',
      'severity',
      'enabled',
      'forSeconds',
      'clearSeconds',
      'params',
      'updatedAt',
    ],
    at,
  );
  if (!isStr(x.key) || !ruleKeys.has(x.key)) return invalid(`${at}.key`);
  if (!isStr(x.severity) || !severities.has(x.severity as IncidentSeverity))
    return invalid(`${at}.severity`);
  if (!isObj(x.params)) return invalid(`${at}.params`);
  const params: Record<string, AlertRuleParam> = {};
  for (const [key, param] of Object.entries(x.params))
    params[key] = parseParam(param, `${at}.params.${key}`);
  return {
    key: x.key,
    description: str(x.description, `${at}.description`),
    severity: x.severity as IncidentSeverity,
    enabled: isBool(x.enabled) ? x.enabled : invalid(`${at}.enabled`),
    forSeconds: int(x.forSeconds, `${at}.forSeconds`, 0),
    clearSeconds: int(x.clearSeconds, `${at}.clearSeconds`, 0),
    params,
    updatedAt: nullable(x.updatedAt, isDate, `${at}.updatedAt`),
  };
}
export function parseAlertRules(value: unknown): AlertRules {
  const x = object(value, ['generatedAt', 'rules'], 'rules');
  const rules = list(x.rules, 'rules.items', parseRule);
  if (
    rules.length !== ruleKeys.size ||
    new Set(rules.map((rule) => rule.key)).size !== ruleKeys.size
  )
    return invalid('rules.count');
  return { generatedAt: generatedAt(x, 'rules'), rules };
}

export class FleetIncidentsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function incidentErrorMessage(error: unknown, capability: 'view' | 'ack' | 'rules'): string {
  if (error instanceof FleetIncidentsApiError && error.status === 401)
    return 'Session expired, sign in again.';
  if (error instanceof FleetIncidentsApiError && error.status === 403) {
    if (capability === 'ack') return 'Your role lacks fleet.ack.';
    if (capability === 'rules') return 'Your role lacks fleet.operate (SUPER_ADMIN).';
    return 'Your role lacks fleet.view.';
  }
  return error instanceof Error ? error.message : 'Fleet API request failed.';
}
async function request<T>(
  baseUrl: string,
  token: string,
  path: string,
  parse: (value: unknown) => T,
  options: IncidentRequestOptions & { method?: string; body?: unknown } = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const send = (accessToken: string) =>
    fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
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
    if (cause instanceof AuthError) throw new FleetIncidentsApiError(401, cause.message);
    throw new FleetIncidentsApiError(0, 'Fleet API unavailable.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new FleetIncidentsApiError(
      response.status,
      isObj(payload) && isStr(payload.message)
        ? payload.message
        : `Fleet API returned ${response.status}.`,
    );
  }
  return parse(await response.json().catch(() => null));
}

export function loadIncidents(
  baseUrl: string,
  token: string,
  filters: IncidentFilters = {},
  options: IncidentRequestOptions = {},
) {
  const query = new URLSearchParams();
  if (filters.state?.length) query.set('state', filters.state.join(','));
  if (filters.workerId?.trim()) query.set('workerId', filters.workerId.trim());
  if (filters.severity) query.set('severity', filters.severity);
  if (filters.ruleKey) query.set('ruleKey', filters.ruleKey);
  query.set('limit', String(filters.limit ?? 50));
  query.set('offset', String(filters.offset ?? 0));
  return request(baseUrl, token, `/admin/fleet/incidents?${query}`, parseIncidentList, options);
}
export function loadIncident(
  baseUrl: string,
  token: string,
  id: string,
  options: IncidentRequestOptions = {},
) {
  return request(
    baseUrl,
    token,
    `/admin/fleet/incidents/${encodeURIComponent(id)}`,
    parseIncidentDetail,
    options,
  );
}
export function loadIncidentSummary(
  baseUrl: string,
  token: string,
  options: IncidentRequestOptions = {},
) {
  return request(baseUrl, token, '/admin/fleet/incidents/summary', parseIncidentSummary, options);
}
function parseAck(value: unknown) {
  const x = object(value, ['ok', 'changed', 'state'], 'ack mutation');
  if (
    x.ok !== true ||
    !isBool(x.changed) ||
    !isStr(x.state) ||
    !states.has(x.state as IncidentState)
  )
    return invalid('ack mutation');
  return { ok: true as const, changed: x.changed, state: x.state as IncidentState };
}
export function acknowledgeIncident(
  baseUrl: string,
  token: string,
  id: string,
  note?: string,
  options: IncidentRequestOptions = {},
) {
  return request(baseUrl, token, `/admin/fleet/incidents/${encodeURIComponent(id)}/ack`, parseAck, {
    ...options,
    method: 'POST',
    body: note?.trim() ? { note: note.trim() } : {},
  });
}
export function addIncidentNote(
  baseUrl: string,
  token: string,
  id: string,
  text: string,
  options: IncidentRequestOptions = {},
) {
  return request(
    baseUrl,
    token,
    `/admin/fleet/incidents/${encodeURIComponent(id)}/notes`,
    (value) => {
      const x = object(value, ['ok', 'eventId'], 'note mutation');
      if (x.ok !== true) return invalid('note mutation');
      return { ok: true as const, eventId: int(x.eventId, 'note mutation.eventId') };
    },
    { ...options, method: 'POST', body: { text: text.trim() } },
  );
}
export function loadAlertRules(
  baseUrl: string,
  token: string,
  options: IncidentRequestOptions = {},
) {
  return request(baseUrl, token, '/admin/fleet/alert-rules', parseAlertRules, options);
}
export function patchAlertRule(
  baseUrl: string,
  token: string,
  key: string,
  patch: AlertRulePatch,
  options: IncidentRequestOptions = {},
) {
  return request(
    baseUrl,
    token,
    `/admin/fleet/alert-rules/${encodeURIComponent(key)}`,
    (value) => parseRule(value, 0),
    { ...options, method: 'PATCH', body: patch },
  );
}
