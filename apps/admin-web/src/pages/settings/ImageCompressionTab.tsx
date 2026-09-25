import { useEffect, useState } from 'react';
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
const JOB_SOURCE_LABELS: [string, string][] = [
  ['catalog', 'Catalog (Studio)'],
  ['merchant_catalog', 'Merchant Catalog'],
  ['merchant_catalog_saree_mannequin', 'Merchant Catalog — Saree Mannequin'],
  ['api_catalog', 'API Catalog'],
  ['tryon', 'Tryon (Direct Edit)'],
  ['api_tryon', 'API Tryon'],
  ['merchant_tryon', 'Merchant Tryon'],
  ['regenerate', 'Regenerate'],
  ['saree', 'Saree Catalogue'],
  ['saree_mannequin', 'Saree Mannequin (Step 1)'],
  ['api_saree_mannequin', 'API Saree Mannequin'],
  ['shopify', 'Shopify Widget Try-On'],
  ['wordpress_tryon', 'WordPress Widget Try-On'],
];

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRow(source: string, patch: Partial<JobConfig>) {
    setConfig((prev) => (prev ? { ...prev, [source]: { ...prev[source], ...patch } } : prev));
  }

  function applyToAll(source: string) {
    setConfig((prev) => {
      if (!prev) return prev;
      const row = prev[source];
      const next: CompressionConfig = { ...prev };
      for (const [key] of JOB_SOURCE_LABELS) next[key] = { ...row };
      return next;
    });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const saved = await apiFetch<CompressionConfig>('/admin/image-compression', {
        method: 'PATCH',
        body: JSON.stringify(config),
      });
      setConfig(saved);
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

  if (!config) {
    return (
      <div className="card settings-card">
        <div className="card-body">Loading…</div>
      </div>
    );
  }

  return (
    <div className="card settings-card">
      <div className="card-body">
        <div className="setting-lbl" style={{ marginBottom: 8 }}>
          Per-job-type WebP compression for finalized job output images. Disabled = original
          uncompressed PNG. Applies live — a change here affects jobs already queued, not just new
          ones.
        </div>
        <table>
          <thead>
            <tr>
              <th>Job type</th>
              <th>Enabled</th>
              <th>Level</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {JOB_SOURCE_LABELS.map(([source, label]) => {
              const row = config[source] ?? { enabled: false, level: 'q90' as CompressionLevel };
              return (
                <tr key={source}>
                  <td>{label}</td>
                  <td style={{ textAlign: 'center' }}>
                    <Switch
                      checked={row.enabled}
                      disabled={saving}
                      onChange={(enabled) => updateRow(source, { enabled })}
                    />
                  </td>
                  <td style={{ maxWidth: 140 }}>
                    <SearchableSelect
                      options={LEVEL_OPTIONS}
                      value={row.level}
                      disabled={saving}
                      onChange={(level) => updateRow(source, { level: level as CompressionLevel })}
                    />
                  </td>
                  <td>
                    <button
                      className="btn"
                      disabled={saving}
                      onClick={() => applyToAll(source)}
                      title="Copy this row's enabled + level to every job type"
                    >
                      Apply to all
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="setting-actions">
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
