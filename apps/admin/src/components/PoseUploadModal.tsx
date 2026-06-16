import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type { ModelPoseAsset, WorkflowOption } from '../types';
import { Icon } from './Icons';

interface PresignResult {
  uploadUrl: string;
  r2Key: string;
  thumbnailUploadUrl: string;
  thumbnailKey: string;
}

interface Props {
  garmentTypeGenderSlug: string;
  onDone: (added: ModelPoseAsset) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

interface FileEntry {
  file: File;
  label: string;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

async function putFile(url: string, file: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(file);
  });
}

function stemFromFilename(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--muted)',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

export function PoseUploadModal({ garmentTypeGenderSlug, onDone, onClose, toast }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [genderSlug, setGenderSlug] = useState(garmentTypeGenderSlug);
  const [workflowTemplateId, setWorkflowTemplateId] = useState('');
  const [promptGarmentPhase, setPromptGarmentPhase] = useState('');
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const selectedWorkflow = workflows.find((w) => w.id === workflowTemplateId);

  useEffect(() => {
    apiFetch<WorkflowOption[]>('/admin/workflows')
      .then((wfs) => {
        const active = wfs.filter((w) => w.isActive);
        setWorkflows(active);
        const first = active[0];
        if (first) {
          setWorkflowTemplateId(first.id);
          setPromptGarmentPhase(first.defaultGarmentPhasePrompt);
        }
      })
      .catch(() => toast({ kind: 'error', title: 'Failed to load workflows' }));
  }, [toast]);

  // cleanup object URLs on unmount only — intentionally omit entries from deps
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup runs once on unmount
  useEffect(() => {
    return () => {
      for (const e of entries) URL.revokeObjectURL(e.previewUrl);
    };
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const newEntries: FileEntry[] = arr.map((f) => ({
      file: f,
      label: stemFromFilename(f.name),
      previewUrl: URL.createObjectURL(f),
      status: 'pending',
    }));
    setEntries((prev) => [...prev, ...newEntries]);
  };

  const removeEntry = (idx: number) => {
    setEntries((prev) => {
      URL.revokeObjectURL(prev[idx]?.previewUrl ?? '');
      return prev.filter((_, i) => i !== idx);
    });
  };

  const updateLabel = (idx: number, label: string) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, label } : e)));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (entries.length === 0 || !workflowTemplateId) return;
    setUploading(true);
    setDoneCount(0);

    let successCount = 0;
    let lastAdded: ModelPoseAsset | null = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      if (entry.status === 'done') continue;

      setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, status: 'uploading' } : e)));

      try {
        const presign = await apiFetch<PresignResult>('/admin/assets/pose-assets/presign', {
          method: 'POST',
          body: JSON.stringify({ contentType: entry.file.type }),
        });

        await Promise.all([
          putFile(presign.uploadUrl, entry.file),
          makeThumbnail(entry.file).then((t) => putFile(presign.thumbnailUploadUrl, t)),
        ]);

        const result = await apiFetch<ModelPoseAsset>('/admin/assets/pose-assets', {
          method: 'POST',
          body: JSON.stringify({
            label: entry.label.trim() || stemFromFilename(entry.file.name),
            r2Key: presign.r2Key,
            thumbnailKey: presign.thumbnailKey,
            workflowTemplateId,
            promptGarmentPhase: promptGarmentPhase.trim() || null,
            genderSlug,
          }),
        });

        lastAdded = result;
        successCount++;
        setDoneCount((c) => c + 1);
        setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, status: 'done' } : e)));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed';
        setEntries((prev) =>
          prev.map((e, j) => (j === i ? { ...e, status: 'error', error: msg } : e)),
        );
      }
    }

    setUploading(false);
    if (successCount > 0 && lastAdded) {
      toast({ title: `${successCount} pose${successCount !== 1 ? 's' : ''} uploaded` });
      onDone(lastAdded);
    }
  };

  const pendingCount = entries.filter((e) => e.status === 'pending' || e.status === 'error').length;
  const allDone = entries.length > 0 && entries.every((e) => e.status === 'done');
  const canUpload = !uploading && pendingCount > 0 && !!workflowTemplateId;

  return (
    <div className="modal-overlay" onClick={uploading ? undefined : onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(620px, calc(100vw - 40px))' }}
      >
        {/* Header */}
        <div className="modal-head" style={{ padding: '14px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step === 2 && !uploading && (
              <button
                className="btn sm ghost"
                onClick={() => setStep(1)}
                style={{ padding: '4px 8px', fontSize: 12 }}
              >
                ← Back
              </button>
            )}
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
                {step === 1 ? 'Choose pose type' : 'Upload poses'}
              </h3>
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
                {step === 1
                  ? 'Select the workflow that matches these poses.'
                  : `${selectedWorkflow?.label ?? ''} — select one or more pose images`}
              </p>
            </div>
          </div>
          <button
            className="btn sm ghost"
            onClick={onClose}
            disabled={uploading}
            style={{ marginLeft: 'auto' }}
          >
            <Icon.Close />
          </button>
        </div>

        {/* Body */}
        <div
          className="modal-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            maxHeight: '75vh',
            overflowY: 'auto',
            padding: '20px 22px',
          }}
        >
          {/* Step 1: Workflow */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {workflows.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    color: 'var(--muted)',
                    fontSize: 13,
                    padding: '40px 0',
                  }}
                >
                  Loading workflows…
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 12,
                  }}
                >
                  {workflows.map((wf) => (
                    <button
                      key={wf.id}
                      type="button"
                      onClick={() => {
                        setWorkflowTemplateId(wf.id);
                        setPromptGarmentPhase(wf.defaultGarmentPhasePrompt);
                        setStep(2);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        padding: '16px',
                        background:
                          workflowTemplateId === wf.id ? 'var(--accent-soft)' : 'var(--surface-2)',
                        border: `1.5px solid ${workflowTemplateId === wf.id ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 'var(--r-lg)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'border-color 120ms, background 120ms',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-1)' }}>
                        {wf.label}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>✓ Upper garment</span>
                        {wf.lowerNodeId && (
                          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                            ✓ Lower garment
                          </span>
                        )}
                        {wf.shoeNodeId && (
                          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>✓ Shoes</span>
                        )}
                        {wf.sizeNodeIds.length > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                            ✓ Aspect ratio
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Files + settings */}
          {step === 2 && (
            <>
              {/* Workflow bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 500, color: 'var(--ink-1)' }}>
                  {selectedWorkflow?.label ?? '—'}
                </span>
                <button
                  type="button"
                  className="btn sm ghost"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  disabled={uploading}
                  onClick={() => setStep(1)}
                >
                  Change
                </button>
              </div>

              {/* Gender filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SectionHead>Category</SectionHead>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['men', 'women', 'boys', 'girls'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      disabled={uploading}
                      onClick={() => setGenderSlug(g)}
                      style={{
                        padding: '5px 14px',
                        fontSize: 12,
                        fontWeight: 500,
                        borderRadius: 'var(--r)',
                        border: `1px solid ${genderSlug === g ? 'var(--accent)' : 'var(--border)'}`,
                        background: genderSlug === g ? 'var(--accent-soft)' : 'var(--surface-2)',
                        color: genderSlug === g ? 'var(--accent)' : 'var(--muted)',
                        cursor: uploading ? 'not-allowed' : 'pointer',
                        transition: 'all 100ms',
                        textTransform: 'capitalize',
                      }}
                    >
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => !uploading && fileInputRef.current?.click()}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '24px 16px',
                  border: '1.5px dashed var(--border-strong)',
                  borderRadius: 'var(--r-lg)',
                  background: 'var(--surface-2)',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                <Icon.Upload />
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>
                  {entries.length === 0 ? 'Click or drop pose images here' : 'Add more images'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  PNG, JPG, WEBP — multiple files supported
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  style={{ display: 'none' }}
                  disabled={uploading}
                  onChange={(e) => e.target.files && addFiles(e.target.files)}
                />
              </div>

              {/* File list */}
              {entries.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <SectionHead>
                    {entries.length} image{entries.length !== 1 ? 's' : ''}
                    {uploading ? ` — ${doneCount}/${entries.length} done` : ''}
                  </SectionHead>
                  {entries.map((entry, idx) => (
                    <div
                      key={`${entry.file.name}-${idx}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        background:
                          entry.status === 'done'
                            ? 'var(--success-soft)'
                            : entry.status === 'error'
                              ? 'var(--danger-soft)'
                              : entry.status === 'uploading'
                                ? 'var(--accent-soft)'
                                : 'var(--surface-2)',
                        border: `1px solid ${
                          entry.status === 'done'
                            ? 'var(--success-border)'
                            : entry.status === 'error'
                              ? 'var(--danger-border)'
                              : entry.status === 'uploading'
                                ? 'var(--accent)'
                                : 'var(--border)'
                        }`,
                        borderRadius: 'var(--r-lg)',
                      }}
                    >
                      {/* biome-ignore lint/performance/noImgElement: admin panel */}
                      <img
                        src={entry.previewUrl}
                        alt=""
                        style={{
                          width: 40,
                          height: 40,
                          objectFit: 'cover',
                          borderRadius: 6,
                          flexShrink: 0,
                        }}
                      />
                      <input
                        className="input"
                        value={entry.label}
                        disabled={uploading}
                        onChange={(e) => updateLabel(idx, e.target.value)}
                        style={{ fontSize: 12, flex: 1, padding: '4px 8px', height: 30 }}
                        placeholder="Label"
                      />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color:
                            entry.status === 'done'
                              ? 'var(--success-ink)'
                              : entry.status === 'error'
                                ? 'var(--danger-ink)'
                                : entry.status === 'uploading'
                                  ? 'var(--accent)'
                                  : 'var(--muted)',
                          flexShrink: 0,
                          minWidth: 60,
                          textAlign: 'right',
                        }}
                        title={entry.error}
                      >
                        {entry.status === 'done'
                          ? '✓ Done'
                          : entry.status === 'error'
                            ? '✗ Error'
                            : entry.status === 'uploading'
                              ? 'Uploading…'
                              : `${(entry.file.size / 1024).toFixed(0)} KB`}
                      </span>
                      {!uploading && entry.status !== 'done' && (
                        <button
                          type="button"
                          onClick={() => removeEntry(idx)}
                          style={{
                            width: 22,
                            height: 22,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: 'none',
                            background: 'var(--surface)',
                            borderRadius: 4,
                            cursor: 'pointer',
                            color: 'var(--muted-2)',
                            padding: 0,
                            flexShrink: 0,
                          }}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          >
                            <path d="M2 2l8 8M10 2l-8 8" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Prompt */}
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => setPromptsOpen((v) => !v)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'var(--surface-2)',
                    border: 'none',
                    cursor: 'pointer',
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>
                    Prompt{' '}
                    <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 4 }}>
                      (applied to all)
                    </span>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!promptsOpen && promptGarmentPhase && (
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--muted)',
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {promptGarmentPhase.slice(0, 50)}
                        {promptGarmentPhase.length > 50 ? '…' : ''}
                      </span>
                    )}
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      style={{
                        color: 'var(--muted)',
                        transform: promptsOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 150ms',
                      }}
                    >
                      <path
                        d="M3 5l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </button>
                {promptsOpen && (
                  <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                    <div className="field">
                      <label>Positive prompt</label>
                      <textarea
                        className="input"
                        value={promptGarmentPhase}
                        disabled={uploading}
                        rows={4}
                        onChange={(e) => setPromptGarmentPhase(e.target.value)}
                        style={{ fontSize: 12, fontFamily: 'var(--mono)', resize: 'vertical' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="modal-foot" style={{ position: 'relative', overflow: 'hidden' }}>
          {uploading && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: 'var(--border)',
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: 'var(--accent)',
                  width:
                    entries.length > 0
                      ? `${Math.round((doneCount / entries.length) * 100)}%`
                      : '0%',
                  transition: 'width 0.3s ease',
                  borderRadius: '0 2px 2px 0',
                }}
              />
            </div>
          )}
          <button className="btn ghost" onClick={onClose} disabled={uploading}>
            {allDone ? 'Close' : 'Cancel'}
          </button>
          {step === 2 && (
            <button className="btn primary" onClick={handleUpload} disabled={!canUpload}>
              <Icon.Upload />
              {uploading
                ? `Uploading ${doneCount + 1}/${entries.length}…`
                : `Upload ${pendingCount} pose${pendingCount !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
