import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { SearchableSelect } from '../../components/SearchableSelect';
import { Switch } from '../../components/Switch';
import { apiErrorMessage, apiFetch } from '../../lib/data';

type CompressionLevel = 'lossless' | 'q95' | 'q90' | 'q85' | 'q80';
type JobConfig = { enabled: boolean; level: CompressionLevel };
type CompressionConfig = Record<string, JobConfig>;

// Order + friendly labels for every JobSource that gets a sharp-compressible
// image output (mirrors IMAGE_COMPRESSION_JOB_SOURCES in
// packages/types/src/image-compression.ts — catalog_video is excluded there,
// it's PixVerse's video lane, not an image).
const JOB_GROUPS: { label: string; rows: [string, string][] }[] = [
  {
    label: 'Catalog',
    rows: [
      ['catalog', 'Catalog (Studio)'],
      ['merchant_catalog', 'Merchant Catalog'],
      ['merchant_catalog_saree_mannequin', 'Merchant Catalog — Saree Mannequin'],
      ['api_catalog', 'API Catalog'],
    ],
  },
  {
    label: 'Try-on',
    rows: [
      ['tryon', 'Tryon (Direct Edit)'],
      ['api_tryon', 'API Tryon'],
      ['merchant_tryon', 'Merchant Tryon'],
      ['regenerate', 'Regenerate'],
    ],
  },
  {
    label: 'Saree',
    rows: [
      ['saree', 'Saree Catalogue'],
      ['saree_mannequin', 'Saree Mannequin (Step 1)'],
      ['api_saree_mannequin', 'API Saree Mannequin'],
    ],
  },
  {
    label: 'Widgets',
    rows: [
      ['shopify', 'Shopify Widget Try-On'],
      ['wordpress_tryon', 'WordPress Widget Try-On'],
    ],
  },
];

// Flat ordered list for bulk operations.
const ALL_SOURCES: [string, string][] = JOB_GROUPS.flatMap((g) => g.rows);

const LEVEL_OPTIONS = [
  { id: 'lossless', label: 'Lossless' },
  { id: 'q95', label: 'q95' },
  { id: 'q90', label: 'q90' },
  { id: 'q85', label: 'q85' },
  { id: 'q80', label: 'q80' },
];

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function ImageCompressionTab({ toast }: Props) {
  const [config, setConfig] = useState<CompressionConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [bulkLevel, setBulkLevel] = useState<CompressionLevel>('q90');

  useEffect(() => {
    apiFetch<CompressionConfig>('/admin/image-compression')
      .then(setConfig)
      .catch((err) =>
        toast({
          kind: 'error',
          title: 'Failed to load image compression config',
          body: apiErrorMessage(err, 'Please try again.'),
        }),
      );
  }, [toast]);

  function updateRow(source: string, patch: Partial<JobConfig>) {
    setConfig((prev) => (prev ? { ...prev, [source]: { ...prev[source], ...patch } } : prev));
  }

  function applyLevelToAll() {
    setConfig((prev) => {
      if (!prev) return prev;
      const next: CompressionConfig = { ...prev };
      for (const [key] of ALL_SOURCES) next[key] = { ...next[key], level: bulkLevel };
      return next;
    });
  }

  function enableAll(enabled: boolean) {
    setConfig((prev) => {
      if (!prev) return prev;
      const next: CompressionConfig = { ...prev };
      for (const [key] of ALL_SOURCES) next[key] = { ...next[key], enabled };
      return next;
    });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const result = await apiFetch<CompressionConfig>('/admin/image-compression', {
        method: 'PATCH',
        body: JSON.stringify(config),
      });
      setConfig(result);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast({ title: 'Image compression config saved' });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to save',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (!config) {
    return (
      <div className="card settings-card">
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(['r0', 'r1', 'r2', 'r3', 'r4', 'r5'] as const).map((k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="skel" style={{ flex: 1, height: 18, borderRadius: 4 }} />
              <div className="skel" style={{ width: 36, height: 20, borderRadius: 10 }} />
              <div className="skel" style={{ width: 100, height: 32, borderRadius: 'var(--r)' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const enabledCount = ALL_SOURCES.filter(([src]) => config[src]?.enabled).length;
  const total = ALL_SOURCES.length;
  const pct = total === 0 ? 0 : Math.round((enabledCount / total) * 100);

  return (
    <div className="card settings-card" style={{ overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div
        style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
              }}
            >
              WebP Compression
            </h3>
            {/* Live-warning pill */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 99,
                background: 'var(--warn-soft)',
                color: 'var(--warn-ink)',
                border: '1px solid var(--warn-border)',
                whiteSpace: 'nowrap',
              }}
            >
              <Icon.Warning />
              Applies live
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--muted)',
              lineHeight: 1.55,
            }}
          >
            Per-job-type WebP output compression. Disabled = original uncompressed PNG. Changes
            affect jobs already queued, not just new ones.
          </p>
        </div>

        {/* Progress summary */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 5,
            flexShrink: 0,
            paddingTop: 2,
          }}
        >
          <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>
            <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{enabledCount}</strong>
            {' / '}
            {total}
            <span style={{ marginLeft: 4 }}>on</span>
          </span>
          {/* Progress bar */}
          <div
            style={{
              width: 72,
              height: 3,
              borderRadius: 99,
              background: 'var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: pct === 100 ? 'var(--success)' : 'var(--accent)',
                borderRadius: 99,
                transition: 'width 300ms ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Bulk toolbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 24px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
          flexWrap: 'wrap',
          rowGap: 6,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 2 }}>Set all to</span>
        <SearchableSelect
          options={LEVEL_OPTIONS}
          value={bulkLevel}
          disabled={saving}
          onChange={(v) => setBulkLevel(v as CompressionLevel)}
          style={{ width: 100 }}
          ariaLabel="Bulk compression level"
        />
        <button className="btn sm" disabled={saving} onClick={applyLevelToAll}>
          Apply
        </button>

        {/* Separator */}
        <div
          style={{
            width: 1,
            height: 18,
            background: 'var(--border)',
            flexShrink: 0,
            margin: '0 4px',
          }}
        />

        <button className="btn sm" disabled={saving} onClick={() => enableAll(true)}>
          Enable all
        </button>
        <button className="btn sm" disabled={saving} onClick={() => enableAll(false)}>
          Disable all
        </button>
      </div>

      {/* ── Table ── */}
      <div style={{ overflowY: 'auto', maxHeight: 520 }}>
        <table className="tbl" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '52%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '28%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Job type</th>
              <th style={{ textAlign: 'center' }}>Enabled</th>
              <th>Level</th>
            </tr>
          </thead>

          {JOB_GROUPS.map((group) => (
            <tbody key={group.label}>
              {/* Group heading */}
              <tr>
                <td
                  colSpan={3}
                  style={{
                    padding: '6px 16px',
                    background: 'var(--surface-2)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                    borderTop: '1px solid var(--border)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {group.label}
                </td>
              </tr>

              {/* Rows */}
              {group.rows.map(([source, label]) => {
                const row = config[source] ?? { enabled: false, level: 'q90' as CompressionLevel };
                return (
                  <tr key={source}>
                    {/* Name — dims when off */}
                    <td>
                      <span
                        style={{
                          fontSize: 13.5,
                          color: row.enabled ? 'var(--ink)' : 'var(--muted)',
                          transition: 'color 180ms ease',
                        }}
                      >
                        {label}
                      </span>
                    </td>

                    {/* Toggle */}
                    <td style={{ textAlign: 'center' }}>
                      <Switch
                        checked={row.enabled}
                        disabled={saving}
                        onChange={(enabled) => updateRow(source, { enabled })}
                      />
                    </td>

                    {/* Level — dims when off */}
                    <td
                      style={{
                        opacity: row.enabled ? 1 : 0.35,
                        transition: 'opacity 180ms ease',
                      }}
                    >
                      <SearchableSelect
                        options={LEVEL_OPTIONS}
                        value={row.level}
                        disabled={saving || !row.enabled}
                        onChange={(level) =>
                          updateRow(source, { level: level as CompressionLevel })
                        }
                        style={{ width: 110 }}
                        ariaLabel={`Compression level for ${label}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>

      {/* ── Footer ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 10,
          padding: '12px 24px',
          borderTop: '1px solid var(--border)',
        }}
      >
        {/* Saved flash */}
        {saved && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12.5,
              color: 'var(--success-ink)',
              fontWeight: 500,
              animation: 'fade-in 180ms ease',
            }}
          >
            <Icon.Check />
            Saved
          </span>
        )}

        <button
          className="btn primary"
          onClick={() => void save()}
          disabled={saving}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
