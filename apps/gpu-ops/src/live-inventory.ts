import { AuthError, type AuthRecovery, fetchWithRefresh } from './auth';
import type { FleetSnapshot, GpuView, HostView } from './contracts';

export type InventoryReview = { note: string; reviewedBy: string | null; reviewedAt: string };
export type InventoryHost = {
  id: string;
  label: string;
  provider: string | null;
  rented: boolean | null;
  monthlyCostUsd: number | null;
  inventoryVerified: boolean;
  updatedAt: string;
  latestReview: InventoryReview | null;
};
export type InventoryGpu = {
  id: string;
  hostId: string;
  model: string | null;
  vramTotalMb: number | null;
  updatedAt: string;
};
export type InventoryWorker = {
  workerId: string;
  label: string;
  hostId: string | null;
  gpuId: string | null;
};
export type Inventory = {
  generatedAt: string;
  hosts: InventoryHost[];
  gpus: InventoryGpu[];
  workers: InventoryWorker[];
};
export type HostInput = {
  label: string;
  provider: string | null;
  rented: boolean | null;
  monthlyCostUsd: number | null;
  inventoryVerified: boolean;
  reason: string;
};
export type GpuInput = {
  hostId: string;
  model: string | null;
  vramTotalMb: number | null;
  reason: string;
};

export class FleetInventoryApiError extends Error {
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
const bad = (where: string): never => {
  throw new FleetInventoryApiError(
    0,
    `Fleet API returned an unexpected inventory response (${where}).`,
  );
};
const strOrNull = (v: unknown, where: string) => (v === null || isStr(v) ? v : bad(where));
const boolOrNull = (v: unknown, where: string) =>
  v === null || typeof v === 'boolean' ? v : bad(where);
const numOrNull = (v: unknown, where: string) =>
  v === null || (typeof v === 'number' && Number.isFinite(v)) ? v : bad(where);
const arr = (v: unknown, where: string): unknown[] => (Array.isArray(v) ? v : bad(where));

function parseHost(v: unknown, i: number): InventoryHost {
  const at = `hosts[${i}]`;
  if (!isObj(v)) return bad(at);
  if (!isStr(v.id) || !isStr(v.label)) return bad(`${at}.id`);
  if (typeof v.inventoryVerified !== 'boolean') return bad(`${at}.inventoryVerified`);
  if (!isDate(v.updatedAt)) return bad(`${at}.updatedAt`);
  let latestReview: InventoryReview | null = null;
  if (v.latestReview !== null) {
    const r = v.latestReview;
    if (!isObj(r) || !isStr(r.note) || !isDate(r.reviewedAt)) return bad(`${at}.latestReview`);
    latestReview = {
      note: r.note,
      reviewedBy: strOrNull(r.reviewedBy, `${at}.latestReview.reviewedBy`),
      reviewedAt: r.reviewedAt,
    };
  }
  return {
    id: v.id,
    label: v.label,
    provider: strOrNull(v.provider, `${at}.provider`),
    rented: boolOrNull(v.rented, `${at}.rented`),
    monthlyCostUsd: numOrNull(v.monthlyCostUsd, `${at}.monthlyCostUsd`),
    inventoryVerified: v.inventoryVerified,
    updatedAt: v.updatedAt,
    latestReview,
  };
}
function parseGpu(v: unknown, i: number): InventoryGpu {
  const at = `gpus[${i}]`;
  if (!isObj(v) || !isStr(v.id) || !isStr(v.hostId)) return bad(at);
  if (!isDate(v.updatedAt)) return bad(`${at}.updatedAt`);
  return {
    id: v.id,
    hostId: v.hostId,
    model: strOrNull(v.model, `${at}.model`),
    vramTotalMb: numOrNull(v.vramTotalMb, `${at}.vramTotalMb`),
    updatedAt: v.updatedAt,
  };
}
function parseWorker(v: unknown, i: number): InventoryWorker {
  const at = `workers[${i}]`;
  if (!isObj(v) || !isStr(v.workerId) || !isStr(v.label)) return bad(at);
  const hostId = strOrNull(v.hostId, `${at}.hostId`);
  const gpuId = strOrNull(v.gpuId, `${at}.gpuId`);
  // A half mapping would show a worker on a host with no GPU (or the reverse): refuse it.
  if ((hostId === null) !== (gpuId === null)) return bad(`${at} mapping`);
  return { workerId: v.workerId, label: v.label, hostId, gpuId };
}
export function parseInventory(value: unknown): Inventory {
  if (!isObj(value)) return bad('root');
  if (!isDate(value.generatedAt)) return bad('generatedAt');
  return {
    generatedAt: value.generatedAt,
    hosts: arr(value.hosts, 'hosts').map(parseHost),
    gpus: arr(value.gpus, 'gpus').map(parseGpu),
    workers: arr(value.workers, 'workers').map(parseWorker),
  };
}

export function inventoryErrorMessage(
  error: unknown,
  capability: 'view' | 'edit' = 'view',
): string {
  if (error instanceof FleetInventoryApiError && error.status === 401)
    return 'Session expired, sign in again.';
  if (error instanceof FleetInventoryApiError && error.status === 403)
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
): Promise<Inventory> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const send = (accessToken: string) =>
    fetchImpl(`${baseUrl.replace(/\/$/, '')}/admin/fleet/inventory${path}`, {
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
    if (cause instanceof AuthError) throw new FleetInventoryApiError(401, cause.message);
    throw new FleetInventoryApiError(0, 'Fleet API unavailable.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    // The API's error envelope is { error: { code, message } }.
    const message =
      isObj(payload) && isObj(payload.error) && isStr(payload.error.message)
        ? payload.error.message
        : `Fleet API returned ${response.status}.`;
    throw new FleetInventoryApiError(response.status, message);
  }
  return parseInventory(await response.json().catch(() => null));
}

const seg = encodeURIComponent;
export const loadInventory = (b: string, t: string, o?: RequestOptions) => request(b, t, '', o);
export const saveHost = (b: string, t: string, id: string, input: HostInput, o?: RequestOptions) =>
  request(b, t, `/hosts/${seg(id)}`, { ...o, method: 'PUT', body: input });
export const deleteHost = (b: string, t: string, id: string, reason: string, o?: RequestOptions) =>
  request(b, t, `/hosts/${seg(id)}`, { ...o, method: 'DELETE', body: { reason } });
export const saveGpu = (b: string, t: string, id: string, input: GpuInput, o?: RequestOptions) =>
  request(b, t, `/gpus/${seg(id)}`, { ...o, method: 'PUT', body: input });
export const deleteGpu = (b: string, t: string, id: string, reason: string, o?: RequestOptions) =>
  request(b, t, `/gpus/${seg(id)}`, { ...o, method: 'DELETE', body: { reason } });
export const mapWorker = (
  b: string,
  t: string,
  workerId: string,
  target: { hostId: string | null; gpuId: string | null },
  reason: string,
  o?: RequestOptions,
) =>
  request(b, t, `/workers/${seg(workerId)}`, { ...o, method: 'PUT', body: { ...target, reason } });
export const addHostReview = (b: string, t: string, id: string, note: string, o?: RequestOptions) =>
  request(b, t, `/hosts/${seg(id)}/reviews`, { ...o, method: 'POST', body: { note } });

/**
 * Overlay the operator's inventory on the live snapshot. Observed numbers (RAM, GPU name and VRAM)
 * stay; the inventory adds who owns the box, what it costs, and which workers share it. A worker
 * that is not mapped keeps its "Host not mapped" placeholder, so nothing is guessed.
 */
export function applyInventory(
  snapshot: FleetSnapshot,
  inventory: Inventory | null,
): FleetSnapshot {
  if (!inventory || inventory.hosts.length === 0) return snapshot;
  const mapping = new Map(
    inventory.workers.filter((w) => w.hostId && w.gpuId).map((w) => [w.workerId, w]),
  );
  const placeholderHost = new Map(snapshot.hosts.map((h) => [h.id, h]));
  const placeholderGpu = new Map(snapshot.gpus.map((g) => [g.id, g]));
  const workers = snapshot.workers.map((w) => {
    const m = mapping.get(w.workerId);
    return m?.hostId && m.gpuId ? { ...w, hostId: m.hostId, gpuId: m.gpuId } : w;
  });
  const mappedPlaceholderHosts = new Set<string>();
  const mappedPlaceholderGpus = new Set<string>();
  const firstObserved = new Map<string, { host?: HostView; gpu?: GpuView }>();
  for (const original of snapshot.workers) {
    const m = mapping.get(original.workerId);
    if (!m?.hostId || !m.gpuId) continue;
    mappedPlaceholderHosts.add(original.hostId);
    mappedPlaceholderGpus.add(original.gpuId);
    const host = placeholderHost.get(original.hostId);
    const gpu = placeholderGpu.get(original.gpuId);
    const key = `${m.hostId}`;
    const seen = firstObserved.get(key) ?? {};
    firstObserved.set(key, { host: seen.host ?? host, gpu: seen.gpu ?? gpu });
    firstObserved.set(`gpu:${m.gpuId}`, { gpu: firstObserved.get(`gpu:${m.gpuId}`)?.gpu ?? gpu });
  }
  const emptyStorage = { usedGb: null, totalGb: null, observedAt: null, inodesUsedPct: null };
  const emptyMemory = {
    totalGb: null,
    availableGb: null,
    swapUsedGb: null,
    swapTotalGb: null,
    observedAt: null,
  };
  const hosts: HostView[] = [
    ...snapshot.hosts.filter((h) => !mappedPlaceholderHosts.has(h.id)),
    ...inventory.hosts.map((h) => {
      const seen = firstObserved.get(h.id)?.host;
      return {
        id: h.id,
        label: h.label,
        provider: h.provider,
        rented: h.rented,
        monthlyCostUsd: h.monthlyCostUsd,
        inventoryVerified: h.inventoryVerified,
        storage: seen?.storage ?? emptyStorage,
        memory: seen?.memory ?? emptyMemory,
      };
    }),
  ];
  const gpus: GpuView[] = [
    ...snapshot.gpus.filter((g) => !mappedPlaceholderGpus.has(g.id)),
    ...inventory.gpus.map((g) => {
      const seen = firstObserved.get(`gpu:${g.id}`)?.gpu;
      return {
        id: g.id,
        hostId: g.hostId,
        model: g.model ?? seen?.model ?? null,
        vramTotalMb: g.vramTotalMb ?? seen?.vramTotalMb ?? null,
      };
    }),
  ];
  return { ...snapshot, workers, hosts, gpus };
}
