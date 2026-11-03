import type { FleetRepository, FleetSnapshot, FleetWorkerView, IncidentView } from './contracts';

const asOf = '2026-10-12T09:00:00Z';
const recent = '2026-10-12T08:59:40Z';
const stale = '2026-10-12T08:35:00Z';
const workers: FleetWorkerView[] = Array.from({ length: 8 }, (_, i) => ({
  workerId: `worker-${i + 1}`,
  hostId: `host-${i + 1}`,
  gpuId: `gpu-${i + 1}`,
  dispatcherState: 'IDLE',
  health: 'HEALTHY',
  comfy: { reachable: true, running: 0, pending: 0 },
  ownership: 'NONE',
  gpu: { utilizationPct: null, vramUsedMb: null, vramTotalMb: null, temperatureC: null },
  monitoring: { gpuExporterUp: null, nodeExporterUp: null, lastSeenAt: null },
  active: true,
  inRegistry: true,
  jobTypes: ['TRY_ON'],
  lastSeenAt: recent,
  prompt: null,
}));
Object.assign(workers[0], {
  gpu: { utilizationPct: 4, vramUsedMb: 2100, vramTotalMb: 24576, temperatureC: 42 },
  monitoring: { gpuExporterUp: true, nodeExporterUp: true, lastSeenAt: recent },
});
Object.assign(workers[1], {
  dispatcherState: 'BUSY',
  ownership: 'PRODUCTION',
  comfy: { reachable: true, running: 1, pending: 2 },
  gpu: { utilizationPct: 94, vramUsedMb: 21480, vramTotalMb: 24576, temperatureC: 71 },
  monitoring: { gpuExporterUp: true, nodeExporterUp: true, lastSeenAt: recent },
  prompt: { id: 'demo-prompt-021', owner: 'PRODUCTION', observedAt: recent },
});
Object.assign(workers[2], {
  health: 'DEGRADED',
  ownership: 'FOREIGN',
  comfy: { reachable: true, running: 1, pending: 0 },
  prompt: { id: 'demo-foreign-003', owner: 'FOREIGN', observedAt: recent },
});
Object.assign(workers[3], {
  dispatcherState: 'DRAINING',
  ownership: 'DEVELOPER',
  reservation: {
    owner: 'Demo operator',
    reason: 'Workflow visibility experiment',
    until: '2026-10-12T10:00:00Z',
  },
});
Object.assign(workers[4], {
  dispatcherState: 'UNKNOWN',
  health: 'UNREACHABLE',
  comfy: { reachable: false, running: null, pending: null },
  ownership: 'UNKNOWN',
  lastSeenAt: stale,
});
Object.assign(workers[5], {
  dispatcherState: 'BUSY',
  health: 'DEGRADED',
  ownership: 'UNATTRIBUTED',
  gpu: { utilizationPct: 83, vramUsedMb: 18000, vramTotalMb: 24576, temperatureC: 68 },
  monitoring: { gpuExporterUp: false, nodeExporterUp: true, lastSeenAt: stale },
});
Object.assign(workers[6], {
  active: false,
  inRegistry: false,
  dispatcherState: 'UNKNOWN',
  health: 'UNKNOWN',
  comfy: { reachable: null, running: null, pending: null },
  ownership: 'UNKNOWN',
  lastSeenAt: null,
});
Object.assign(workers[7], {
  active: false,
  inRegistry: false,
  dispatcherState: 'UNKNOWN',
  health: 'UNKNOWN',
  comfy: { reachable: null, running: null, pending: null },
  ownership: 'UNKNOWN',
  lastSeenAt: null,
  monitoring: { gpuExporterUp: true, nodeExporterUp: true, lastSeenAt: recent },
});
workers.push({
  ...workers[5],
  workerId: 'worker-6-secondary',
  dispatcherState: 'IDLE',
  ownership: 'NONE',
  health: 'HEALTHY',
  jobTypes: ['VIDEO'],
  comfy: { reachable: true, running: 0, pending: 0 },
  prompt: null,
});
const incidents: IncidentView[] = [
  {
    id: 'DEMO-001',
    title: 'GPU activity without an owned prompt',
    classification: 'UNATTRIBUTED_GPU_ACTIVITY',
    severity: 'HIGH',
    state: 'OPEN',
    workerIds: ['worker-6', 'worker-6-secondary'],
    jobTypes: ['TRY_ON', 'VIDEO'],
    openedAt: '2026-10-12T08:32:00Z',
    updatedAt: stale,
    recoveredAt: null,
    evidence: { passA: 'PARTIAL', passB: 'MISSING', external: 'PARTIAL' },
    notes: [
      'Guest process visibility has not been verified. Utilization alone does not establish mining.',
      'Exporter observations are stale; the GPU summary is historical.',
    ],
    audit: [
      {
        at: '2026-10-12T08:32:00Z',
        actor: 'Demo observer',
        action: 'OPEN · unattributed activity recorded',
      },
    ],
  },
  {
    id: 'DEMO-002',
    title: 'Foreign prompt while dispatcher is idle',
    classification: 'UNVERIFIED_CHANGE_INDICATOR',
    severity: 'MEDIUM',
    state: 'ACK',
    workerIds: ['worker-3'],
    jobTypes: ['TRY_ON'],
    openedAt: '2026-10-12T08:42:00Z',
    updatedAt: '2026-10-12T08:48:00Z',
    recoveredAt: null,
    evidence: { passA: 'AVAILABLE', passB: 'PARTIAL', external: 'MISSING' },
    notes: [
      'A foreign prompt is not, by itself, proof of compromise. Operator attribution is pending.',
    ],
    audit: [
      { at: '2026-10-12T08:42:00Z', actor: 'Demo observer', action: 'OPEN · ownership mismatch' },
      {
        at: '2026-10-12T08:48:00Z',
        actor: 'Demo operator',
        action: 'ACK · attribution review started',
      },
    ],
  },
  {
    id: 'DEMO-003',
    title: 'Worker endpoint stopped responding',
    classification: 'HOST_FAULT_SIGNAL',
    severity: 'HIGH',
    state: 'OPEN',
    workerIds: ['worker-5'],
    jobTypes: ['TRY_ON'],
    openedAt: '2026-10-12T08:50:00Z',
    updatedAt: '2026-10-12T08:50:00Z',
    recoveredAt: null,
    evidence: { passA: 'MISSING', passB: 'MISSING', external: 'AVAILABLE' },
    notes: ['Reachability loss does not identify a provider fault or guest compromise.'],
    audit: [
      { at: '2026-10-12T08:50:00Z', actor: 'Demo observer', action: 'OPEN · endpoint unreachable' },
    ],
  },
  {
    id: 'DEMO-004',
    title: 'Transient host signal recovered',
    classification: 'HOST_FAULT_SIGNAL',
    severity: 'LOW',
    state: 'RECOVERED',
    workerIds: ['worker-1'],
    jobTypes: ['TRY_ON'],
    openedAt: '2026-10-12T07:00:00Z',
    updatedAt: '2026-10-12T07:06:00Z',
    recoveredAt: '2026-10-12T07:06:00Z',
    evidence: { passA: 'AVAILABLE', passB: 'AVAILABLE', external: 'AVAILABLE' },
    notes: ['Recovered status preserves evidence and the audit trail.'],
    audit: [
      {
        at: '2026-10-12T07:00:00Z',
        actor: 'Demo observer',
        action: 'OPEN · transient host signal',
      },
      {
        at: '2026-10-12T07:06:00Z',
        actor: 'Demo operator',
        action: 'RECOVERED · reachability verified',
      },
    ],
  },
];
for (const worker of workers) {
  const incident = incidents.find(
    (item) => item.state !== 'RECOVERED' && item.workerIds.includes(worker.workerId),
  );
  if (incident)
    worker.activeIncident = {
      id: incident.id,
      severity: incident.severity,
      classification: incident.classification,
      state: incident.state,
    };
}
export const fixtureSnapshot: FleetSnapshot = {
  source: 'FIXTURE',
  asOf,
  workers,
  incidents,
  hosts: Array.from({ length: 8 }, (_, i) => ({
    id: `host-${i + 1}`,
    label: `VPS ${String(i + 1).padStart(2, '0')}`,
    provider: 'Demo provider',
    rented: true,
    monthlyCostUsd: i < 2 ? 180 : null,
    inventoryVerified: i < 6,
    storage: {
      usedGb: i < 2 ? (i === 0 ? 96 : 188) : null,
      totalGb: i < 2 ? 200 : null,
      observedAt: i < 2 ? recent : null,
      inodesUsedPct: i < 2 ? (i === 0 ? 24 : 92) : null,
    },
    memory: {
      totalGb: i < 2 ? 64 : null,
      availableGb: i < 2 ? (i === 0 ? 40 : 3) : null,
      swapUsedGb: i < 2 ? (i === 0 ? 0 : 6) : null,
      swapTotalGb: i < 2 ? 8 : null,
      observedAt: i < 2 ? recent : null,
    },
  })),
  gpus: Array.from({ length: 8 }, (_, i) => ({
    id: `gpu-${i + 1}`,
    hostId: `host-${i + 1}`,
    model: i < 6 ? 'RTX 4090' : null,
    vramTotalMb: i < 6 ? 24576 : null,
  })),
  jobs: [
    {
      id: 'demo-job-021',
      workerId: 'worker-2',
      type: 'TRY_ON',
      outcome: 'RUNNING',
      at: '2026-10-12T08:59:00Z',
      executionMs: null,
    },
    {
      id: 'demo-job-020',
      workerId: 'worker-2',
      type: 'TRY_ON',
      outcome: 'SUCCEEDED',
      at: '2026-10-12T08:56:00Z',
      executionMs: 32400,
    },
    {
      id: 'demo-job-019',
      workerId: 'worker-1',
      type: 'TRY_ON',
      outcome: 'SUCCEEDED',
      at: '2026-10-12T08:54:00Z',
      executionMs: 28900,
    },
    {
      id: 'demo-job-018',
      workerId: 'worker-5',
      type: 'TRY_ON',
      outcome: 'FAILED',
      at: '2026-10-12T08:50:00Z',
      executionMs: null,
    },
  ],
};
export const fixtureRepository: FleetRepository = {
  async load() {
    return structuredClone(fixtureSnapshot);
  },
};
