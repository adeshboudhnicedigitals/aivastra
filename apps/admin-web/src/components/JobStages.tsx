import type { JobStage } from '../types';

const fmtTime = (ts: string | null) => (ts ? new Date(ts).toLocaleTimeString() : '…');

const STATE_COLOR: Record<JobStage['state'], string> = {
  done: 'var(--success)',
  failed: 'var(--danger)',
  running: 'var(--accent)',
};

/**
 * Worker cell for a job: "S1: w1 · S2: w3" when the job ran a pre-step before the main
 * run (garment extract / in-job mannequin), otherwise the single worker as before.
 */
export function StageWorkers({
  stages,
  workerId,
}: {
  stages?: JobStage[];
  workerId: string | null;
}) {
  if (!stages || stages.length < 2) return <>{workerId ?? '—'}</>;
  return (
    <>
      {stages.map((s, i) => (
        <span key={s.phase}>
          {i > 0 && ' · '}S{s.stage}: {s.workerId ?? '—'}
        </span>
      ))}
    </>
  );
}

/** Per-stage worker, state, timing and input/output for a multi-phase job (detail drawer). */
export function StagesCard({
  stages,
  onPreview,
}: {
  stages: JobStage[];
  onPreview: (url: string) => void;
}) {
  const link = (url: string | undefined, label: string) =>
    url ? (
      <a
        href={url}
        rel="noreferrer"
        style={{ color: 'var(--accent)' }}
        onClick={(e) => {
          e.preventDefault();
          onPreview(url);
        }}
      >
        {label}
      </a>
    ) : (
      <span style={{ color: 'var(--muted)' }}>—</span>
    );

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <h3>Stages</h3>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {stages.map((s) => (
          <div
            key={s.phase}
            style={{
              display: 'grid',
              gridTemplateColumns: '24px minmax(160px, 1fr) 70px 70px 56px 72px 190px',
              gap: 12,
              alignItems: 'center',
              padding: '10px 16px',
              borderTop: s.stage === stages[0]?.stage ? 'none' : '1px solid var(--border)',
              fontSize: 13,
            }}
          >
            <span className="mono sub">{s.stage}</span>
            <span>
              {s.label}
              {s.reusedFromJobId !== undefined && (
                <span
                  className="mono sub"
                  style={{ marginLeft: 8, fontSize: 11 }}
                  title="Another pose of the same request already extracted this garment, so this job reused it instead of running the workflow again."
                >
                  reused{s.reusedFromJobId ? ` from ${s.reusedFromJobId.slice(0, 8)}` : ''}
                </span>
              )}
              {s.attempts > 1 && (
                <span className="mono sub" style={{ marginLeft: 8, fontSize: 11 }}>
                  {s.attempts} attempts
                </span>
              )}
            </span>
            {link(s.inputUrl, 'input')}
            {link(s.outputUrl, 'output')}
            <span className="mono sub">{s.workerId ?? '—'}</span>
            <span style={{ color: STATE_COLOR[s.state] }}>{s.state}</span>
            <span className="mono sub" style={{ fontSize: 11 }}>
              {fmtTime(s.startedAt)} → {fmtTime(s.endedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
