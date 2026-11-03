import type { AuthRecovery } from './auth';
import { type FleetAgentSummary, parseFleetAgentSummary, request } from './live-agent';

// The Boxes page: one row per rented machine, from GET /admin/fleet/boxes. A box's health is what
// its own agent reports; the dispatcher only contributes a label (see FleetBoxDispatcherState in
// packages/types/src/fleet-agent.ts, which this file mirrors by hand like the other live-* files).

export type BoxDispatcherState = 'in_rotation' | 'not_reachable' | 'disabled' | 'not_a_worker';
export type BoxHardware = {
  gpus: { index: number; name: string | null; vramTotalMib: number | null }[];
  driverVersion: string | null;
  cpuCount: number | null;
  ramTotalMib: number | null;
  diskTotalGb: number | null;
};
export type FleetBox = {
  id: string;
  label: string;
  workerId: string | null;
  dispatcher: BoxDispatcherState;
  agentEnrolled: boolean;
  heartbeatAt: string | null;
  lastSeenAt: string | null;
  agentVersion: string | null;
  hardware: BoxHardware | null;
  hardwareAt: string | null;
  telemetry: FleetAgentSummary['telemetry'];
  jobs24h: { completed: number; failed: number } | null;
  incidents: FleetAgentSummary['incidents'];
};
export type FleetBoxes = { generatedAt: string; boxes: FleetBox[] };

export type EnrollToken = {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
export type CreatedEnrollToken = EnrollToken & { token: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isTime = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const fail = (where: string): never => {
  throw new Error(`Unexpected fleet boxes response: ${where}`);
};
function exact(v: unknown, keys: string[], where: string): Obj {
  if (!isObj(v)) return fail(where);
  const want = new Set(keys);
  if (Object.keys(v).some((k) => !want.has(k)) || keys.some((k) => !(k in v))) return fail(where);
  return v;
}
function maybe<T>(v: unknown, guard: (v: unknown) => v is T, where: string): T | null {
  if (v === null) return null;
  if (!guard(v)) return fail(where);
  return v;
}
const STATES: BoxDispatcherState[] = ['in_rotation', 'not_reachable', 'disabled', 'not_a_worker'];

function parseHardware(v: unknown, at: string): BoxHardware | null {
  if (v === null) return null;
  const h = exact(v, ['gpus', 'driverVersion', 'cpuCount', 'ramTotalMib', 'diskTotalGb'], at);
  if (!Array.isArray(h.gpus) || h.gpus.length > 32) return fail(`${at}.gpus`);
  return {
    gpus: h.gpus.map((g, i) => {
      const x = exact(g, ['index', 'name', 'vramTotalMib'], `${at}.gpus[${i}]`);
      if (!isInt(x.index)) return fail(`${at}.gpus[${i}].index`);
      return {
        index: x.index,
        name: maybe(x.name, isStr, `${at}.gpus[${i}].name`),
        vramTotalMib: maybe(x.vramTotalMib, isInt, `${at}.gpus[${i}].vramTotalMib`),
      };
    }),
    driverVersion: maybe(h.driverVersion, isStr, `${at}.driverVersion`),
    cpuCount: maybe(h.cpuCount, isInt, `${at}.cpuCount`),
    ramTotalMib: maybe(h.ramTotalMib, isInt, `${at}.ramTotalMib`),
    diskTotalGb: maybe(h.diskTotalGb, isNum, `${at}.diskTotalGb`),
  };
}

export function parseFleetBoxes(value: unknown): FleetBoxes {
  const x = exact(value, ['generatedAt', 'boxes'], 'boxes');
  if (!isTime(x.generatedAt)) return fail('boxes.generatedAt');
  if (!Array.isArray(x.boxes) || x.boxes.length > 10_000) return fail('boxes.boxes');
  const boxes = x.boxes.map((raw, i): FleetBox => {
    const at = `boxes[${i}]`;
    const b = exact(
      raw,
      [
        'id',
        'label',
        'workerId',
        'dispatcher',
        'agentEnrolled',
        'heartbeatAt',
        'lastSeenAt',
        'agentVersion',
        'hardware',
        'hardwareAt',
        'telemetry',
        'jobs24h',
        'incidents',
      ],
      at,
    );
    if (!isStr(b.id) || !isStr(b.label)) return fail(`${at}.id`);
    if (!STATES.includes(b.dispatcher as BoxDispatcherState)) return fail(`${at}.dispatcher`);
    if (typeof b.agentEnrolled !== 'boolean') return fail(`${at}.agentEnrolled`);
    // The live numbers and incident counts share the agent summary's shape and rules.
    const summary = parseFleetAgentSummary(
      {
        workerId: b.id,
        heartbeatAt: b.heartbeatAt,
        telemetry: b.telemetry,
        incidents: b.incidents,
      },
      i,
    );
    let jobs24h: FleetBox['jobs24h'] = null;
    if (b.jobs24h !== null) {
      const j = exact(b.jobs24h, ['completed', 'failed'], `${at}.jobs24h`);
      if (!isInt(j.completed) || !isInt(j.failed) || j.completed < 0 || j.failed < 0)
        return fail(`${at}.jobs24h`);
      jobs24h = { completed: j.completed, failed: j.failed };
    }
    return {
      id: b.id,
      label: b.label,
      workerId: maybe(b.workerId, isStr, `${at}.workerId`),
      dispatcher: b.dispatcher as BoxDispatcherState,
      agentEnrolled: b.agentEnrolled,
      heartbeatAt: summary.heartbeatAt,
      lastSeenAt: maybe(b.lastSeenAt, isTime, `${at}.lastSeenAt`),
      agentVersion: maybe(b.agentVersion, isStr, `${at}.agentVersion`),
      hardware: parseHardware(b.hardware, `${at}.hardware`),
      hardwareAt: maybe(b.hardwareAt, isTime, `${at}.hardwareAt`),
      telemetry: summary.telemetry,
      jobs24h,
      incidents: summary.incidents,
    };
  });
  if (new Set(boxes.map((b) => b.id)).size !== boxes.length) return fail('boxes duplicate id');
  return { generatedAt: x.generatedAt, boxes };
}

function parseToken(v: unknown, at: string, withSecret: boolean): CreatedEnrollToken | EnrollToken {
  const keys = ['id', 'label', 'tokenPrefix', 'createdAt', 'revokedAt', 'lastUsedAt'];
  const t = exact(v, withSecret ? [...keys, 'token'] : keys, at);
  if (!isStr(t.id) || !isStr(t.label) || !isStr(t.tokenPrefix) || !isTime(t.createdAt))
    return fail(at);
  const base: EnrollToken = {
    id: t.id,
    label: t.label,
    tokenPrefix: t.tokenPrefix,
    createdAt: t.createdAt,
    revokedAt: maybe(t.revokedAt, isTime, `${at}.revokedAt`),
    lastUsedAt: maybe(t.lastUsedAt, isTime, `${at}.lastUsedAt`),
  };
  if (!withSecret) return base;
  if (!isStr(t.token) || !/^fe_[A-Za-z0-9_-]{43}$/.test(t.token)) return fail(`${at}.token`);
  return { ...base, token: t.token };
}
export function parseEnrollTokens(value: unknown): EnrollToken[] {
  const x = exact(value, ['tokens'], 'tokens');
  if (!Array.isArray(x.tokens) || x.tokens.length > 1000) return fail('tokens');
  return x.tokens.map((t, i) => parseToken(t, `tokens[${i}]`, false));
}
export function parseCreatedEnrollToken(value: unknown): CreatedEnrollToken {
  return parseToken(value, 'created token', true) as CreatedEnrollToken;
}

export function loadBoxes(baseUrl: string, token: string, recovery?: AuthRecovery) {
  return request(baseUrl, token, '/admin/fleet/boxes', parseFleetBoxes, { recovery });
}
export function loadEnrollTokens(baseUrl: string, token: string, recovery?: AuthRecovery) {
  return request(baseUrl, token, '/admin/fleet/enroll-tokens', parseEnrollTokens, { recovery });
}
export function createEnrollToken(
  baseUrl: string,
  token: string,
  label: string,
  recovery?: AuthRecovery,
) {
  return request(baseUrl, token, '/admin/fleet/enroll-tokens', parseCreatedEnrollToken, {
    method: 'POST',
    body: { label },
    recovery,
  });
}
export function revokeEnrollToken(
  baseUrl: string,
  token: string,
  id: string,
  recovery?: AuthRecovery,
) {
  return request(
    baseUrl,
    token,
    `/admin/fleet/enroll-tokens/${encodeURIComponent(id)}`,
    () => undefined,
    { method: 'DELETE', recovery },
  );
}

/** One word for the row's health, from the box's own agent only. Never from the dispatcher. */
export type BoxHealth = 'ok' | 'warn' | 'down' | 'silent' | 'not_enrolled';
export const DISK_WARN_PCT = 90;
export const TEMP_WARN_C = 85;
export function boxHealth(b: FleetBox): BoxHealth {
  if (!b.agentEnrolled) return 'not_enrolled';
  const t = b.telemetry;
  if (!b.heartbeatAt || !t || t.stale) return 'silent';
  if (t.comfy && t.comfy.reachable === false) return 'down';
  if (
    (t.diskUsedPctMax !== null && t.diskUsedPctMax >= DISK_WARN_PCT) ||
    (t.tempMaxC !== null && t.tempMaxC >= TEMP_WARN_C) ||
    b.incidents.critical > 0 ||
    b.incidents.warning > 0
  )
    return 'warn';
  return 'ok';
}
