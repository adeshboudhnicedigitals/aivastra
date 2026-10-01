import { useRef, useState } from 'react';
import { getToken } from '../lib/data';
import type { GenderSlug, WorkflowOption } from '../types';
import { SearchableSelect } from './SearchableSelect';

interface Props {
  defaultGenderSlug: GenderSlug;
  workflows: WorkflowOption[];
  onDone: () => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  /**
   * When set, the ZIP is being imported from one garment type's Configs page
   * rather than the general Pose Assets tab — the gender is fixed (no picker)
   * and the server scopes each newly created pose to just this garment type
   * instead of leaving it visible on every garment type of its gender.
   */
  subcategoryId?: string;
  subcategoryLabel?: string;
}

export function BulkImportPosesModal({
  defaultGenderSlug,
  workflows,
  onDone,
  onClose,
  toast,
  subcategoryId,
  subcategoryLabel,
}: Props) {
  const [gender, setGender] = useState<GenderSlug>(defaultGenderSlug);
  const [workflowTemplateId, setWorkflowTemplateId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'uploading' | 'processing'>('uploading');
  const [counts, setCounts] = useState<{ phase: string; done: number; total: number } | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  return (
    <div
      className="modal-overlay"
      onClick={() => !(importing && phase === 'processing') && onClose()}
    >
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Bulk import ZIP</h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>ZIP file</label>
            <input
              type="file"
              accept=".zip"
              style={{ width: '100%' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)' }}>
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </p>
            )}
          </div>
          {subcategoryId ? (
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--r-lg)',
                fontSize: 12,
                color: 'var(--accent)',
              }}
            >
              Scoped to <strong>{subcategoryLabel ?? 'this garment type'}</strong> only — poses
              won't appear on other {gender} garment types.
            </div>
          ) : (
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Gender</label>
              <SearchableSelect
                options={[
                  { id: 'men', label: 'Men' },
                  { id: 'women', label: 'Women' },
                  { id: 'boys', label: 'Boys' },
                  { id: 'girls', label: 'Girls' },
                ]}
                value={gender}
                onChange={(v) => setGender(v as GenderSlug)}
                disabled={importing}
              />
            </div>
          )}
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Workflow template
            </label>
            <SearchableSelect
              options={workflows}
              value={workflowTemplateId}
              onChange={setWorkflowTemplateId}
              disabled={importing}
              placeholder="— search workflow —"
            />
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            ZIP must contain <code>poses/</code> folder with pose images. Filenames become the dedup
            label.
          </p>
          {importing && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  marginBottom: 4,
                  color: 'var(--muted)',
                }}
              >
                <span>
                  {phase === 'uploading'
                    ? 'Uploading…'
                    : counts
                      ? `Processing ${counts.phase} (${counts.done}/${counts.total})…`
                      : 'Processing ZIP…'}
                </span>
                <span>{progress}%</span>
              </div>
              <div
                style={{
                  height: 6,
                  background: 'var(--border)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'var(--accent, #6366f1)',
                    borderRadius: 3,
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button
            className="btn ghost"
            disabled={importing && phase === 'processing'}
            onClick={() => {
              if (xhrRef.current) {
                xhrRef.current.abort();
                xhrRef.current = null;
              }
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            className="btn"
            disabled={importing || !file || !workflowTemplateId}
            onClick={() => {
              if (!file || !workflowTemplateId) return;
              setImporting(true);
              setProgress(0);
              setPhase('uploading');
              setCounts(null);
              const fd = new FormData();
              fd.append('workflowTemplateId', workflowTemplateId);
              fd.append('genderSlug', gender);
              if (subcategoryId) fd.append('subcategoryId', subcategoryId);
              fd.append('zip', file);
              const tok = getToken();
              const xhr = new XMLHttpRequest();
              xhrRef.current = xhr;
              xhr.open('POST', '/admin/assets/bulk-import');
              if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);
              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
              };
              xhr.upload.onload = () => {
                setPhase('processing');
                setProgress(0);
              };
              let lastLen = 0;
              xhr.onprogress = () => {
                const newText = xhr.responseText.slice(lastLen);
                lastLen = xhr.responseText.length;
                for (const line of newText.split('\n').filter(Boolean)) {
                  try {
                    const msg = JSON.parse(line) as {
                      phase?: string;
                      done?: number;
                      total?: number;
                    };
                    if (msg.phase && msg.done !== undefined && msg.total !== undefined) {
                      setCounts({ phase: msg.phase, done: msg.done, total: msg.total });
                      setProgress(Math.round((msg.done / msg.total) * 100));
                    }
                  } catch {
                    /* partial line — ignore */
                  }
                }
              };
              xhr.onload = async () => {
                xhrRef.current = null;
                setImporting(false);
                setPhase('uploading');
                setCounts(null);
                if (xhr.status >= 200 && xhr.status < 300) {
                  const lines = xhr.responseText.split('\n').filter(Boolean);
                  const result = JSON.parse(lines[lines.length - 1] ?? '{}') as {
                    done?: boolean;
                    created: { faces: number; backgrounds: number; poses: number };
                    errors: string[];
                  };
                  onClose();
                  setFile(null);
                  setProgress(0);
                  const { faces: fCount, backgrounds: bCount, poses: pCount } = result.created;
                  toast({
                    title: `Imported ${fCount} faces, ${bCount} backgrounds, ${pCount} poses`,
                    body:
                      fCount + bCount + pCount === 0
                        ? 'All items already exist — nothing new to import.'
                        : undefined,
                  });
                  if (result.errors.length > 0) {
                    console.error('Bulk import errors:', result.errors);
                    toast({
                      kind: 'error',
                      title: `${result.errors.length} item(s) failed`,
                      body: result.errors[0],
                    });
                  }
                  onDone();
                } else {
                  const err = JSON.parse(xhr.responseText) as { error?: { message?: string } };
                  toast({
                    kind: 'error',
                    title: 'Bulk import failed',
                    body: err.error?.message ?? xhr.statusText,
                  });
                }
              };
              xhr.onerror = () => {
                xhrRef.current = null;
                setImporting(false);
                setPhase('uploading');
                setCounts(null);
                toast({ kind: 'error', title: 'Bulk import failed', body: 'Network error' });
              };
              xhr.onabort = () => {
                xhrRef.current = null;
                setImporting(false);
                setPhase('uploading');
                setProgress(0);
                setCounts(null);
              };
              xhr.send(fd);
            }}
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
