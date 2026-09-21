import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { SampleVideoEditDrawer } from '../components/SampleVideoEditDrawer';
import { type SampleVideo, SampleVideoUploadModal } from '../components/SampleVideoUploadModal';
import { Switch } from '../components/Switch';
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlStateMulti } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

// Formerly a tab inside AssetsPage (pages/assets/SampleVideosTab.tsx) — promoted
// to its own top-level nav item since Sample Videos is the only PixVerse-specific
// content type and doesn't share the rest of Assets' curated-content workflow.
export default function PixversePage({ toast }: Props) {
  const [items, setItems] = useState<SampleVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [{ modal: modalParam, editId }, setModalParams] = useUrlStateMulti(['modal', 'editId']);
  const closeModal = useCloseOverlay(['modal', 'editId']);
  const modalOpen = modalParam === 'upload-video';
  const editingItem =
    modalParam === 'edit-video' && editId ? (items.find((i) => i.id === editId) ?? null) : null;

  const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti([
    'confirm',
    'confirmId',
  ]);
  const closeConfirm = useCloseOverlay(['confirm', 'confirmId']);
  const confirmDeleteId = confirmParam === 'delete-video' ? confirmId : null;

  useCrumb(
    0,
    confirmDeleteId
      ? {
          label: 'Delete sample video',
          href: `/pixverse?confirm=delete-video&confirmId=${encodeURIComponent(confirmDeleteId)}`,
        }
      : null,
  );
  useCrumb(
    1,
    modalParam
      ? {
          label: modalParam === 'upload-video' ? 'Add sample video' : 'Edit sample video',
          href: `/pixverse?modal=${modalParam}${editId ? `&editId=${encodeURIComponent(editId)}` : ''}`,
        }
      : null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await apiFetch<{ items: SampleVideo[] }>('/admin/assets/sample-videos')).items);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load sample videos',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (item: SampleVideo) => {
    const isActive = !item.isActive;
    setItems((v) => v.map((x) => (x.id === item.id ? { ...x, isActive } : x)));
    try {
      await apiFetch(`/admin/assets/sample-videos/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      });
    } catch (e) {
      setItems((v) => v.map((x) => (x.id === item.id ? item : x)));
      toast({
        kind: 'error',
        title: 'Failed to update',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  const doDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    closeConfirm();
    try {
      await apiFetch(`/admin/assets/sample-videos/${id}`, { method: 'DELETE' });
      setItems((v) => v.filter((x) => x.id !== id));
      toast({ title: 'Sample video deleted' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to delete',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sample Videos</h1>
          <p className="lede">
            Motion templates offered in the Catalog Video wizard — the reference clip a user's
            catalogue image is animated to match.
          </p>
        </div>
        <div className="head-tools">
          <button
            className="btn"
            onClick={() => setModalParams({ modal: 'upload-video', editId: null })}
          >
            <Icon.Add /> Add sample video
          </button>
        </div>
      </div>

      {!loading &&
        (items.length === 0 ? (
          <p style={{ color: 'var(--muted)', marginTop: 24 }}>No sample videos yet.</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            {items.map((item) => (
              <div
                key={item.id}
                className="card"
                style={{ padding: 0, overflow: 'hidden', opacity: item.isActive ? 1 : 0.55 }}
              >
                {/* biome-ignore lint/a11y/useMediaCaption: silent garment-preview clip, no dialogue/narration */}
                <video
                  src={item.videoUrl}
                  poster={item.thumbnailUrl}
                  controls
                  style={{
                    width: '100%',
                    aspectRatio: '9 / 16',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
                <div style={{ padding: '8px 10px 10px' }}>
                  <p
                    className="semi"
                    style={{
                      fontSize: 12,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={item.title}
                  >
                    {item.title}
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      margin: '2px 0 0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={item.prompt}
                  >
                    {item.prompt}
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      margin: '2px 0 0',
                    }}
                  >
                    {item.duration}s · {item.quality}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 8,
                    }}
                  >
                    <Switch checked={item.isActive} onChange={() => void toggle(item)} />
                    <button
                      className="btn sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => setModalParams({ modal: 'edit-video', editId: item.id })}
                    >
                      <Icon.Edit /> Edit
                    </button>
                    <button
                      className="btn sm danger"
                      onClick={() =>
                        setConfirmParams({ confirm: 'delete-video', confirmId: item.id })
                      }
                    >
                      <Icon.Trash /> Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}

      {confirmDeleteId && (
        <div className="modal-overlay" onClick={closeConfirm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete sample video</h3>
            </div>
            <div className="modal-body">
              <p>Delete this sample video? It will no longer appear in the Catalog Video wizard.</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={closeConfirm}>
                Cancel
              </button>
              <button className="btn danger" onClick={doDelete}>
                <Icon.Trash /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <SampleVideoUploadModal
          toast={toast}
          onClose={closeModal}
          onDone={(created) => {
            setItems((v) => [...v, created]);
            closeModal();
          }}
        />
      )}

      {editingItem && (
        <SampleVideoEditDrawer
          item={editingItem}
          toast={toast}
          onClose={closeModal}
          onSaved={(updated) => {
            setItems((v) => v.map((x) => (x.id === editingItem.id ? { ...x, ...updated } : x)));
            closeModal();
          }}
        />
      )}
    </>
  );
}
