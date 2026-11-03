export type IncidentClassification =
  | 'UNATTRIBUTED_GPU_ACTIVITY'
  | 'SUSPECTED_EXTERNAL_CONTENTION'
  | 'SUSPECTED_GUEST_COMPROMISE'
  | 'UNVERIFIED_CHANGE_INDICATOR'
  | 'HOST_FAULT_SIGNAL'
  | 'SUSPECTED_HOST_FAULT'
  | 'CONFIRMED_HOST_FAULT'
  | 'SUSPECTED_MINING'
  | 'CONFIRMED_KNOWN_MINER';
export type IncidentState = 'OPEN' | 'ACK' | 'RECOVERED';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type FleetWorkerView = {
  workerId: string;
  hostId: string;
  gpuId: string;
  dispatcherState: 'IDLE' | 'BUSY' | 'DRAINING' | 'UNKNOWN';
  health: 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE' | 'UNKNOWN';
  routing?: 'unavailable' | 'ungated' | 'externally_busy' | 'ok';
  warning?: string | null;
  comfy: { reachable: boolean | null; running: number | null; pending: number | null };
  ownership: 'PRODUCTION' | 'DEVELOPER' | 'FOREIGN' | 'UNATTRIBUTED' | 'NONE' | 'UNKNOWN';
  gpu: {
    utilizationPct: number | null;
    vramUsedMb: number | null;
    vramTotalMb: number | null;
    temperatureC: number | null;
  };
  monitoring: {
    gpuExporterUp: boolean | null;
    nodeExporterUp: boolean | null;
    lastSeenAt: string | null;
  };
  activeIncident?: {
    id: string;
    severity: Severity;
    classification: IncidentClassification;
    state: IncidentState;
  };
  reservation?: { owner: string; reason?: string; until?: string };
  active: boolean;
  inRegistry: boolean;
  jobTypes: string[];
  lastSeenAt: string | null;
  prompt: {
    id: string;
    owner: FleetWorkerView['ownership'];
    observedAt: string;
    jobId?: string | null;
  } | null;
};
export type HostView = {
  id: string;
  label: string;
  provider: string | null;
  rented: boolean | null;
  monthlyCostUsd: number | null;
  inventoryVerified: boolean;
  storage: {
    usedGb: number | null;
    totalGb: number | null;
    observedAt: string | null;
    inodesUsedPct: number | null;
  };
  memory: {
    totalGb: number | null;
    availableGb: number | null;
    swapUsedGb: number | null;
    swapTotalGb: number | null;
    observedAt: string | null;
  };
};
export type GpuView = {
  id: string;
  hostId: string;
  model: string | null;
  vramTotalMb: number | null;
};
export type IncidentView = {
  id: string;
  title: string;
  classification: IncidentClassification;
  severity: Severity;
  state: IncidentState;
  workerIds: string[];
  jobTypes: string[];
  openedAt: string;
  updatedAt: string;
  recoveredAt: string | null;
  evidence: {
    passA: 'AVAILABLE' | 'PARTIAL' | 'MISSING';
    passB: 'AVAILABLE' | 'PARTIAL' | 'MISSING';
    external: 'AVAILABLE' | 'PARTIAL' | 'MISSING';
  };
  notes: string[];
  audit: { at: string; actor: string; action: string }[];
};
export type JobView = {
  id: string;
  workerId: string;
  type: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'RUNNING';
  at: string;
  executionMs: number | null;
};
export type FleetSnapshot = {
  // LIVE comes from the API adapter (live.ts); everything else in the app is still demo data.
  source: 'FIXTURE' | 'LIVE';
  asOf: string;
  // Dispatch backlog per shared Redis stream. Live only; fixtures leave it undefined.
  queues?: { stream: string; waiting: number | null; inFlight: number | null; capped: boolean }[];
  workers: FleetWorkerView[];
  hosts: HostView[];
  gpus: GpuView[];
  incidents: IncidentView[];
  jobs: JobView[];
};
// This is the only data seam consumed by the UI. fixtures.ts and live.ts both implement it.
// A live source must validate its payload and keep observation time separate from request time.
export interface FleetRepository {
  load(): Promise<FleetSnapshot>;
}
