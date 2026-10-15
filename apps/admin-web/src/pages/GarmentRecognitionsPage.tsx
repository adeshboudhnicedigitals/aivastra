import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { SearchableSelect } from '../components/SearchableSelect';
import { apiErrorMessage, apiFetch } from '../lib/data';

interface RecognitionItem {
  id: string;
  createdAt: string;
  gender: string | null;
  outcome: 'answered' | 'no_worker' | 'failed' | 'expired';
  answer: string | null;
  ms: number;
}

interface RecognitionDetail extends RecognitionItem {
  garmentKey: string;
  options: Array<{ slug: string; label: string }>;
  workerId: string | null;
  workflowTemplateId: string | null;
  photoUrl: string;
}

interface ListResponse {
  items: RecognitionItem[];
  nextCursor: string | null;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  /** Rendered inside another page (the Classify Service tab): skip the page heading. */
  embedded?: boolean;
}

const OUTCOME_OPTIONS = [
  { id: 'answered', label: 'Answered' },
  { id: 'no_worker', label: 'No worker' },
  { id: 'failed', label: 'Failed' },
  { id: 'expired', label: 'Expired' },
];

const OUTCOME_COLOR: Record<string, string> = {
  answered: 'var(--success-ink, #22c55e)',
  no_worker: 'var(--warn-ink, #f59e0b)',
  failed: 'var(--danger-ink, #ef4444)',
  expired: 'var(--muted)',
};

const PAGE_SIZE = 25;

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function GarmentRecognitionsPage({ toast, embedded = false }: Props) {
  const [items, setItems] = useState<RecognitionItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecognitionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (outcome: string, cursor: string | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (outcome) params.set('outcome', outcome);
        if (cursor) params.set('cursor', cursor);
        const data = await apiFetch<ListResponse>(`/admin/garment-recognitions?${params}`);
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
      } catch (e) {
        toast({
          kind: 'error',
          title: 'Failed to load recognitions',
          body: apiErrorMessage(e, 'Please try again.'),
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    setDetailId(null);
    setDetail(null);
    void load(outcomeFilter, null, false);
  }, [outcomeFilter, load]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await apiFetch<RecognitionDetail>(`/admin/garment-recognitions/${id}`));
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load recognition',
        body: apiErrorMessage(e, 'Please try again.'),
      });
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = useCallback(() => {
    setDetailId(null);
    setDetail(null);
  }, []);

  useEffect(() => {
    if (!detailId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detailId, closeDetail]);

  return (
    <>
      {!embedded && (
        <div className="page-head">
          <div>
            <h1 style={{ marginBottom: 4 }}>Garment Recognitions</h1>
            <p className="lede" style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>
              Every WhatsApp garment-recognition request the GPU answered — or didn&apos;t. Rows
              expire after 30 days.
            </p>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ width: 220 }}>
          <SearchableSelect
            options={OUTCOME_OPTIONS}
            value={outcomeFilter}
            onChange={(id) => setOutcomeFilter(id)}
            emptyLabel="All outcomes"
            ariaLabel="Filter by outcome"
            placeholder="All outcomes"
          />
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: '20px',
            border: '1.5px dashed var(--border)',
            borderRadius: 8,
            color: 'var(--muted)',
          }}
        >
          No recognitions yet.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    borderBottom: '1px solid var(--border)',
                    color: 'var(--muted)',
                  }}
                >
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Time</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Gender</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Outcome</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Answer</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Ms</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => void openDetail(item.id)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '8px 10px' }}>{formatTime(item.createdAt)}</td>
                    <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>
                      {item.gender ?? '—'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: OUTCOME_COLOR[item.outcome] ?? 'var(--muted)',
                            display: 'inline-block',
                          }}
                        />
                        {item.outcome}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        fontFamily: 'var(--mono)',
                        fontSize: 12,
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={item.answer ?? ''}
                    >
                      {item.answer ?? '—'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{item.ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn sm secondary"
                disabled={loadingMore}
                onClick={() => void load(outcomeFilter, nextCursor, true)}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {detailId && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div
            className="drawer"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '520px', maxWidth: '100vw' }}
          >
            <div className="drawer-head">
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Recognition</h2>
                {detail && (
                  <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 3 }}>
                    {formatTime(detail.createdAt)}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn sm ghost"
                onClick={closeDetail}
                style={{ marginLeft: 'auto' }}
                title="Close"
              >
                <Icon.Close />
              </button>
            </div>

            <div
              className="drawer-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px' }}
            >
              {detailLoading || !detail ? (
                <p style={{ color: 'var(--muted)', padding: '24px 0', fontSize: '0.875rem' }}>
                  Loading recognition…
                </p>
              ) : (
                <>
                  {/* biome-ignore lint/performance/noImgElement: admin panel shows the seller's garment photo */}
                  <img
                    src={detail.photoUrl}
                    alt="Garment sent for recognition"
                    style={{
                      width: '100%',
                      maxHeight: 320,
                      objectFit: 'contain',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-2)',
                    }}
                  />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: 10,
                      fontSize: 12,
                    }}
                  >
                    {(
                      [
                        ['Gender', detail.gender ?? '—'],
                        ['Outcome', detail.outcome],
                        ['Answer', detail.answer ?? '—'],
                        ['Duration', `${detail.ms} ms`],
                        ['Worker', detail.workerId ?? '—'],
                      ] as Array<[string, string]>
                    ).map(([label, value]) => (
                      <div key={label}>
                        <span
                          style={{
                            color: 'var(--muted)',
                            fontSize: 10,
                            display: 'block',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            fontWeight: 600,
                          }}
                        >
                          {label}
                        </span>
                        <div
                          style={{
                            fontWeight: 600,
                            color: 'var(--ink)',
                            marginTop: 2,
                            wordBreak: 'break-word',
                          }}
                        >
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: 'var(--muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        marginBottom: 6,
                      }}
                    >
                      Options sent ({detail.options.length})
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: '10px 12px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        fontSize: 11.5,
                        maxHeight: 220,
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {JSON.stringify(detail.options, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: 'var(--muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        marginBottom: 6,
                      }}
                    >
                      Raw answer
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 12,
                        padding: '8px 12px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        wordBreak: 'break-word',
                      }}
                    >
                      {detail.answer ?? '(none)'}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
