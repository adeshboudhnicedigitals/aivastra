import { useCallback, useEffect, useMemo, useState } from 'react';
import { EditBlouseCategoryModal } from '../../components/EditBlouseCategoryModal';
import { Icon } from '../../components/Icons';
import { Switch } from '../../components/Switch';
import { useCrumb } from '../../context/BreadcrumbContext';
import { useCloseOverlay } from '../../hooks/use-close-overlay';
import { useUrlStateMulti } from '../../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import type { BlouseCategory } from '../../types';
import { useAssetsContext } from './AssetsContext';
import { BlouseCategoryDetailView } from './BlouseCategoryDetailView';

const GENDER_TABS = [
  { k: 'all' as const, l: 'All' },
  { k: 'men' as const, l: 'Men' },
  { k: 'women' as const, l: 'Women' },
  { k: 'boys' as const, l: 'Boys' },
  { k: 'girls' as const, l: 'Girls' },
];

export function BlouseCategoriesTab() {
  const { genderFilter, setGenderFilter, loading, setLoading, toast } = useAssetsContext();

  const [categories, setCategories] = useState<BlouseCategory[]>([]);

  const tabHref = '/assets?tab=blouse-categories';
  const [{ view: viewParam, categoryId }, setViewParams] = useUrlStateMulti(['view', 'categoryId']);
  const categoryView: { kind: 'list' } | { kind: 'detail'; category: BlouseCategory } =
    useMemo(() => {
      if (viewParam === 'detail' && categoryId) {
        const found = categories.find((c) => c.id === categoryId);
        if (found) return { kind: 'detail', category: found };
      }
      return { kind: 'list' };
    }, [viewParam, categoryId, categories]);
  const openDetail = useCallback(
    (c: BlouseCategory) => setViewParams({ view: 'detail', categoryId: c.id }),
    [setViewParams],
  );
  const closeDetail = useCloseOverlay(['view', 'categoryId']);

  const [{ modal: modalParam, editId }, setModalParams] = useUrlStateMulti(['modal', 'editId']);
  const closeModal = useCloseOverlay(['modal', 'editId']);
  const editingCategory: BlouseCategory | null | 'new' =
    modalParam === 'new-blouse-category'
      ? 'new'
      : modalParam === 'edit-blouse-category' && editId
        ? (categories.find((c) => c.id === editId) ?? null)
        : null;

  const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti([
    'confirm',
    'confirmId',
  ]);
  const closeConfirm = useCloseOverlay(['confirm', 'confirmId']);
  const confirmDeleteId = confirmParam === 'delete-blouse-category' ? confirmId : null;

  useCrumb(0, { label: 'Blouse', href: tabHref });
  useCrumb(
    1,
    categoryView.kind === 'detail'
      ? {
          label: categoryView.category.label,
          href: `${tabHref}&view=detail&categoryId=${encodeURIComponent(categoryView.category.id)}`,
        }
      : modalParam === 'new-blouse-category'
        ? { label: 'New blouse category', href: `${tabHref}&modal=new-blouse-category` }
        : editingCategory && editingCategory !== 'new'
          ? {
              label: 'Edit blouse category',
              href: `${tabHref}&modal=edit-blouse-category&editId=${encodeURIComponent(editingCategory.id)}`,
            }
          : null,
  );
  useCrumb(
    2,
    categoryView.kind === 'detail' && editingCategory && editingCategory !== 'new'
      ? {
          label: 'Edit blouse category',
          href: `${tabHref}&modal=edit-blouse-category&editId=${encodeURIComponent(editingCategory.id)}`,
        }
      : null,
  );
  useCrumb(
    3,
    confirmDeleteId
      ? {
          label: 'Delete blouse category',
          href: `${tabHref}&confirm=delete-blouse-category&confirmId=${encodeURIComponent(confirmDeleteId)}`,
        }
      : null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: BlouseCategory[] }>('/admin/assets/blouse-categories');
      setCategories(res.items);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load blouse categories',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast, setLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (c: BlouseCategory) => {
    const next = !c.isActive;
    setCategories((prev) => prev.map((x) => (x.id === c.id ? { ...x, isActive: next } : x)));
    try {
      await apiFetch(`/admin/assets/blouse-categories/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch (e) {
      setCategories((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, isActive: c.isActive } : x)),
      );
      toast({
        kind: 'error',
        title: 'Failed to update blouse category',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  const doDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    closeConfirm();
    try {
      await apiFetch(`/admin/assets/blouse-categories/${id}`, { method: 'DELETE' });
      setCategories((prev) => prev.filter((c) => c.id !== id));
      toast({ title: 'Blouse category deleted' });
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', body: (e as Error).message });
    }
  };

  const filtered = categories.filter(
    (c) => genderFilter === 'all' || c.genderSlug === null || c.genderSlug === genderFilter,
  );

  return (
    <>
      <div className="page-head">
        <div>
          {categoryView.kind === 'detail' && (
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
                Blouse
              </button>
              <Icon.Chevron />
              <span>{categoryView.category.label}</span>
            </div>
          )}
          <h1>{categoryView.kind === 'detail' ? categoryView.category.label : 'Blouse'}</h1>
          <p className="lede">
            {categoryView.kind === 'detail'
              ? `${categoryView.category.genderSlug ?? 'all genders'} · upload the blouse poses this category should offer in the studio wizard.`
              : 'Admin-curated blouse categories. Click one to upload its poses, then map the whole category to a garment type (e.g. Saree) from that garment type’s edit view.'}
          </p>
        </div>
        <div className="head-tools">
          {categoryView.kind === 'list' ? (
            <button
              className="btn ghost"
              onClick={() => setModalParams({ modal: 'new-blouse-category', editId: null })}
            >
              <Icon.Add /> New blouse category
            </button>
          ) : (
            <button
              className="btn ghost"
              onClick={() =>
                setModalParams({ modal: 'edit-blouse-category', editId: categoryView.category.id })
              }
            >
              <Icon.Edit /> Edit basic info
            </button>
          )}
        </div>
      </div>

      {categoryView.kind === 'list' && (
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

      {categoryView.kind === 'detail' && (
        <BlouseCategoryDetailView category={categoryView.category} />
      )}

      {categoryView.kind === 'list' &&
        !loading &&
        (filtered.length === 0 ? (
          <p style={{ color: 'var(--muted)', marginTop: 24 }}>
            No blouse categories for this gender.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            {filtered.map((c) => (
              <div
                key={c.id}
                className="card"
                onClick={() => openDetail(c)}
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  opacity: c.isActive ? 1 : 0.55,
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
                  {c.thumbnailUrl ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={c.thumbnailUrl}
                      alt={c.label}
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
                    title={c.label}
                  >
                    {c.label}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
                    {c.genderSlug ?? 'all genders'} · {c.poseCount} pose
                    {c.poseCount !== 1 ? 's' : ''}
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
                      <Switch checked={c.isActive} onChange={() => void toggleActive(c)} />
                    </span>
                    <button
                      className="btn ghost"
                      style={{ fontSize: 10, padding: '3px 8px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setModalParams({ modal: 'edit-blouse-category', editId: c.id });
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
                      setConfirmParams({ confirm: 'delete-blouse-category', confirmId: c.id });
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
              <h3>Delete blouse category</h3>
            </div>
            <div className="modal-body">
              <p>
                Delete this blouse category? Its poses and garment-type mappings are removed too,
                and studio users will no longer see it.
              </p>
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

      {editingCategory !== null && (
        <EditBlouseCategoryModal
          category={editingCategory === 'new' ? null : editingCategory}
          defaultGenderSlug={genderFilter}
          onSaved={(c) => {
            setCategories((prev) =>
              prev.some((x) => x.id === c.id)
                ? prev.map((x) => (x.id === c.id ? c : x))
                : [...prev, c],
            );
          }}
          onClose={closeModal}
          toast={toast}
        />
      )}
    </>
  );
}
