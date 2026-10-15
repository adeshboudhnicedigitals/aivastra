import { useCallback, useEffect, useMemo, useState } from 'react';
import { EditBodyTypeModal } from '../../components/EditBodyTypeModal';
import { Icon } from '../../components/Icons';
import { Switch } from '../../components/Switch';
import { useCrumb } from '../../context/BreadcrumbContext';
import { useCloseOverlay } from '../../hooks/use-close-overlay';
import { useUrlStateMulti } from '../../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import type { BodyType } from '../../types';
import { useAssetsContext } from './AssetsContext';
import { BodyTypeDetailView } from './BodyTypeDetailView';

const GENDER_TABS = [
  { k: 'all' as const, l: 'All' },
  { k: 'men' as const, l: 'Men' },
  { k: 'women' as const, l: 'Women' },
  { k: 'boys' as const, l: 'Boys' },
  { k: 'girls' as const, l: 'Girls' },
];

export function BodyTypesTab() {
  const { genderFilter, setGenderFilter, loading, setLoading, toast } = useAssetsContext();

  const [bodyTypes, setBodyTypes] = useState<BodyType[]>([]);

  const tabHref = '/assets?tab=body-types';
  const [{ view: viewParam, bodyTypeId }, setViewParams] = useUrlStateMulti(['view', 'bodyTypeId']);
  const bodyTypeView: { kind: 'list' } | { kind: 'detail'; bodyType: BodyType } = useMemo(() => {
    if (viewParam === 'detail' && bodyTypeId) {
      const found = bodyTypes.find((t) => t.id === bodyTypeId);
      if (found) return { kind: 'detail', bodyType: found };
    }
    return { kind: 'list' };
  }, [viewParam, bodyTypeId, bodyTypes]);
  const openDetail = useCallback(
    (t: BodyType) => setViewParams({ view: 'detail', bodyTypeId: t.id }),
    [setViewParams],
  );
  const closeDetail = useCloseOverlay(['view', 'bodyTypeId']);

  const [{ modal: modalParam, editId }, setModalParams] = useUrlStateMulti(['modal', 'editId']);
  const closeModal = useCloseOverlay(['modal', 'editId']);
  const editingBodyType: BodyType | null | 'new' =
    modalParam === 'new-body-type'
      ? 'new'
      : modalParam === 'edit-body-type' && editId
        ? (bodyTypes.find((t) => t.id === editId) ?? null)
        : null;

  const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti([
    'confirm',
    'confirmId',
  ]);
  const closeConfirm = useCloseOverlay(['confirm', 'confirmId']);
  const confirmDeleteId = confirmParam === 'delete-body-type' ? confirmId : null;

  useCrumb(0, { label: 'Body Types', href: tabHref });
  useCrumb(
    1,
    bodyTypeView.kind === 'detail'
      ? {
          label: bodyTypeView.bodyType.label,
          href: `${tabHref}&view=detail&bodyTypeId=${encodeURIComponent(bodyTypeView.bodyType.id)}`,
        }
      : modalParam === 'new-body-type'
        ? { label: 'New body type', href: `${tabHref}&modal=new-body-type` }
        : editingBodyType && editingBodyType !== 'new'
          ? {
              label: 'Edit body type',
              href: `${tabHref}&modal=edit-body-type&editId=${encodeURIComponent(editingBodyType.id)}`,
            }
          : null,
  );
  useCrumb(
    2,
    bodyTypeView.kind === 'detail' && editingBodyType && editingBodyType !== 'new'
      ? {
          label: 'Edit body type',
          href: `${tabHref}&modal=edit-body-type&editId=${encodeURIComponent(editingBodyType.id)}`,
        }
      : null,
  );
  useCrumb(
    3,
    confirmDeleteId
      ? {
          label: 'Delete body type',
          href: `${tabHref}&confirm=delete-body-type&confirmId=${encodeURIComponent(confirmDeleteId)}`,
        }
      : null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: BodyType[] }>('/admin/assets/body-types');
      setBodyTypes(res.items);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load body types',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast, setLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (t: BodyType) => {
    const next = !t.isActive;
    setBodyTypes((prev) => prev.map((x) => (x.id === t.id ? { ...x, isActive: next } : x)));
    try {
      await apiFetch(`/admin/assets/body-types/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch (e) {
      setBodyTypes((prev) => prev.map((x) => (x.id === t.id ? { ...x, isActive: t.isActive } : x)));
      toast({
        kind: 'error',
        title: 'Failed to update body type',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  const doDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    closeConfirm();
    try {
      await apiFetch(`/admin/assets/body-types/${id}`, { method: 'DELETE' });
      setBodyTypes((prev) => prev.filter((t) => t.id !== id));
      toast({ title: 'Body type deleted' });
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', body: (e as Error).message });
    }
  };

  const filtered = bodyTypes.filter((t) => genderFilter === 'all' || t.genderSlug === genderFilter);

  return (
    <>
      <div className="page-head">
        <div>
          {bodyTypeView.kind === 'detail' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                fontSize: 13,
                color: 'var(--muted)',
              }}
            >
              <button
                className="btn sm ghost"
                onClick={closeDetail}
                style={{ padding: '2px 8px', fontSize: 13 }}
              >
                Body Types
              </button>
              <Icon.Chevron />
              <span>{bodyTypeView.bodyType.label}</span>
            </div>
          )}
          <h1>{bodyTypeView.kind === 'detail' ? bodyTypeView.bodyType.label : 'Body Types'}</h1>
          <p className="lede">
            {bodyTypeView.kind === 'detail'
              ? `${bodyTypeView.bodyType.genderSlug} · upload the faces and poses this body type should show in the studio wizard.`
              : 'Admin-curated body-type categories. Click one to upload the faces and poses it should show in the studio wizard — a body type with no explicit mappings for a given asset kind shows every active one of that gender.'}
          </p>
        </div>
        <div className="head-tools">
          {bodyTypeView.kind === 'list' ? (
            <button
              className="btn ghost"
              onClick={() => setModalParams({ modal: 'new-body-type', editId: null })}
            >
              <Icon.Add /> New body type
            </button>
          ) : (
            <button
              className="btn ghost"
              onClick={() =>
                setModalParams({ modal: 'edit-body-type', editId: bodyTypeView.bodyType.id })
              }
            >
              <Icon.Edit /> Edit basic info
            </button>
          )}
        </div>
      </div>

      {bodyTypeView.kind === 'list' && (
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
      )}

      {bodyTypeView.kind === 'detail' && <BodyTypeDetailView bodyType={bodyTypeView.bodyType} />}

      {bodyTypeView.kind === 'list' &&
        !loading &&
        (filtered.length === 0 ? (
          <p style={{ color: 'var(--muted)', marginTop: 24 }}>No body types for this gender.</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            {filtered.map((t) => (
              <div
                key={t.id}
                className="card"
                onClick={() => openDetail(t)}
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  opacity: t.isActive ? 1 : 0.55,
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    background: 'var(--surface2, #1a1a1a)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    aspectRatio: '3/4',
                  }}
                >
                  {t.thumbnailUrl ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={t.thumbnailUrl}
                      alt={t.label}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Icon.Image />
                  )}
                </div>
                <div style={{ padding: '8px 8px 10px' }}>
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={t.label}
                  >
                    {t.label}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
                    {t.genderSlug}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 8,
                    }}
                  >
                    <span onClick={(e) => e.stopPropagation()}>
                      <Switch checked={t.isActive} onChange={() => void toggleActive(t)} />
                    </span>
                    <button
                      className="btn ghost"
                      style={{ fontSize: 10, padding: '3px 8px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setModalParams({ modal: 'edit-body-type', editId: t.id });
                      }}
                    >
                      <Icon.Edit /> Edit
                    </button>
                  </div>
                  <button
                    className="btn danger"
                    style={{ width: '100%', marginTop: 4, fontSize: 11, padding: '3px 0' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmParams({ confirm: 'delete-body-type', confirmId: t.id });
                    }}
                  >
                    <Icon.Trash /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}

      {confirmDeleteId && (
        <div className="modal-overlay" onClick={closeConfirm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete body type</h3>
            </div>
            <div className="modal-body">
              <p>Delete this body type? Studio users will no longer see it.</p>
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

      {editingBodyType !== null && (
        <EditBodyTypeModal
          bodyType={editingBodyType === 'new' ? null : editingBodyType}
          defaultGenderSlug={genderFilter === 'all' ? 'men' : genderFilter}
          onSaved={() => void load()}
          onClose={closeModal}
          toast={toast}
        />
      )}
    </>
  );
}
