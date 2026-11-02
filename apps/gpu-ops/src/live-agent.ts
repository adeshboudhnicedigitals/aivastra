import { AuthError, type AuthRecovery, fetchWithRefresh } from './auth';

export type AgentKeyView = {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  agentVersion: string | null;
};
export type AgentStatus = {
  workerId: string;
  generatedAt: string;
  keys: AgentKeyView[];
  heartbeat: {
    receivedAt: string;
    observedAt: string;
    agentVersion: string;
    bootId: string;
  } | null;
  rejectsLastHour: number;
};
export type AgentGpu = {
  index: number;
  name: string | null;
  tempC: number | null;
  memTempC: number | null;
  fanPct: number | null;
  pstate: string | null;
  smClockMhz: number | null;
  smClockMaxMhz: number | null;
  memClockMhz: number | null;
  powerW: number | null;
  powerLimitW: number | null;
  utilGpuPct: number | null;
  utilMemPct: number | null;
  vramUsedMib: number | null;
  vramTotalMib: number | null;
  throttleReasons: string | null;
  eccUncorrected: number | null;
};
export type AgentTelemetry = {
  v: 1;
  workerId: string;
  agentVersion: string;
  bootId: string;
  seq: number;
  observedAt: number;
  gpus: AgentGpu[];
  computeApps: { gpuIndex: number; name: string; vramMib: number | null }[];
  host: {
    cpuCount: number | null;
    load1: number | null;
    load5: number | null;
    load15: number | null;
    ramTotalMib: number | null;
    ramAvailMib: number | null;
    swapTotalMib: number | null;
    swapUsedMib: number | null;
    memPsiSome10: number | null;
    uptimeSec: number | null;
    ntpSynced: boolean | null;
    disks: {
      mount: string;
      totalGb: number | null;
      usedGb: number | null;
      inodeUsedPct: number | null;
    }[];
  };
  services: { name: string; active: string; sub: string | null; restarts: number | null }[];
  comfy: {
    instance: string;
    reachable: boolean | null;
    running: number | null;
    pending: number | null;
  }[];
};
export type AgentTelemetryView = {
  workerId: string;
  generatedAt: string;
  telemetry: AgentTelemetry | null;
  receivedAt: string | null;
  stale: boolean;
  clockSkewMs: number | null;
  signals: {
    index: number;
    clockRatio: number | null;
    thermalCollapseNow: boolean | null;
    foreignVramMib: number | null;
  }[];
};
export type CreatedAgentKey = AgentKeyView & { key: string };

export class FleetAgentApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function agentKeyErrorMessage(error: unknown): string {
  if (error instanceof FleetAgentApiError && error.status === 401)
    return 'Session expired, sign in again.';
  if (error instanceof FleetAgentApiError && error.status === 403)
    return 'Your role lacks fleet.operate (SUPER_ADMIN only).';
  if (error instanceof FleetAgentApiError && error.status === 409)
    return error.message || 'Too many active keys for this worker.';
  return error instanceof Error ? error.message : 'Fleet API request failed.';
}

export function drainErrorMessage(error: unknown): string {
  if (error instanceof FleetAgentApiError && error.status === 401)
    return 'Session expired, sign in again.';
  if (error instanceof FleetAgentApiError && error.status === 403)
    return 'Your role cannot drain workers (needs workers.drain).';
  if (error instanceof FleetAgentApiError && error.status === 404)
    return 'Worker is not registered with the dispatcher.';
  if (error instanceof FleetAgentApiError && error.status === 400)
    return error.message || 'Reason must contain 3–300 characters.';
  return error instanceof Error ? error.message : 'Fleet API request failed.';
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStr = (value: unknown): value is string => typeof value === 'string';
const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
const isNum = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isInt = (value: unknown): value is number => isNum(value) && Number.isInteger(value);
const isTime = (value: unknown): value is string =>
  isStr(value) && !Number.isNaN(Date.parse(value));
const isNullOr = <T>(value: unknown, guard: (value: unknown) => value is T): value is T | null =>
  value === null || guard(value);
const fail = (where: string): never => {
  throw new Error(`Unexpected fleet agent response: ${where}`);
};

function obj(value: unknown, keys: string[], where: string): Obj {
  if (!isObj(value)) return fail(where);
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value)))
    return fail(where);
  return value;
}
function string(value: unknown, where: string): string {
  if (!isStr(value)) return fail(where);
  return value;
}
function time(value: unknown, where: string): string {
  if (!isTime(value)) return fail(where);
  return value;
}
function integer(value: unknown, where: string): number {
  if (!isInt(value)) return fail(where);
  return value;
}
function nullable<T>(
  value: unknown,
  guard: (value: unknown) => value is T,
  where: string,
): T | null {
  if (!isNullOr(value, guard)) return fail(where);
  return value;
}
function boundedArray<T>(
  value: unknown,
  max: number,
  where: string,
  parse: (item: unknown, index: number) => T,
): T[] {
  if (!Array.isArray(value) || value.length > max) return fail(where);
  return value.map(parse);
}

function parseKey(value: unknown, where: string): AgentKeyView {
  const x = obj(
    value,
    ['id', 'label', 'keyPrefix', 'createdAt', 'revokedAt', 'lastSeenAt', 'agentVersion'],
    where,
  );
  return {
    id: string(x.id, `${where}.id`),
    label: string(x.label, `${where}.label`),
    keyPrefix: string(x.keyPrefix, `${where}.keyPrefix`),
    createdAt: time(x.createdAt, `${where}.createdAt`),
    revokedAt: nullable(x.revokedAt, isTime, `${where}.revokedAt`),
    lastSeenAt: nullable(x.lastSeenAt, isTime, `${where}.lastSeenAt`),
    agentVersion: nullable(x.agentVersion, isStr, `${where}.agentVersion`),
  };
}

export function parseAgentStatus(value: unknown): AgentStatus {
  const x = obj(
    value,
    ['workerId', 'generatedAt', 'keys', 'heartbeat', 'rejectsLastHour'],
    'status',
  );
  const heartbeat =
    x.heartbeat === null
      ? null
      : (() => {
          const h = obj(
            x.heartbeat,
            ['receivedAt', 'observedAt', 'agentVersion', 'bootId'],
            'status.heartbeat',
          );
          return {
            receivedAt: time(h.receivedAt, 'heartbeat.receivedAt'),
            observedAt: time(h.observedAt, 'heartbeat.observedAt'),
            agentVersion: string(h.agentVersion, 'heartbeat.agentVersion'),
            bootId: string(h.bootId, 'heartbeat.bootId'),
          };
        })();
  return {
    workerId: string(x.workerId, 'status.workerId'),
    generatedAt: time(x.generatedAt, 'status.generatedAt'),
    keys: boundedArray(x.keys, 100, 'status.keys', (item, index) =>
      parseKey(item, `status.keys[${index}]`),
    ),
    heartbeat,
    rejectsLastHour: integer(x.rejectsLastHour, 'status.rejectsLastHour'),
  };
}

function parseGpu(value: unknown, index: number): AgentGpu {
  const at = `telemetry.gpus[${index}]`;
  const keys = [
    'index',
    'name',
    'tempC',
    'memTempC',
    'fanPct',
    'pstate',
    'smClockMhz',
    'smClockMaxMhz',
    'memClockMhz',
    'powerW',
    'powerLimitW',
    'utilGpuPct',
    'utilMemPct',
    'vramUsedMib',
    'vramTotalMib',
    'throttleReasons',
    'eccUncorrected',
  ];
  const x = obj(value, keys, at);
  const nullableNum = (key: string) => nullable(x[key], isNum, `${at}.${key}`);
  const nullableInt = (key: string) => nullable(x[key], isInt, `${at}.${key}`);
  return {
    index: integer(x.index, `${at}.index`),
    name: nullable(x.name, isStr, `${at}.name`),
    tempC: nullableNum('tempC'),
    memTempC: nullableNum('memTempC'),
    fanPct: nullableNum('fanPct'),
    pstate: nullable(x.pstate, isStr, `${at}.pstate`),
    smClockMhz: nullableInt('smClockMhz'),
    smClockMaxMhz: nullableInt('smClockMaxMhz'),
    memClockMhz: nullableInt('memClockMhz'),
    powerW: nullableNum('powerW'),
    powerLimitW: nullableNum('powerLimitW'),
    utilGpuPct: nullableNum('utilGpuPct'),
    utilMemPct: nullableNum('utilMemPct'),
    vramUsedMib: nullableInt('vramUsedMib'),
    vramTotalMib: nullableInt('vramTotalMib'),
    throttleReasons: nullable(x.throttleReasons, isStr, `${at}.throttleReasons`),
    eccUncorrected: nullableInt('eccUncorrected'),
  };
}

function parseTelemetry(value: unknown): AgentTelemetry {
  const at = 'telemetry';
  const x = obj(
    value,
    [
      'v',
      'workerId',
      'agentVersion',
      'bootId',
      'seq',
      'observedAt',
      'gpus',
      'computeApps',
      'host',
      'services',
      'comfy',
    ],
    at,
  );
  const host = obj(
    x.host,
    [
      'cpuCount',
      'load1',
      'load5',
      'load15',
      'ramTotalMib',
      'ramAvailMib',
      'swapTotalMib',
      'swapUsedMib',
      'memPsiSome10',
      'uptimeSec',
      'ntpSynced',
      'disks',
    ],
    `${at}.host`,
  );
  const nullableHostNum = (key: string, integerValue = false) =>
    nullable(host[key], integerValue ? isInt : isNum, `host.${key}`);
  return {
    v: x.v === 1 ? 1 : fail('telemetry.v'),
    workerId: string(x.workerId, `${at}.workerId`),
    agentVersion: string(x.agentVersion, `${at}.agentVersion`),
    bootId: string(x.bootId, `${at}.bootId`),
    seq: integer(x.seq, `${at}.seq`),
    observedAt: integer(x.observedAt, `${at}.observedAt`),
    gpus: boundedArray(x.gpus, 16, `${at}.gpus`, parseGpu),
    computeApps: boundedArray(x.computeApps, 64, `${at}.computeApps`, (value, i) => {
      const a = obj(value, ['gpuIndex', 'name', 'vramMib'], `computeApps[${i}]`);
      return {
        gpuIndex: integer(a.gpuIndex, `computeApps[${i}].gpuIndex`),
        name: string(a.name, `computeApps[${i}].name`),
        vramMib: nullable(a.vramMib, isInt, `computeApps[${i}].vramMib`),
      };
    }),
    host: {
      cpuCount: nullableHostNum('cpuCount', true),
      load1: nullableHostNum('load1'),
      load5: nullableHostNum('load5'),
      load15: nullableHostNum('load15'),
      ramTotalMib: nullableHostNum('ramTotalMib', true),
      ramAvailMib: nullableHostNum('ramAvailMib', true),
      swapTotalMib: nullableHostNum('swapTotalMib', true),
      swapUsedMib: nullableHostNum('swapUsedMib', true),
      memPsiSome10: nullableHostNum('memPsiSome10'),
      uptimeSec: nullableHostNum('uptimeSec', true),
      ntpSynced: nullable(host.ntpSynced, isBool, 'host.ntpSynced'),
      disks: boundedArray(host.disks, 16, 'host.disks', (value, i) => {
        const d = obj(value, ['mount', 'totalGb', 'usedGb', 'inodeUsedPct'], `host.disks[${i}]`);
        return {
          mount: string(d.mount, `disks[${i}].mount`),
          totalGb: nullable(d.totalGb, isNum, `disks[${i}].totalGb`),
          usedGb: nullable(d.usedGb, isNum, `disks[${i}].usedGb`),
          inodeUsedPct: nullable(d.inodeUsedPct, isNum, `disks[${i}].inodeUsedPct`),
        };
      }),
    },
    services: boundedArray(x.services, 16, `${at}.services`, (value, i) => {
      const s = obj(value, ['name', 'active', 'sub', 'restarts'], `services[${i}]`);
      return {
        name: string(s.name, `services[${i}].name`),
        active: string(s.active, `services[${i}].active`),
        sub: nullable(s.sub, isStr, `services[${i}].sub`),
        restarts: nullable(s.restarts, isInt, `services[${i}].restarts`),
      };
    }),
    comfy: boundedArray(x.comfy, 8, `${at}.comfy`, (value, i) => {
      const c = obj(value, ['instance', 'reachable', 'running', 'pending'], `comfy[${i}]`);
      return {
        instance: string(c.instance, `comfy[${i}].instance`),
        reachable: nullable(c.reachable, isBool, `comfy[${i}].reachable`),
        running: nullable(c.running, isInt, `comfy[${i}].running`),
        pending: nullable(c.pending, isInt, `comfy[${i}].pending`),
      };
    }),
  };
}

export function parseAgentTelemetryView(value: unknown): AgentTelemetryView {
  const x = obj(
    value,
    ['workerId', 'generatedAt', 'telemetry', 'receivedAt', 'stale', 'clockSkewMs', 'signals'],
    'telemetry view',
  );
  return {
    workerId: string(x.workerId, 'view.workerId'),
    generatedAt: time(x.generatedAt, 'view.generatedAt'),
    telemetry: x.telemetry === null ? null : parseTelemetry(x.telemetry),
    receivedAt: nullable(x.receivedAt, isTime, 'view.receivedAt'),
    stale: isBool(x.stale) ? x.stale : fail('view.stale'),
    clockSkewMs: nullable(x.clockSkewMs, isInt, 'view.clockSkewMs'),
    signals: boundedArray(x.signals, 16, 'view.signals', (value, i) => {
      const s = obj(
        value,
        ['index', 'clockRatio', 'thermalCollapseNow', 'foreignVramMib'],
        `signals[${i}]`,
      );
      return {
        index: integer(s.index, `signals[${i}].index`),
        clockRatio: nullable(s.clockRatio, isNum, `signals[${i}].clockRatio`),
        thermalCollapseNow: nullable(
          s.thermalCollapseNow,
          isBool,
          `signals[${i}].thermalCollapseNow`,
        ),
        foreignVramMib: nullable(s.foreignVramMib, isInt, `signals[${i}].foreignVramMib`),
      };
    }),
  };
}

export function parseCreatedAgentKey(value: unknown): CreatedAgentKey {
  const x = obj(
    value,
    ['id', 'label', 'keyPrefix', 'createdAt', 'revokedAt', 'lastSeenAt', 'agentVersion', 'key'],
    'created key',
  );
  return {
    ...parseKey(
      {
        id: x.id,
        label: x.label,
        keyPrefix: x.keyPrefix,
        createdAt: x.createdAt,
        revokedAt: x.revokedAt,
        lastSeenAt: x.lastSeenAt,
        agentVersion: x.agentVersion,
      },
      'created key',
    ),
    key: string(x.key, 'created key.key'),
  };
}

async function request<T>(
  baseUrl: string,
  token: string,
  path: string,
  parse: (value: unknown) => T,
  options: {
    method?: string;
    body?: unknown;
    fetchImpl?: typeof fetch;
    recovery?: AuthRecovery;
  } = {},
): Promise<T> {
  let response: Response;
  const send = (accessToken: string) =>
    (options.fetchImpl ?? fetch)(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(10_000),
    });
  try {
    response = options.recovery
      ? await fetchWithRefresh(send, token, options.recovery)
      : await send(token);
  } catch (cause) {
    if (cause instanceof AuthError) throw new FleetAgentApiError(401, cause.message);
    throw new FleetAgentApiError(0, 'Fleet API unavailable.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      isObj(payload) && isStr(payload.message)
        ? payload.message
        : `Fleet API returned ${response.status}.`;
    throw new FleetAgentApiError(response.status, message);
  }
  const payload: unknown = await response.json().catch(() => null);
  return parse(payload);
}

export function loadAgentStatus(
  baseUrl: string,
  token: string,
  workerId: string,
  recovery?: AuthRecovery,
  fetchImpl?: typeof fetch,
) {
  return request(
    baseUrl,
    token,
    `/admin/fleet/workers/${encodeURIComponent(workerId)}/agent`,
    parseAgentStatus,
    { recovery, fetchImpl },
  );
}
export function loadAgentTelemetry(
  baseUrl: string,
  token: string,
  workerId: string,
  fetchImpl?: typeof fetch,
  recovery?: AuthRecovery,
) {
  return request(
    baseUrl,
    token,
    `/admin/fleet/workers/${encodeURIComponent(workerId)}/telemetry`,
    parseAgentTelemetryView,
    { fetchImpl, recovery },
  );
}
export function createAgentKey(
  baseUrl: string,
  token: string,
  workerId: string,
  label?: string,
  fetchImpl?: typeof fetch,
  recovery?: AuthRecovery,
) {
  return request(
    baseUrl,
    token,
    `/admin/fleet/workers/${encodeURIComponent(workerId)}/agent-keys`,
    parseCreatedAgentKey,
    { method: 'POST', body: label ? { label } : {}, fetchImpl, recovery },
  );
}
export function revokeAgentKey(
  baseUrl: string,
  token: string,
  keyId: string,
  fetchImpl?: typeof fetch,
  recovery?: AuthRecovery,
) {
  return request(
    baseUrl,
    token,
    `/admin/fleet/agent-keys/${encodeURIComponent(keyId)}`,
    parseMutation,
    { method: 'DELETE', fetchImpl, recovery },
  );
}
export function drainWorker(
  baseUrl: string,
  token: string,
  workerId: string,
  action: 'drain' | 'undrain',
  reason: string,
  fetchImpl?: typeof fetch,
  recovery?: AuthRecovery,
) {
  return request(
    baseUrl,
    token,
    `/admin/workers/${encodeURIComponent(workerId)}/${action}`,
    parseMutation,
    { method: 'POST', body: { reason }, fetchImpl, recovery },
  );
}
function parseMutation(value: unknown) {
  const x = obj(value, ['ok', 'changed'], 'mutation');
  if (x.ok !== true || !isBool(x.changed)) return fail('mutation');
  return { ok: true as const, changed: x.changed };
}
