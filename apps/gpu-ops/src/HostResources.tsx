import type { HostView } from './contracts';
import { display, freshness } from './model';

export function HostResources({
  host,
  asOf,
  live = false,
}: {
  host: HostView | undefined;
  asOf: string;
  live?: boolean;
}) {
  const disk = host?.storage;
  const memory = host?.memory;
  const free = disk?.totalGb != null && disk.usedGb != null ? disk.totalGb - disk.usedGb : null;
  const used =
    memory?.totalGb != null && memory.availableGb != null
      ? memory.totalGb - memory.availableGb
      : null;
  const diskPressure = free !== null && disk?.totalGb && free / disk.totalGb < 0.1;
  const ramPressure =
    memory?.availableGb != null && memory.totalGb && memory.availableGb / memory.totalGb < 0.1;
  return (
    <section className="panel">
      <h2>VPS storage & memory</h2>
      <p className="muted">
        Host-wide resources shared by all workers on this VPS.{' '}
        {live
          ? 'RAM is as reported by ComfyUI; disk, inodes and swap have no live source yet.'
          : 'Synthetic snapshot;'}{' '}
        RAM is separate from GPU VRAM.
      </p>
      <dl>
        <dt>Disk used / total</dt>
        <dd>
          {display(disk?.usedGb ?? null, ' GB')} / {display(disk?.totalGb ?? null, ' GB')}
        </dd>
        <dt>Disk free</dt>
        <dd>{display(free, ' GB')}</dd>
        <dt>Inodes used</dt>
        <dd>{display(disk?.inodesUsedPct ?? null, '%')}</dd>
        <dt>Disk observation</dt>
        <dd>
          {disk?.observedAt ?? 'No data'} · {freshness(disk?.observedAt ?? null, asOf)}
        </dd>
        <dt>RAM used / total</dt>
        <dd>
          {display(used, ' GB')} / {display(memory?.totalGb ?? null, ' GB')}
        </dd>
        <dt>RAM available</dt>
        <dd>{display(memory?.availableGb ?? null, ' GB')}</dd>
        <dt>Swap used / total</dt>
        <dd>
          {display(memory?.swapUsedGb ?? null, ' GB')} /{' '}
          {display(memory?.swapTotalGb ?? null, ' GB')}
        </dd>
        <dt>Memory observation</dt>
        <dd>
          {memory?.observedAt ?? 'No data'} · {freshness(memory?.observedAt ?? null, asOf)}
        </dd>
      </dl>
      <p className="muted">
        RAM used = total − available, allowing reclaimable cache. Snapshot indicators are preview
        thresholds, not incident classifications.
      </p>
      {diskPressure ? (
        <div className="notice">Low disk space: less than 10% free in this snapshot.</div>
      ) : null}
      {disk?.inodesUsedPct != null && disk.inodesUsedPct >= 90 ? (
        <div className="notice">Inode pressure: at least 90% used in this snapshot.</div>
      ) : null}
      {ramPressure ? (
        <div className="notice">Memory pressure: less than 10% RAM available in this snapshot.</div>
      ) : null}
    </section>
  );
}
