import type { FleetSnapshot, FleetWorkerView, GpuView, HostView } from './contracts';
import type { OperationEntry } from './operations-demo';

export type QueueJob = {
  id: string;
  workerId: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  ownership: FleetWorkerView['ownership'];
  promptId: string | null;
  at: string;
  executionMs: number | null;
  attempt: number;
  retryOf: string | null;
};
export type Coverage = 'OK' | 'TRUNCATED' | 'TIMEOUT' | 'ERROR' | 'UNAVAILABLE' | 'MISSING';
export type Capture = {
  id: string;
  workerId: string;
  incidentId: string;
  pass: 'A' | 'B';
  capturedAt: string;
  transport: 'COMPLETE' | 'INCOMPLETE';
  coverage: Record<string, Coverage>;
  stderr: string[];
  findings: string[];
};
const coreSources =
  'time boot uptime hostContext clockState who last gpuStatus computeApps gpuQuery processes processTree listening connections lsof'.split(
    ' ',
  );
const fullSources =
  'kernelLogs customNodesMetadata customNodesHashes systemdServices systemdTimers cronMetadata cron preload modules recentTmpFiles authorizedKeys dockerContainers dockerImages diskSpace diskInodes memory dpkgHistory aptHistory'.split(
    ' ',
  );
export const captureFixtures: Capture[] = [
  {
    id: 'DEMO-CAP-001',
    workerId: 'worker-1',
    incidentId: 'DEMO-004',
    pass: 'A',
    capturedAt: '2026-10-12T07:01:00Z',
    transport: 'COMPLETE',
    coverage: Object.fromEntries(coreSources.map((source) => [source, 'OK' as Coverage])),
    stderr: [],
    findings: [
      'Synthetic guest observation: no owned or foreign running prompt in this capture. Not an exhaustive security assessment.',
    ],
  },
  {
    id: 'DEMO-CAP-002',
    workerId: 'worker-6',
    incidentId: 'DEMO-001',
    pass: 'A',
    capturedAt: '2026-10-12T08:33:00Z',
    transport: 'INCOMPLETE',
    coverage: {
      ...Object.fromEntries(coreSources.map((source) => [source, 'OK' as Coverage])),
      computeApps: 'TIMEOUT',
      lsof: 'UNAVAILABLE',
      connections: 'MISSING',
    },
    stderr: [
      'SYNTHETIC: nvidia-smi exceeded the collection timeout.',
      'SYNTHETIC: lsof was unavailable; connection capture was interrupted.',
    ],
    findings: [
      'GPU process visibility is incomplete. Utilization cannot establish mining or external contention.',
      'Retain partial evidence; a new capture would need a separate recorded attempt.',
    ],
  },
  {
    id: 'DEMO-CAP-003',
    workerId: 'worker-3',
    incidentId: 'DEMO-002',
    pass: 'B',
    capturedAt: '2026-10-12T08:44:00Z',
    transport: 'COMPLETE',
    coverage: {
      ...Object.fromEntries(
        [...coreSources, ...fullSources].map((source) => [source, 'OK' as Coverage]),
      ),
      customNodesHashes: 'TRUNCATED',
      preload: 'UNAVAILABLE',
      cron: 'ERROR',
      processes: 'TRUNCATED',
    },
    stderr: [
      'SYNTHETIC: one account has no crontab. Review the diagnostic; this does not establish compromise.',
    ],
    findings: [
      'A foreign prompt needs operator attribution.',
      'Code hashes were intentionally capped. No exhaustive integrity claim is supported.',
    ],
  },
  {
    id: 'DEMO-CAP-004',
    workerId: 'worker-1',
    incidentId: 'DEMO-004',
    pass: 'B',
    capturedAt: '2026-10-12T07:03:00Z',
    transport: 'COMPLETE',
    coverage: Object.fromEntries(
      [...coreSources, ...fullSources].map((source) => [source, 'OK' as Coverage]),
    ),
    stderr: [],
    findings: [
      'All expected synthetic source markers present. Command success is not proof of a clean host.',
    ],
  },
];
export type WorkspaceDemo = {
  jobs: QueueJob[];
  hosts: HostView[];
  gpus: GpuView[];
  workers: FleetWorkerView[];
  resolutions: Record<string, { owner: string; note: string; at: string }>;
  reviews: Record<string, { owner: string; note: string; at: string }>;
  history: OperationEntry[];
};
export function seedWorkspace(data: FleetSnapshot): WorkspaceDemo {
  return {
    jobs: [
      ...data.jobs.map((job) => ({
        ...job,
        status: job.outcome,
        ownership: 'PRODUCTION' as const,
        promptId: job.outcome === 'RUNNING' ? 'demo-prompt-021' : null,
        attempt: 1,
        retryOf: null,
      })),
      {
        id: 'demo-queued-001',
        workerId: 'worker-1',
        type: 'TRY_ON',
        status: 'QUEUED',
        ownership: 'PRODUCTION',
        promptId: null,
        at: data.asOf,
        executionMs: null,
        attempt: 1,
        retryOf: null,
      },
      {
        id: 'demo-foreign-003',
        workerId: 'worker-3',
        type: 'TRY_ON',
        status: 'RUNNING',
        ownership: 'FOREIGN',
        promptId: 'demo-foreign-003',
        at: data.asOf,
        executionMs: null,
        attempt: 1,
        retryOf: null,
      },
      {
        id: 'demo-developer-004',
        workerId: 'worker-4',
        type: 'TRY_ON',
        status: 'QUEUED',
        ownership: 'DEVELOPER',
        promptId: null,
        at: data.asOf,
        executionMs: null,
        attempt: 1,
        retryOf: null,
      },
    ],
    hosts: structuredClone(data.hosts),
    gpus: structuredClone(data.gpus),
    workers: structuredClone(data.workers),
    resolutions: {},
    reviews: {},
    history: [],
  };
}
export function canCancel(job: QueueJob) {
  return (
    ['PRODUCTION', 'DEVELOPER'].includes(job.ownership) &&
    ['QUEUED', 'RUNNING'].includes(job.status)
  );
}
export function canRetry(job: QueueJob, jobs: QueueJob[]) {
  return (
    ['PRODUCTION', 'DEVELOPER'].includes(job.ownership) &&
    ['FAILED', 'CANCELLED'].includes(job.status) &&
    !jobs.some((item) => item.retryOf === job.id && ['QUEUED', 'RUNNING'].includes(item.status))
  );
}
export function draftInventoryError(
  data: Pick<WorkspaceDemo, 'hosts' | 'gpus' | 'workers'>,
): string | null {
  if (
    data.hosts.some(
      (host) =>
        !host.label.trim() ||
        (host.monthlyCostUsd !== null &&
          (!Number.isFinite(host.monthlyCostUsd) || host.monthlyCostUsd < 0)),
    )
  )
    return 'Host name is required and monthly cost must be blank or a non-negative number.';
  if (
    data.gpus.some(
      (gpu) =>
        !data.hosts.some((host) => host.id === gpu.hostId) ||
        (gpu.vramTotalMb !== null && (!Number.isInteger(gpu.vramTotalMb) || gpu.vramTotalMb <= 0)),
    )
  )
    return 'GPU host must exist; VRAM must be blank or a positive integer.';
  if (
    data.workers.some(
      (worker) => !data.gpus.some((gpu) => gpu.id === worker.gpuId && gpu.hostId === worker.hostId),
    )
  )
    return 'Each logical worker must map to a GPU on its selected host.';
  return null;
}
export type WorkspaceEvent =
  | {
      type: 'RESET_QUEUE' | 'RESET_INVENTORY' | 'RESET_EVIDENCE';
      data: FleetSnapshot;
      entry: OperationEntry;
    }
  | { type: 'CANCEL'; id: string; entry: OperationEntry }
  | {
      type: 'RETRY';
      id: string;
      newId: string;
      workerId: string;
      data: FleetSnapshot;
      entry: OperationEntry;
    }
  | {
      type: 'INVENTORY';
      draft: Pick<WorkspaceDemo, 'hosts' | 'gpus' | 'workers'>;
      entry: OperationEntry;
    }
  | { type: 'RESOLUTION' | 'REVIEW'; id: string; entry: OperationEntry };
export function workspaceReducer(state: WorkspaceDemo, event: WorkspaceEvent): WorkspaceDemo {
  if (!event.entry.actor.trim() || !event.entry.note.trim()) return state;
  let next = state;
  if (event.type.startsWith('RESET_') && 'data' in event) {
    const initial = seedWorkspace(event.data);
    if (event.type === 'RESET_QUEUE') next = { ...state, jobs: initial.jobs };
    if (event.type === 'RESET_INVENTORY')
      next = {
        ...state,
        hosts: initial.hosts,
        gpus: initial.gpus,
        workers: initial.workers,
        resolutions: {},
      };
    if (event.type === 'RESET_EVIDENCE') next = { ...state, reviews: {} };
  } else if (event.type === 'CANCEL') {
    const job = state.jobs.find((item) => item.id === event.id);
    if (!job || !canCancel(job)) return state;
    next = {
      ...state,
      jobs: state.jobs.map((item) =>
        item.id === job.id ? { ...item, status: 'CANCELLED' } : item,
      ),
    };
  } else if (event.type === 'RETRY') {
    const job = state.jobs.find((item) => item.id === event.id);
    const worker = event.data.workers.find((item) => item.workerId === event.workerId);
    if (
      !job ||
      !canRetry(job, state.jobs) ||
      state.jobs.some((item) => item.id === event.newId) ||
      !worker ||
      !worker.active ||
      !worker.inRegistry ||
      worker.health !== 'HEALTHY' ||
      !['IDLE', 'BUSY'].includes(worker.dispatcherState) ||
      !worker.jobTypes.includes(job.type)
    )
      return state;
    next = {
      ...state,
      jobs: [
        ...state.jobs,
        {
          ...job,
          id: event.newId,
          workerId: event.workerId,
          status: 'QUEUED',
          promptId: null,
          executionMs: null,
          attempt: job.attempt + 1,
          retryOf: job.id,
          at: event.entry.at,
        },
      ],
    };
  } else if (event.type === 'INVENTORY') {
    if (draftInventoryError(event.draft)) return state;
    next = { ...state, ...structuredClone(event.draft) };
  } else if (event.type === 'RESOLUTION') {
    if (!state.hosts.some((host) => host.id === event.id)) return state;
    next = {
      ...state,
      resolutions: {
        ...state.resolutions,
        [event.id]: { owner: event.entry.actor, note: event.entry.note, at: event.entry.at },
      },
    };
  } else if (event.type === 'REVIEW') {
    if (!captureFixtures.some((capture) => capture.id === event.id)) return state;
    next = {
      ...state,
      reviews: {
        ...state.reviews,
        [event.id]: { owner: event.entry.actor, note: event.entry.note, at: event.entry.at },
      },
    };
  }
  if (next === state) return state;
  return { ...next, history: [event.entry, ...state.history] };
}
export function captureComplete(capture: Capture) {
  const expected = capture.pass === 'A' ? coreSources : [...coreSources, ...fullSources];
  return (
    capture.transport === 'COMPLETE' &&
    expected.every((source) => capture.coverage[source] === 'OK')
  );
}
