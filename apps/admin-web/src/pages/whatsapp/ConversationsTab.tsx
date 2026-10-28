import type { TraceEntry, TraceSender } from '@aivastra/types';
import { useCallback, useEffect, useState } from 'react';
import { useUrlState } from '../../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../../lib/data';

// WhatsApp → Conversations. A debug view of what the bot received and sent per
// seller number (Redis, 4-day retention): inbound texts and taps, outbound
// messages with the buttons / list rows they carried, send failures, and the
// bot's own decisions (recognition scores against the cutoff, why a type was
// not offered).

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

const POLL_MS = 5000;

const card = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
} as const;

const chip = {
  display: 'inline-block',
  padding: '2px 8px',
  margin: '2px 4px 2px 0',
  border: '1px solid var(--border)',
  borderRadius: 999,
  fontSize: 12,
} as const;

const time = (t: number) => new Date(t).toLocaleTimeString();
const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// A decision the bot made, with the facts it used. Centered and dashed so it
// reads as the bot's reasoning, not as a message the seller received.
function Note({ e }: { e: Extract<TraceEntry, { dir: 'note' }> }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px dashed var(--border)',
          background: 'var(--surface-2)',
          fontSize: 12.5,
        }}
      >
        <div style={{ fontWeight: 600 }}>🔍 {e.title}</div>
        {e.lines.map((l) => (
          <div key={l} style={{ color: 'var(--muted)', marginTop: 2, wordBreak: 'break-word' }}>
            {l}
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
          {time(e.t)} · bot decision, not sent
        </div>
      </div>
    </div>
  );
}

function Bubble({ e }: { e: Exclude<TraceEntry, { dir: 'note' }> }) {
  const out = e.dir === 'out';
  const failed = out && e.status === 'failed';
  const skipped = out && e.status === 'skipped';
  const body =
    e.dir === 'in'
      ? e.kind === 'text'
        ? (e.text ?? '')
        : e.kind === 'reply'
          ? `Tapped: ${e.action}${e.value ? ` · ${e.value}` : ''}`
          : e.kind === 'image'
            ? '[photo]'
            : '[unsupported message]'
      : e.text;
  return (
    <div style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '75%',
          padding: '8px 12px',
          borderRadius: 10,
          border: `1px solid ${failed ? 'var(--danger)' : 'var(--border)'}`,
          background: out ? 'var(--surface-2)' : 'var(--surface)',
          opacity: skipped ? 0.6 : 1,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <div style={{ fontSize: 13.5 }}>{body}</div>
        {out && e.buttonLabel && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            button: {e.buttonLabel}
            {e.url ? ` → ${e.url}` : ''}
          </div>
        )}
        {out && e.options && e.options.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {e.options.map((o) => (
              <span key={o.id} style={chip} title={o.id}>
                {o.title}
                <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}>{o.id}</span>
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
          {time(e.t)}
          {out && e.status !== 'sent' && ` · ${e.status}`}
          {failed && e.error ? ` · ${e.error}` : ''}
          {skipped ? ' · outside the 24h window' : ''}
        </div>
      </div>
    </div>
  );
}

export function ConversationsTab({ toast }: Props) {
  const [selected, setSelected] = useUrlState('sender');
  const [senders, setSenders] = useState<TraceSender[] | null>(null);
  const [entries, setEntries] = useState<TraceEntry[] | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<{ items: TraceSender[] }>('/admin/whatsapp/conversations');
      setSenders(list.items);
      if (selected) {
        const t = await apiFetch<{ entries: TraceEntry[] }>(
          `/admin/whatsapp/conversations/${encodeURIComponent(selected)}`,
        );
        setEntries(t.entries);
      } else {
        setEntries(null);
      }
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Could not load conversations') });
    }
  }, [selected, toast]);

  // Poll only while the tab is actually on screen so a background page doesn't
  // create a stream of Redis round-trips every 5 s.
  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, minHeight: 480 }}>
      <div style={{ ...card, overflowY: 'auto', maxHeight: '70vh' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <strong style={{ fontSize: 13 }}>Senders (last 4 days)</strong>
          <button type="button" onClick={load} style={{ fontSize: 12 }}>
            Refresh
          </button>
        </div>
        {senders === null && <p style={{ padding: 12, color: 'var(--muted)' }}>Loading…</p>}
        {senders?.length === 0 && (
          <p style={{ padding: 12, color: 'var(--muted)' }}>No conversations yet.</p>
        )}
        {senders?.map((s) => (
          <button
            key={s.waId}
            type="button"
            onClick={() => setSelected(s.waId)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              background: selected === s.waId ? 'var(--surface-2)' : 'none',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>+{s.waId}</div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {s.preview || '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {ago(s.lastAt)} · {s.count} msgs
            </div>
          </button>
        ))}
      </div>

      <div style={{ ...card, padding: 14, overflowY: 'auto', maxHeight: '70vh' }}>
        {!selected && (
          <p style={{ color: 'var(--muted)' }}>Pick a sender to see the conversation.</p>
        )}
        {selected && entries === null && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
        {selected && entries?.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>
            Nothing recorded for +{selected} (it may have expired).
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries?.map((e, i) =>
            e.dir === 'note' ? (
              <Note key={`${e.t}-${i}`} e={e} />
            ) : (
              <Bubble key={`${e.t}-${i}`} e={e} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
