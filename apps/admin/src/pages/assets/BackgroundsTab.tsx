import { useCallback, useEffect, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { BackgroundUploadModal } from '../../components/BackgroundUploadModal';
import { EditBackgroundModal } from '../../components/EditBackgroundModal';
import { Icon } from '../../components/Icons';
import { Switch } from '../../components/Switch';
import { apiFetch } from '../../lib/data';
import type { ModelBackground } from '../../types';
import { useAssetsContext } from './AssetsContext';

const GENDER_TABS = [
  { k: 'all' as const, l: 'All' },
  { k: 'men' as const, l: 'Men' },
  { k: 'women' as const, l: 'Women' },
  { k: 'boys' as const, l: 'Boys' },
  { k: 'girls' as const, l: 'Girls' },
];

export function BackgroundsTab() {
  const {
    genderFilter,
    setGenderFilter,
    setAllBackgrounds,
    loading,
    setLoading,
    storagePublicUrl,
    setPreviewUrl,
    toast,
  } = useAssetsContext();

  const [backgrounds, setBackgrounds] = useState<ModelBackground[]>([]);
  const [selectedBgIds, setSelectedBgIds] = useState<string[]>([]);
  const [confirmBulkDeleteBgIds, setConfirmBulkDeleteBgIds] = useState<string[]>([]);
  const [deleteBgConfirmText, setDeleteBgConfirmText] = useState('');
  const [showBgUpload, setShowBgUpload] = useState(false);
  const [editingBackground, setEditingBackground] = useState<ModelBackground | null>(null);
  const [confirmDeleteBg, setConfirmDeleteBg] = useState<ModelBackground | null>(null);

  const loadBackgrounds = useCallback(
    async (genderSlug?: string) => {
      setLoading(true);
      try {
        const qs = genderSlug ? `?genderSlug=${genderSlug}` : '';
        const res = await apiFetch<{ items: ModelBackground[] }>(`/admin/assets/backgrounds${qs}`);
        setBackgrounds(res.items);
        if (!genderSlug) setAllBackgrounds(res.items);
      } catch {
        toast({ kind: 'error', title: 'Failed to load backgrounds' });
      } finally {
        setLoading(false);
      }
    },
    [toast, setLoading, setAllBackgrounds],
  );

  useEffect(() => {
    void loadBackgrounds(genderFilter === 'all' ? undefined : genderFilter);
  }, [genderFilter, loadBackgrounds]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible')
        void loadBackgrounds(genderFilter === 'all' ? undefined : genderFilter);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [genderFilter, loadBackgrounds]);

  const toggleBg = async (id: string) => {
    const item = backgrounds.find((b) => b.id === id);
    if (!item) return;
    const next = !item.isActive;
    setBackgrounds((prev) => prev.map((b) => (b.id === id ? { ...b, isActive: next } : b)));
    try {
      await apiFetch(`/admin/assets/backgrounds/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      toast({ title: `${item.label} ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setBackgrounds((prev) =>
        prev.map((b) => (b.id === id ? { ...b, isActive: item.isActive } : b)),
      );
      toast({ kind: 'error', title: 'Failed to update background' });
    }
  };

  const setAmazonWhiteBg = async (id: string) => {
    const prev = backgrounds.find((b) => b.isWhiteBg);
    setBackgrounds((prevBg) => prevBg.map((b) => ({ ...b, isWhiteBg: b.id === id })));
    try {
      await apiFetch(`/admin/assets/backgrounds/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isWhiteBg: true }),
      });
      const item = backgrounds.find((b) => b.id === id);
      toast({ title: `${item?.label ?? 'Background'} set as Amazon white background` });
    } catch {
      setBackgrounds((prevBg) =>
        prevBg.map((b) => ({ ...b, isWhiteBg: prev != null && prev.id === b.id })),
      );
      toast({ kind: 'error', title: 'Failed to set Amazon white background' });
    }
  };

  const doBulkDeleteBackgrounds = async () => {
    if (deleteBgConfirmText !== 'move to recycle bin') return;
    const ids = confirmBulkDeleteBgIds;
    setConfirmBulkDeleteBgIds([]);
    setDeleteBgConfirmText('');
    if (ids.length === 0) return;
    try {
      const res = await apiFetch<{ deleted: number }>('/admin/assets/backgrounds', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      setBackgrounds((prev) => prev.filter((b) => !ids.includes(b.id)));
      setSelectedBgIds((prev) => prev.filter((id) => !ids.includes(id)));
      toast({
        title: `${res.deleted} background${res.deleted !== 1 ? 's' : ''} moved to recycle bin`,
      });
    } catch {
      toast({ kind: 'error', title: 'Bulk delete failed' });
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Backgrounds</h1>
          <p className="lede">Global backgrounds sent to ComfyUI for all garment types.</p>
        </div>
        <div className="head-tools">
          <button className="btn" onClick={() => setShowBgUpload(true)}>
            <Icon.Add /> Add background
          </button>
        </div>
      </div>

      <div className="tabs" style={{ marginTop: -8 }}>
        {GENDER_TABS.map((t) => (
          <button
            key={t.k}
            className={`tab ${genderFilter === t.k ? 'active' : ''}`}
            onClick={() => setGenderFilter(t.k)}
          >
            {t.l}
          </button>
        ))}
      </div>

      {!loading && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
              marginBottom: 8,
              flexWrap: 'wrap',
            }}
          >
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              {backgrounds.length} background{backgrounds.length !== 1 ? 's' : ''}
            </p>
            {backgrounds.length > 0 && (
              <button
                className="btn sm ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  const allSelected = backgrounds.every((b) => selectedBgIds.includes(b.id));
                  setSelectedBgIds(allSelected ? [] : backgrounds.map((b) => b.id));
                }}
              >
                {backgrounds.every((b) => selectedBgIds.includes(b.id))
                  ? 'Deselect all'
                  : 'Select all'}
              </button>
            )}
            {selectedBgIds.length > 0 && (
              <button
                className="btn sm danger"
                onClick={() => setConfirmBulkDeleteBgIds([...selectedBgIds])}
              >
                <Icon.Trash /> Move to recycle bin ({selectedBgIds.length})
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Label</th>
                  <th>Gender</th>
                  <th>Amazon</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {backgrounds.map((bg) => (
                  <tr key={bg.id} style={{ opacity: bg.isActive ? 1 : 0.6 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedBgIds.includes(bg.id)}
                        onChange={(e) =>
                          setSelectedBgIds((prev) =>
                            e.target.checked ? [...prev, bg.id] : prev.filter((id) => id !== bg.id),
                          )
                        }
                        style={{ accentColor: 'var(--pink)', cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <AssetThumb
                          thumbnailKey={bg.thumbnailKey}
                          r2Key={bg.r2Key}
                          label={bg.label}
                          w={40}
                          h={30}
                          storageBase={storagePublicUrl}
                          onPreview={setPreviewUrl}
                        />
                        <div>
                          <span className="semi">{bg.label}</span>
                          <span className="sub mono" style={{ display: 'block' }}>
                            {bg.id.slice(0, 8)}…
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge dot">{bg.genderSlug ?? 'all'}</span>
                    </td>
                    <td>
                      <button
                        className={`btn sm ${bg.isWhiteBg ? 'primary' : 'ghost'}`}
                        onClick={() => setAmazonWhiteBg(bg.id)}
                        title={
                          bg.isWhiteBg
                            ? 'Amazon white background (selected)'
                            : 'Set as Amazon white background'
                        }
                      >
                        {bg.isWhiteBg ? (
                          <>
                            <span style={{ color: 'var(--success)', marginRight: 4 }}>&#9733;</span>
                            White BG
                          </>
                        ) : (
                          'Set White BG'
                        )}
                      </button>
                    </td>
                    <td>
                      <Switch checked={bg.isActive} onChange={() => toggleBg(bg.id)} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn sm ghost" onClick={() => setEditingBackground(bg)}>
                          <Icon.Edit />
                        </button>
                        <button className="btn sm ghost" onClick={() => setConfirmDeleteBg(bg)}>
                          <Icon.Trash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {backgrounds.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                    >
                      No backgrounds yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Modals ── */}

      {confirmDeleteBg && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteBg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Move to recycle bin</h3>
            </div>
            <div className="modal-body">
              <p>
                Move <strong>{confirmDeleteBg.label}</strong> to the recycle bin? You can restore it
                later.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDeleteBg(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  const { id, label } = confirmDeleteBg;
                  setConfirmDeleteBg(null);
                  try {
                    await apiFetch(`/admin/assets/backgrounds/${id}`, { method: 'DELETE' });
                    setBackgrounds((prev) => prev.filter((b) => b.id !== id));
                    setAllBackgrounds((prev) => prev.filter((b) => b.id !== id));
                    toast({ title: `${label} moved to recycle bin` });
                  } catch {
                    toast({ kind: 'error', title: 'Failed to delete background' });
                  }
                }}
              >
                <Icon.Trash /> Move to recycle bin
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkDeleteBgIds.length > 0 && (
        <div
          className="modal-overlay"
          onClick={() => {
            setConfirmBulkDeleteBgIds([]);
            setDeleteBgConfirmText('');
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                Move {confirmBulkDeleteBgIds.length} background
                {confirmBulkDeleteBgIds.length !== 1 ? 's' : ''} to recycle bin
              </h3>
            </div>
            <div className="modal-body">
              <p>
                Move{' '}
                <strong>
                  {confirmBulkDeleteBgIds.length} selected background
                  {confirmBulkDeleteBgIds.length !== 1 ? 's' : ''}
                </strong>{' '}
                to the recycle bin? You can restore them later.
              </p>
              <div className="field" style={{ marginTop: 16 }}>
                <label style={{ fontSize: 13 }}>
                  Type{' '}
                  <strong style={{ fontFamily: 'monospace', color: 'var(--danger)' }}>
                    move to recycle bin
                  </strong>{' '}
                  to confirm
                </label>
                <input
                  className="input"
                  type="text"
                  value={deleteBgConfirmText}
                  onChange={(e) => setDeleteBgConfirmText(e.target.value)}
                  placeholder="move to recycle bin"
                />
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => {
                  setConfirmBulkDeleteBgIds([]);
                  setDeleteBgConfirmText('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={doBulkDeleteBackgrounds}
                disabled={deleteBgConfirmText !== 'move to recycle bin'}
              >
                <Icon.Trash /> Move to recycle bin ({confirmBulkDeleteBgIds.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {showBgUpload && (
        <BackgroundUploadModal
          defaultGenderSlug={genderFilter === 'all' ? '' : genderFilter}
          onDone={(row) => {
            setShowBgUpload(false);
            setBackgrounds((prev) => [...prev, row]);
            setAllBackgrounds((prev) => [...prev, row]);
          }}
          onClose={() => setShowBgUpload(false)}
          toast={toast}
        />
      )}

      {editingBackground && (
        <EditBackgroundModal
          background={editingBackground}
          storagePublicUrl={storagePublicUrl}
          onSaved={(updated) => {
            setBackgrounds((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
            setEditingBackground(null);
          }}
          onClose={() => setEditingBackground(null)}
          toast={toast}
        />
      )}
    </>
  );
}
