import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { useCrumb } from '../../context/BreadcrumbContext';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import type { ModelPoseAsset, WorkflowOption } from '../../types';
import { useAssetsContext } from './AssetsContext';

// What each count draws, mirroring TRYON_SPLIT in
// apps/api/src/modules/messaging/engine/tryon-rules.ts. The server is
// authoritative; this copy exists only to explain the warning strip, so a
// server-side split change degrades the advice here, never the bot.
const NEEDS: { n: number; full: number; half: number }[] = [
  { n: 1, full: 1, half: 0 },
  { n: 3, full: 2, half: 1 },
  { n: 5, full: 3, half: 2 },
];

const GENDERS = [
  { k: 'men', l: 'Men' },
  { k: 'women', l: 'Women' },
  { k: 'boys', l: 'Boys' },
  { k: 'girls', l: 'Girls' },
] as const;

/**
 * Why the bot would skip this pose. Mirrors the eligibility filters in
 * listPoolPoses (apps/api/src/modules/messaging/tryon-jobs.ts); membership in
 * the WhatsApp pool itself is checked separately by the caller.
 */
function undrawableReasons(p: ModelPoseAsset, tryonWorkflowIds: Set<string>): string[] {
  const reasons: string[] = [];
  if (!p.isActive) reasons.push('inactive');
  if (p.shotType !== 'full' && p.shotType !== 'half') reasons.push('not a Full or Half pose');
  if (!p.genderSlug) reasons.push('no gender');
  if (!p.workflowTemplateId) reasons.push('no workflow');
  else if (!tryonWorkflowIds.has(p.workflowTemplateId))
    reasons.push('workflow is not an active try-on');
  return reasons;
}

export function WhatsappPosesTab() {
  const { workflows, setWorkflows, toast, setPreviewUrl } = useAssetsContext();
  const tabHref = '/assets?tab=whatsapp-poses';
  useCrumb(0, { label: 'WhatsApp Poses', href: tabHref });

  const [poses, setPoses] = useState<ModelPoseAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Only PoseAssetsTab normally loads workflows into the shared context; a
  // deep link straight to this tab would otherwise mark every pose undrawable.
  const [workflowsReady, setWorkflowsReady] = useState(workflows.length > 0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelPoseAsset[] }>('/admin/assets/pose-assets');
      setPoses(res.items);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Could not load poses',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (workflows.length > 0) {
      setWorkflowsReady(true);
      return;
    }
    let cancelled = false;
    apiFetch<WorkflowOption[]>('/admin/workflows')
      .then((wf) => {
        if (cancelled) return;
        setWorkflows(wf);
        setWorkflowsReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        // Still show the tab — the poses load independently — but say why they
        // all read as undrawable instead of blaming the poses.
        toast({
          kind: 'error',
          title: 'Could not load workflows',
          body: apiErrorMessage(e, 'Please try again.'),
        });
        setWorkflowsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workflows.length, setWorkflows, toast]);

  const tryonIds = useMemo(
    () =>
      new Set(workflows.filter((w) => w.workflowType === 'tryon' && w.isActive).map((w) => w.id)),
    [workflows],
  );
  const drawable = (p: ModelPoseAsset) =>
    p.whatsappPool === true && undrawableReasons(p, tryonIds).length === 0;
  const wfLabel = (id: string | null) => {
    if (!id) return 'no workflow';
    return workflows.find((w) => w.id === id)?.label ?? 'unknown workflow';
  };

  const setPool = async (p: ModelPoseAsset, whatsappPool: boolean) => {
    setBusy(p.id);
    try {
      await apiFetch(`/admin/assets/pose-assets/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ whatsappPool }),
      });
      setPoses((prev) => prev.map((x) => (x.id === p.id ? { ...x, whatsappPool } : x)));
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Update failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBusy(null);
    }
  };

  const inPool = poses.filter((p) => p.whatsappPool === true);
  const candidates = poses.filter(
    (p) => p.whatsappPool !== true && (p.shotType === 'full' || p.shotType === 'half'),
  );
  const count = (g: string, shot: 'full' | 'half') =>
    poses.filter((p) => drawable(p) && p.genderSlug === g && p.shotType === shot).length;

  const renderSection = (shot: 'full' | 'half', title: string) => {
    const list = inPool.filter((p) => p.shotType === shot);
    return (
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          {title} <span style={{ color: 'var(--muted)' }}>({list.length})</span>
        </h3>
        {list.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            No {shot === 'full' ? 'Full' : 'Half'} poses in the pool yet.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 10,
            }}
          >
            {list.map((p) => {
              const reasons = undrawableReasons(p, tryonIds);
              return (
                <div
                  key={p.id}
                  className="card"
                  style={{ padding: 0, overflow: 'hidden', opacity: p.isActive ? 1 : 0.55 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      background: 'var(--surface-2)',
                    }}
                  >
                    <AssetThumb
                      thumbnailUrl={p.thumbnailUrl}
                      fullUrl={p.r2Url}
                      label={p.displayName ?? p.label}
                      onPreview={setPreviewUrl}
                      cursor={p.r2Url ? 'pointer' : undefined}
                      w={160}
                      h={200}
                    />
                  </div>
                  <div style={{ padding: '8px 8px 10px' }}>
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={p.displayName ?? p.label}
                    >
                      {p.displayName ?? p.label}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                      <span className="badge dot accent" style={{ fontSize: 10 }}>
                        {p.genderSlug ?? 'no gender'}
                      </span>
                      <span className="badge dot accent" style={{ fontSize: 10 }} title="Workflow">
                        {wfLabel(p.workflowTemplateId)}
                      </span>
                      {reasons.length > 0 && (
                        <span
                          className="badge"
                          style={{ fontSize: 10, color: 'var(--warn-ink)' }}
                          title={`Bot skips this pose: ${reasons.join(', ')}`}
                        >
                          not drawable
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy === p.id}
                      onClick={() => void setPool(p, false)}
                      style={{ marginTop: 8, fontSize: 11 }}
                    >
                      {busy === p.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>WhatsApp Poses</h1>
          <p className="lede">
            The poses the WhatsApp try-on bot may draw. This tab only curates the pool; the bot owns
            its count and credit rules.
          </p>
        </div>
      </div>

      {loading || !workflowsReady ? (
        <div style={{ color: 'var(--muted)', padding: '2rem', textAlign: 'center' }}>Loading…</div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            1 pose = 1 Full · 3 = 2 Full + 1 Half · 5 = 3 Full + 2 Half, filtered by the gender the
            seller taps. A pose needs a gender and an active try-on workflow — edit those in Pose
            Assets.
          </p>

          <div className="card" style={{ padding: 12, marginBottom: 16, overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ padding: '4px 8px', textAlign: 'left' }}>Gender</th>
                  <th style={{ padding: '4px 8px', textAlign: 'left' }}>Full</th>
                  <th style={{ padding: '4px 8px', textAlign: 'left' }}>Half</th>
                  <th style={{ padding: '4px 8px', textAlign: 'left' }}>Bot can offer</th>
                </tr>
              </thead>
              <tbody>
                {GENDERS.map((g) => {
                  const full = count(g.k, 'full');
                  const half = count(g.k, 'half');
                  const offers = NEEDS.filter((x) => full >= x.full && half >= x.half).map(
                    (x) => x.n,
                  );
                  return (
                    <tr key={g.k}>
                      <td style={{ padding: '4px 8px' }}>{g.l}</td>
                      <td style={{ padding: '4px 8px' }}>{full}</td>
                      <td style={{ padding: '4px 8px' }}>{half}</td>
                      <td
                        style={{
                          padding: '4px 8px',
                          color:
                            offers.length === NEEDS.length
                              ? 'var(--success-ink)'
                              : 'var(--warn-ink)',
                        }}
                      >
                        {offers.length === 0
                          ? 'nothing — this gender gets no poses'
                          : offers.join(' / ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {renderSection('full', 'Full poses')}
          {renderSection('half', 'Half poses')}

          <button type="button" className="btn" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : 'Add from Pose Assets'}
          </button>
          {adding && (
            <div style={{ marginTop: 12 }}>
              {candidates.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                  No Full or Half poses left to add. Upload poses in Pose Assets first.
                </p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: 10,
                  }}
                >
                  {candidates.map((p) => (
                    <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'center',
                          background: 'var(--surface-2)',
                        }}
                      >
                        <AssetThumb
                          thumbnailUrl={p.thumbnailUrl}
                          fullUrl={p.r2Url}
                          label={p.displayName ?? p.label}
                          onPreview={setPreviewUrl}
                          cursor={p.r2Url ? 'pointer' : undefined}
                          w={160}
                          h={200}
                        />
                      </div>
                      <div style={{ padding: '8px 8px 10px' }}>
                        <p style={{ fontSize: 11, fontWeight: 600 }}>{p.displayName ?? p.label}</p>
                        <p style={{ fontSize: 10, color: 'var(--muted)' }}>
                          {p.shotType} · {p.genderSlug ?? 'no gender'}
                        </p>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy === p.id}
                          onClick={() => void setPool(p, true)}
                          style={{ marginTop: 8, fontSize: 11 }}
                        >
                          {busy === p.id ? 'Adding…' : 'Add'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
