import type { FleetRepository, FleetSnapshot, FleetWorkerView } from './contracts';

// Live adapter for GET /admin/fleet. This folder deliberately has no workspace imports (see
// README), so the response is validated by hand rather than with the API's zod schema in
// @aivastra/types. Keep LiveWorker in step with packages/types/src/fleet.ts.

type LiveWorker = {
  workerId: string;
  label: string;
  dispatcherState: FleetWorkerView['dispatcherState'];
  health: 'HEALTHY' | 'UNREACHABLE' | 'UNKNOWN';
  active: boolean;
  inRegistry: boolean;
  jobTypes: string[];
  comfy: {
    reachable: boolean | null;
    running: number | null;
    pending: number | null;
    observedAt: string | null;
    stale: boolean;
  };
  gpu: {
    name: string | null;
    vramUsedMb: number | null;
    vramTotalMb: number | null;
    observedAt: string | null;
    stale: boolean;
  };
  hostMemory: {
    totalGb: number | null;
    availableGb: number | null;
    observedAt: string | null;
    stale: boolean;
  };
  ownership: 'PRODUCTION' | 'UNATTRIBUTED' | 'NONE' | 'UNKNOWN';
  prompt: { id: string; jobId: string | null; observedAt: string } | null;
  lastSeenAt: string | null;
};
export type LiveStream = {
  stream: string;
  waiting: number | null;
  inFlight: number | null;
  capped: boolean;
};
export type LiveFleet = { generatedAt: string; workers: LiveWorker[]; queues: LiveStream[] };

export type FleetLoadKind = 'UNAUTHORIZED' | 'FORBIDDEN' | 'UNAVAILABLE' | 'INVALID';
export class FleetLoadError extends Error {
  constructor(
    readonly kind: FleetLoadKind,
    message: string,
  ) {
    super(message);
  }
}

const invalid = (what: string) =>
  new FleetLoadError('INVALID', `Unexpected fleet response: ${what}`);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const nullable = <T>(v: unknown, ok: (x: unknown) => x is T): v is T | null => v === null || ok(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStr = (v: unknown): v is string => typeof v === 'string';
const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as string[]).includes(v);

const isDispatcherState = oneOf<LiveWorker['dispatcherState']>(
  'IDLE',
  'BUSY',
  'DRAINING',
  'UNKNOWN',
);
const isHealth = oneOf<LiveWorker['health']>('HEALTHY', 'UNREACHABLE', 'UNKNOWN');
const isOwnership = oneOf<LiveWorker['ownership']>('PRODUCTION', 'UNATTRIBUTED', 'NONE', 'UNKNOWN');

function parseWorker(raw: unknown, index: number): LiveWorker {
  const at = `workers[${index}]`;
  if (!isRecord(raw)) throw invalid(at);
  const c = raw.comfy;
  if (!isRecord(c)) throw invalid(`${at}.comfy`);
  const g = raw.gpu;
  if (!isRecord(g)) throw invalid(`${at}.gpu`);
  const m = raw.hostMemory;
  if (!isRecord(m)) throw invalid(`${at}.hostMemory`);
  const pr = raw.prompt;
  if (pr !== null && !isRecord(pr)) throw invalid(`${at}.prompt`);
  if (
    !isStr(raw.workerId) ||
    !isStr(raw.label) ||
    !isDispatcherState(raw.dispatcherState) ||
    !isHealth(raw.health) ||
    !isBool(raw.active) ||
    !isBool(raw.inRegistry) ||
    !Array.isArray(raw.jobTypes) ||
    !raw.jobTypes.every(isStr) ||
    !nullable(raw.lastSeenAt, isTime) ||
    !nullable(c.reachable, isBool) ||
    !nullable(c.running, isNum) ||
    !nullable(c.pending, isNum) ||
    !nullable(c.observedAt, isTime) ||
    !isBool(c.stale) ||
    !nullable(g.name, isStr) ||
    !nullable(g.vramUsedMb, isNum) ||
    !nullable(g.vramTotalMb, isNum) ||
    !nullable(g.observedAt, isTime) ||
    !isBool(g.stale) ||
    !nullable(m.totalGb, isNum) ||
    !nullable(m.availableGb, isNum) ||
    !nullable(m.observedAt, isTime) ||
    !isBool(m.stale) ||
    !isOwnership(raw.ownership) ||
    (pr !== null && (!isStr(pr.id) || !nullable(pr.jobId, isStr) || !isTime(pr.observedAt)))
  )
    throw invalid(at);
  return {
    workerId: raw.workerId,
    label: raw.label,
    dispatcherState: raw.dispatcherState,
    health: raw.health,
    active: raw.active,
    inRegistry: raw.inRegistry,
    jobTypes: raw.jobTypes,
    lastSeenAt: raw.lastSeenAt,
    comfy: {
      reachable: c.reachable,
      running: c.running,
      pending: c.pending,
      observedAt: c.observedAt,
      stale: c.stale,
    },
    gpu: {
      name: g.name,
      vramUsedMb: g.vramUsedMb,
      vramTotalMb: g.vramTotalMb,
      observedAt: g.observedAt,
      stale: g.stale,
    },
    hostMemory: {
      totalGb: m.totalGb,
      availableGb: m.availableGb,
      observedAt: m.observedAt,
      stale: m.stale,
    },
    ownership: raw.ownership,
    prompt:
      pr === null
        ? null
        : {
            id: pr.id as string,
            jobId: pr.jobId as string | null,
            observedAt: pr.observedAt as string,
          },
  };
}

function parseStream(raw: unknown, index: number): LiveStream {
  if (
    !isRecord(raw) ||
    !isStr(raw.stream) ||
    !nullable(raw.waiting, isNum) ||
    !nullable(raw.inFlight, isNum) ||
    !isBool(raw.capped)
  )
    throw invalid(`queues[${index}]`);
  return {
    stream: raw.stream,
    waiting: raw.waiting,
    inFlight: raw.inFlight,
    capped: raw.capped,
  };
}

export function parseLiveFleet(body: unknown): LiveFleet {
  if (!isRecord(body)) throw invalid('not an object');
  if (body.source !== 'LIVE') throw invalid('source is not LIVE');
  if (!isTime(body.generatedAt)) throw invalid('generatedAt');
  if (!Array.isArray(body.workers)) throw invalid('workers');
  if (!Array.isArray(body.queues)) throw invalid('queues');
  return {
    generatedAt: body.generatedAt,
    workers: body.workers.map(parseWorker),
    queues: body.queues.map(parseStream),
  };
}

/**
 * Maps the API view onto the UI's snapshot. Only what the API actually observed is filled in:
 * VRAM, host RAM and the GPU name come from ComfyUI /system_stats; ownership and the current
 * prompt from matching its queue to dispatched jobs. Host/GPU identity, utilisation,
 * temperature, exporter state, disk, swap, incidents and jobs have no live source yet, so they
 * stay null / empty / UNKNOWN rather than being invented.
 */
export function toSnapshot(live: LiveFleet): FleetSnapshot {
  return {
    source: 'LIVE',
    // The server's generation time, not the browser's clock: freshness() is measured against
    // this, so a snapshot that stops refreshing visibly ages instead of looking current.
    asOf: live.generatedAt,
    workers: live.workers.map((w) => ({
      workerId: w.workerId,
      // Unique per worker on purpose. The UI treats two workers with the same gpuId as sharing
      // a GPU, and nothing in the live data says that.
      hostId: `unmapped-host:${w.workerId}`,
      gpuId: `unmapped-gpu:${w.workerId}`,
      dispatcherState: w.dispatcherState,
      health: w.health,
      // A stale queue sample is history, not state: show it as unknown rather than as the
      // last value.
      comfy: w.comfy.stale
        ? { reachable: null, running: null, pending: null }
        : { reachable: w.comfy.reachable, running: w.comfy.running, pending: w.comfy.pending },
      ownership: w.ownership,
      gpu: {
        utilizationPct: null,
        vramUsedMb: w.gpu.vramUsedMb,
        vramTotalMb: w.gpu.vramTotalMb,
        temperatureC: null,
      },
      // The exporters are not measured, so their state stays unknown. lastSeenAt is the
      // observation time of the /system_stats sample, which is what the UI's FRESH/STALE
      // label is computed from; a worker with no sample stays "No data".
      monitoring: { gpuExporterUp: null, nodeExporterUp: null, lastSeenAt: w.gpu.observedAt },
      active: w.active,
      inRegistry: w.inRegistry,
      jobTypes: w.jobTypes,
      // Dispatcher registry lastSeen: moves on job/status activity, not on probes.
      lastSeenAt: w.lastSeenAt,
      // The per-prompt owner is PRODUCTION only when this exact prompt matched a dispatched job.
      prompt: w.prompt
        ? {
            id: w.prompt.id,
            owner: w.prompt.jobId === null ? 'UNATTRIBUTED' : 'PRODUCTION',
            observedAt: w.prompt.observedAt,
          }
        : null,
    })),
    // One placeholder per worker, flagged unverified: nothing says which workers share a box,
    // and the detail view needs somewhere to show the host RAM that was actually observed.
    hosts: live.workers.map((w) => ({
      id: `unmapped-host:${w.workerId}`,
      label: 'Host not mapped',
      provider: null,
      rented: null,
      monthlyCostUsd: null,
      inventoryVerified: false,
      storage: { usedGb: null, totalGb: null, observedAt: null, inodesUsedPct: null },
      memory: {
        totalGb: w.hostMemory.totalGb,
        availableGb: w.hostMemory.availableGb,
        swapUsedGb: null,
        swapTotalGb: null,
        observedAt: w.hostMemory.observedAt,
      },
    })),
    gpus: live.workers.map((w) => ({
      id: `unmapped-gpu:${w.workerId}`,
      hostId: `unmapped-host:${w.workerId}`,
      model: w.gpu.name,
      vramTotalMb: w.gpu.vramTotalMb,
    })),
    queues: live.queues,
    incidents: [],
    jobs: [],
  };
}

export function createLiveRepository(
  baseUrl: string,
  getToken: () => string | null,
  fetchImpl: typeof fetch = fetch,
): FleetRepository {
  return {
    async load() {
      const token = getToken();
      if (!token) throw new FleetLoadError('UNAUTHORIZED', 'No access token');
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/admin/fleet`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // A browser reports "not running", "blocked by CORS" and "wrong host" identically, so
        // the message names both causes and the two values to compare.
        const origin = globalThis.location?.origin ?? 'this origin';
        throw new FleetLoadError(
          'UNAVAILABLE',
          `Fleet API unreachable at ${baseUrl}. Either it is not running, or its CORS_ORIGIN does not include ${origin} (localhost and 127.0.0.1 are different origins).`,
        );
      }
      if (res.status === 401) throw new FleetLoadError('UNAUTHORIZED', 'Token rejected');
      if (res.status === 403)
        throw new FleetLoadError('FORBIDDEN', 'Missing fleet.view permission');
      if (!res.ok) throw new FleetLoadError('UNAVAILABLE', `Fleet API returned ${res.status}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw invalid('not JSON');
      }
      return toSnapshot(parseLiveFleet(body));
    },
  };
}
