import type { FleetSnapshot, FleetWorkerView, HostView } from './contracts';

export function freshness(at: string | null, asOf: string): 'FRESH' | 'STALE' | 'NO DATA' {
  if (!at) return 'NO DATA';
  const age = Date.parse(asOf) - Date.parse(at);
  if (!Number.isFinite(age) || age < 0) return 'NO DATA';
  return age > 120_000 ? 'STALE' : 'FRESH';
}
export function display(value: number | null, unit = '') {
  return value === null ? 'No data' : `${value.toLocaleString()}${unit}`;
}
export function signals(worker: FleetWorkerView): string[] {
  const result: string[] = [];
  if (worker.dispatcherState === 'IDLE' && ['FOREIGN', 'UNATTRIBUTED'].includes(worker.ownership))
    result.push('Idle + unowned activity');
  if (
    worker.dispatcherState === 'BUSY' &&
    worker.comfy.reachable === true &&
    worker.comfy.running === 0 &&
    worker.comfy.pending === 0
  )
    result.push('Busy + empty queue');
  if (worker.health === 'UNREACHABLE') result.push('Endpoint unreachable');
  if (worker.ownership === 'UNATTRIBUTED') result.push('Attribution pending');
  return result;
}
export function reconciliation(host: HostView, snapshot: FleetSnapshot): string[] {
  const workers = snapshot.workers.filter((worker) => worker.hostId === host.id);
  const registered = workers.some((worker) => worker.inRegistry);
  const monitored = workers.some(
    (worker) =>
      worker.monitoring.gpuExporterUp === true || worker.monitoring.nodeExporterUp === true,
  );
  const issues: string[] = [];
  if (registered && !monitored) issues.push('Registry-only');
  if (monitored && !registered) issues.push('Monitored-only');
  if (host.rented === true && !registered && !monitored) issues.push('Rented-only');
  if (host.rented === true && !workers.some((worker) => worker.active))
    issues.push('Inactive-but-billed');
  if (
    workers.some(
      (worker) =>
        worker.monitoring.gpuExporterUp !== true || worker.monitoring.nodeExporterUp !== true,
    )
  )
    issues.push('Exporter missing / unverified');
  if (
    !host.inventoryVerified ||
    workers.some(
      (worker) => !snapshot.gpus.some((gpu) => gpu.id === worker.gpuId && gpu.hostId === host.id),
    )
  )
    issues.push('Inventory mismatch');
  return issues;
}
export function fleetCounts(snapshot: FleetSnapshot) {
  return {
    hosts: snapshot.hosts.length,
    gpus: snapshot.gpus.length,
    workers: snapshot.workers.length,
    monitoredHosts: snapshot.hosts.filter((host) =>
      snapshot.workers.some(
        (worker) =>
          worker.hostId === host.id &&
          worker.monitoring.gpuExporterUp === true &&
          worker.monitoring.nodeExporterUp === true &&
          freshness(worker.monitoring.lastSeenAt, snapshot.asOf) === 'FRESH',
      ),
    ).length,
    incidents: snapshot.incidents.filter((incident) => incident.state !== 'RECOVERED').length,
  };
}
export function grafanaLink(
  kind: 'gpu' | 'host' | 'performance',
  worker: FleetWorkerView,
): string | null {
  const configured = {
    gpu: import.meta.env.VITE_GRAFANA_GPU_URL,
    host: import.meta.env.VITE_GRAFANA_HOST_URL,
    performance: import.meta.env.VITE_GRAFANA_PERFORMANCE_URL,
  }[kind];
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    url.searchParams.set('var-worker', worker.workerId);
    url.searchParams.set('var-host', worker.hostId);
    url.searchParams.set('var-gpu', worker.gpuId);
    return url.toString();
  } catch {
    return null;
  }
}
