import { useCallback, useEffect, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { BatchBlousePoseUploadModal } from '../../components/BatchBlousePoseUploadModal';
import { Icon } from '../../components/Icons';
import { Switch } from '../../components/Switch';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import type { BlouseCategory, BlousePose } from '../../types';
import { useAssetsContext } from './AssetsContext';

export function BlouseCategoryDetailView({ category }: { category: BlouseCategory }) {
  const { toast, setPreviewUrl } = useAssetsContext();

  const [poses, setPoses] = useState<BlousePose[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editSortOrder, setEditSortOrder] = useState(0);
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: BlousePose[] }>(
        `/admin/assets/blouse-categories/${category.id}/poses`,
      );
      setPoses(res.items);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load poses',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [category.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (p: BlousePose) => {
    const next = !p.isActive;
    setPoses((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: next } : x)));
    try {
      await apiFetch(`/admin/assets/blouse-poses/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch (e) {
      setPoses((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: p.isActive } : x)));
      toast({
        kind: 'error',
        title: 'Failed to update pose',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  const doDelete = async (p: BlousePose) => {
    try {
      await apiFetch(`/admin/assets/blouse-poses/${p.id}`, { method: 'DELETE' });
      setPoses((prev) => prev.filter((x) => x.id !== p.id));
      toast({ title: 'Pose deleted' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Delete failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  const startEdit = (p: BlousePose) => {
    setEditingId(p.id);
    setEditLabel(p.label);
    setEditSortOrder(p.sortOrder);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSavingEdit(true);
    try {
      await apiFetch(`/admin/assets/blouse-poses/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ label: editLabel, sortOrder: editSortOrder }),
      });
      setPoses((prev) =>
        prev.map((x) =>
          x.id === editingId ? { ...x, label: editLabel, sortOrder: editSortOrder } : x,
        ),
      );
      setEditingId(null);
      toast({ title: 'Pose updated' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update pose',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const sorted = [...poses].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
          {poses.length} pose{poses.length !== 1 ? 's' : ''} in this category. Each one shows as a
          selectable blouse design in the studio wizard once the category is mapped to a garment
          type.
        </p>
        <button type="button" className="btn" onClick={() => setShowUpload(true)}>
          <Icon.Add /> Upload poses
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading poses…</p>
      ) : sorted.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No poses yet. Click "Upload poses" to add some.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          {sorted.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{
                padding: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                opacity: p.isActive ? 1 : 0.55,
              }}
            >
              <div
                style={{
                  background: 'var(--surface2, #1a1a1a)',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  aspectRatio: '3/4',
                  cursor: 'pointer',
                }}
                onClick={() => p.r2Url && setPreviewUrl(p.r2Url)}
              >
                <AssetThumb
                  thumbnailUrl={p.thumbnailUrl}
                  fullUrl={p.r2Url}
                  label={p.label}
                  w={160}
                  h={210}
                />
              </div>
              <div style={{ padding: '8px 8px 10px' }}>
                {editingId === p.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      className="input"
                      value={editLabel}
                      disabled={savingEdit}
                      onChange={(e) => setEditLabel(e.target.value)}
                      style={{ fontSize: 12, padding: '3px 6px' }}
                    />
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={editSortOrder}
                      disabled={savingEdit}
                      onChange={(e) => setEditSortOrder(Number(e.target.value))}
                      style={{ fontSize: 12, padding: '3px 6px' }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={savingEdit || !editLabel.trim()}
                        onClick={() => void saveEdit()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        disabled={savingEdit}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={p.label}
                    >
                      {p.label}
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: 8,
                      }}
                    >
                      <Switch checked={p.isActive} onChange={() => void toggleActive(p)} />
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ fontSize: 10, padding: '3px 8px' }}
                        onClick={() => startEdit(p)}
                      >
                        <Icon.Edit /> Edit
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn danger"
                      style={{ width: '100%', marginTop: 4, fontSize: 11, padding: '3px 0' }}
                      onClick={() => void doDelete(p)}
                    >
                      <Icon.Trash /> Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <BatchBlousePoseUploadModal
          categoryId={category.id}
          onDone={(added) => {
            setPoses((prev) => [...prev, ...added]);
            setShowUpload(false);
          }}
          onClose={() => setShowUpload(false)}
          toast={toast}
        />
      )}
    </div>
  );
}
