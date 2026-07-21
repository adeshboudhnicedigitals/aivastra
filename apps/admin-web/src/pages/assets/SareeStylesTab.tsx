import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { Icon } from '../../components/Icons';
import { SearchableSelect } from '../../components/SearchableSelect';
import { Switch } from '../../components/Switch';
import {
  apiErrorMessage,
  apiFetch,
  UPLOAD_NETWORK_ERROR,
  uploadErrorMessage,
} from '../../lib/data';
import type { SareeMannequinStyle, WorkflowOption } from '../../types';
import { useAssetsContext } from './AssetsContext';

interface PresignResult {
  r2Key: string;
  uploadUrl: string;
}

function putFile(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(uploadErrorMessage(xhr.status)));
    xhr.onerror = () => reject(new Error(UPLOAD_NETWORK_ERROR));
    xhr.send(file);
  });
}

function StyleModal({
  existing,
  workflows,
  storagePublicUrl,
  onSaved,
  onClose,
  toast,
}: {
  existing: SareeMannequinStyle | null;
  workflows: WorkflowOption[];
  storagePublicUrl: string | null;
  onSaved: (style: SareeMannequinStyle) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [workflowTemplateId, setWorkflowTemplateId] = useState(
    existing?.mannequinWorkflowTemplateId ?? workflows[0]?.id ?? '',
  );
  const [sortOrder, setSortOrder] = useState(existing?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const save = async () => {
    if (!label.trim() || !workflowTemplateId) return;
    setSaving(true);
    try {
      let previewImageKey = existing?.previewImageKey ?? undefined;
      if (file) {
        const presign = await apiFetch<PresignResult>('/admin/assets/saree-styles/presign', {
          method: 'POST',
          body: JSON.stringify({ contentType: file.type }),
        });
        await putFile(presign.uploadUrl, file);
        previewImageKey = presign.r2Key;
      }
      const body = {
        label: label.trim(),
        previewImageKey,
        mannequinWorkflowTemplateId: workflowTemplateId,
        sortOrder,
        isActive,
      };
      const saved = existing
        ? await apiFetch<SareeMannequinStyle>(`/admin/assets/saree-styles/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : await apiFetch<SareeMannequinStyle>('/admin/assets/saree-styles', {
            method: 'POST',
            body: JSON.stringify(body),
          });
      toast({ title: existing ? 'Style updated' : 'Style created' });
      onSaved(saved);
      onClose();
    } catch (e) {
      toast({
        kind: 'error',
        title: existing ? 'Failed to update style' : 'Failed to create style',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>{existing ? 'Edit style' : 'New saree style'}</h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            Label
            <input
              className="input"
              value={label}
              disabled={saving}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Style 1"
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {previewUrl ? (
              // biome-ignore lint/performance/noImgElement: admin panel
              <img
                src={previewUrl}
                alt=""
                style={{ width: 72, height: 92, objectFit: 'cover', borderRadius: 8 }}
              />
            ) : (
              <AssetThumb
                thumbnailKey={existing?.previewImageKey ?? undefined}
                r2Key={existing?.previewImageKey ?? undefined}
                label={label || 'Style'}
                storageBase={storagePublicUrl}
                w={72}
                h={92}
              />
            )}
            <button
              type="button"
              className="btn sm"
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon.Upload /> {existing?.previewImageKey || file ? 'Replace image' : 'Upload image'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            Mannequin workflow
            <SearchableSelect
              options={workflows.map((workflow) => ({ id: workflow.id, label: workflow.label }))}
              value={workflowTemplateId}
              disabled={saving}
              onChange={setWorkflowTemplateId}
              placeholder="— search workflow —"
            />
          </label>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              Sort order
              <input
                type="number"
                className="input"
                style={{ width: 90 }}
                value={sortOrder}
                disabled={saving}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              Active
              <Switch checked={isActive} onChange={setIsActive} />
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={saving || !label.trim() || !workflowTemplateId}
            onClick={save}
          >
            {saving ? 'Saving…' : existing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SareeStylesTab() {
  const { storagePublicUrl, toast } = useAssetsContext();
  const [styles, setStyles] = useState<SareeMannequinStyle[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SareeMannequinStyle | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stylesRes, workflowResponse] = await Promise.all([
        apiFetch<{ items: SareeMannequinStyle[] }>('/admin/assets/saree-styles'),
        apiFetch<WorkflowOption[]>('/admin/workflows'),
      ]);
      setStyles(stylesRes.items);
      setWorkflows(
        workflowResponse.filter(
          (workflow) => workflow.workflowType === 'saree_step1' && workflow.isActive,
        ),
      );
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load saree styles',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (style: SareeMannequinStyle) => {
    const next = !style.isActive;
    setStyles((previous) =>
      previous.map((candidate) =>
        candidate.id === style.id ? { ...candidate, isActive: next } : candidate,
      ),
    );
    try {
      await apiFetch(`/admin/assets/saree-styles/${style.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch (e) {
      setStyles((previous) =>
        previous.map((candidate) => (candidate.id === style.id ? style : candidate)),
      );
      toast({
        kind: 'error',
        title: 'Failed to update style',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Saree Mannequin Styles</h1>
          <p className="lede">
            Draping styles the merchant catalogue app lets merchants pick before generating — each
            one runs a different mannequin (step-1) workflow.
          </p>
        </div>
        <div className="head-tools">
          <button
            className="btn"
            onClick={() => {
              setEditing(null);
              setShowModal(true);
            }}
          >
            <Icon.Add /> New style
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', marginTop: 24 }}>Loading…</p>
      ) : styles.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: 24 }}>No saree styles yet.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
            marginTop: 12,
          }}
        >
          {styles.map((style) => (
            <div
              key={style.id}
              className="card"
              style={{ padding: 12, opacity: style.isActive ? 1 : 0.55 }}
            >
              <AssetThumb
                thumbnailKey={style.previewImageKey ?? undefined}
                r2Key={style.previewImageKey ?? undefined}
                label={style.label}
                storageBase={storagePublicUrl}
                w={160}
                h={200}
              />
              <p style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>{style.label}</p>
              <p style={{ fontSize: 10, color: 'var(--muted)' }}>
                {workflows.find((workflow) => workflow.id === style.mannequinWorkflowTemplateId)
                  ?.label ?? '—'}
              </p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 8,
                }}
              >
                <Switch checked={style.isActive} onChange={() => void toggleActive(style)} />
                <button
                  className="btn ghost"
                  style={{ fontSize: 10, padding: '3px 8px' }}
                  onClick={() => {
                    setEditing(style);
                    setShowModal(true);
                  }}
                >
                  <Icon.Edit /> Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <StyleModal
          existing={editing}
          workflows={workflows}
          storagePublicUrl={storagePublicUrl}
          onSaved={(saved) => {
            setStyles((previous) => {
              const exists = previous.some((style) => style.id === saved.id);
              return exists
                ? previous.map((style) => (style.id === saved.id ? saved : style))
                : [...previous, saved];
            });
          }}
          onClose={() => setShowModal(false)}
          toast={toast}
        />
      )}
    </>
  );
}
