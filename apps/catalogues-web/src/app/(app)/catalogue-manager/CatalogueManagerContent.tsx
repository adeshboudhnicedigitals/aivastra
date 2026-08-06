'use client';

import type {
  MerchantCatalogCategory as Category,
  MerchantCatalogItem,
  MerchantCatalogListResponse,
  MerchantCatalogSubcategory,
  MerchantCatalogSubcategoryListResponse,
} from '@aivastra/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ArrowLeft, GarmentIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GradBtn } from '@/components/ui/grad-btn';
import { api } from '@/lib/api';
import { reconcileHeldProducts } from './api';
import { BulkUploadModal } from './BulkUploadModal';
import { ProductModal } from './ProductModal';
import { SubcategoryModal } from './SubcategoryModal';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'men', label: 'Men' },
  { id: 'women', label: 'Women' },
  { id: 'boys', label: 'Boys' },
  { id: 'girls', label: 'Girls' },
];

// "not a merchant account" / "merchant account inactive" — thrown by requireMerchant
// (apps/api/src/plugins/portal-auth.ts) when the logged-in user has no merchants row.
function isMerchantGateError(err: unknown): boolean {
  return err instanceof Error && /merchant account/i.test(err.message);
}

export function CatalogueManagerContent() {
  const qc = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<Category>('men');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);

  // Modals state
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<MerchantCatalogSubcategory | undefined>(undefined);
  const [deleteSub, setDeleteSub] = useState<MerchantCatalogSubcategory | undefined>(undefined);

  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<MerchantCatalogItem | undefined>(undefined);
  const [deleteProd, setDeleteProd] = useState<MerchantCatalogItem | undefined>(undefined);

  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [reconcileFailedCount, setReconcileFailedCount] = useState(0);

  const subcategoriesQuery = useQuery({
    queryKey: ['merchant-catalog-subcategories'],
    queryFn: () =>
      api.get<MerchantCatalogSubcategoryListResponse>(
        '/v1/merchant/catalog/subcategories?includeDemo=false',
      ),
  });
  const subcategories = subcategoriesQuery.data?.items ?? [];

  const garmentTypesQuery = useQuery({
    queryKey: ['garment-types', selectedCategory],
    queryFn: () =>
      api.get<{ items: { id: string; label: string }[] }>(
        `/v1/models/garment-types?gender=${selectedCategory}`,
      ),
    enabled: !isMerchantGateError(subcategoriesQuery.error),
  });
  const garmentTypes = garmentTypesQuery.data?.items ?? [];

  const productsQuery = useQuery({
    queryKey: ['merchant-catalog-products', selectedSubcategoryId],
    queryFn: () =>
      api.get<MerchantCatalogListResponse>(
        `/v1/merchant/catalog?includeDemo=false&subcategoryId=${selectedSubcategoryId}`,
      ),
    enabled: !!selectedSubcategoryId,
  });
  const products = productsQuery.data?.items ?? [];

  // Pull in any held batches that finished while the merchant was away. This
  // is merchant-wide (not scoped to selectedSubcategoryId), so it runs once
  // on mount rather than per-subcategory selection.
  useEffect(() => {
    let cancelled = false;
    void reconcileHeldProducts().then(({ created, failed }) => {
      if (cancelled) return;
      if (created.length > 0) {
        qc.invalidateQueries({ queryKey: ['merchant-catalog-products'] });
        qc.invalidateQueries({ queryKey: ['merchant-catalog-subcategories'] });
      }
      // failed === -1 means the reconcile request itself never completed (network
      // error, 5xx, session expiry) — distinct from failed > 0, a partial failure
      // the server already logged. See reconcileHeldProducts' doc comment.
      setReconcileFailedCount(failed);
    });
    return () => {
      cancelled = true;
    };
  }, [qc]);

  const invalidateSubcategories = () =>
    qc.invalidateQueries({ queryKey: ['merchant-catalog-subcategories'] });
  const invalidateProducts = () =>
    qc.invalidateQueries({ queryKey: ['merchant-catalog-products', selectedSubcategoryId] });

  const createSubMutation = useMutation({
    mutationFn: (vars: { name: string; garmentSubcategoryId: string }) =>
      api.post<MerchantCatalogSubcategory>('/v1/merchant/catalog/subcategories', {
        category: selectedCategory,
        name: vars.name,
        garmentSubcategoryId: vars.garmentSubcategoryId,
      }),
    onSuccess: () => {
      invalidateSubcategories();
      setSubModalOpen(false);
      setEditingSub(undefined);
    },
  });

  const updateSubMutation = useMutation({
    mutationFn: (vars: { id: string; name: string; garmentSubcategoryId: string }) =>
      api.patch<MerchantCatalogSubcategory>(`/v1/merchant/catalog/subcategories/${vars.id}`, {
        name: vars.name,
        garmentSubcategoryId: vars.garmentSubcategoryId,
      }),
    onSuccess: () => {
      invalidateSubcategories();
      setSubModalOpen(false);
      setEditingSub(undefined);
    },
  });

  const deleteSubMutation = useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/merchant/catalog/subcategories/${id}`),
    onSuccess: (_data, id) => {
      invalidateSubcategories();
      if (selectedSubcategoryId === id) setSelectedSubcategoryId(null);
      setDeleteSub(undefined);
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/merchant/catalog/${id}`),
    onSuccess: () => {
      invalidateProducts();
      invalidateSubcategories(); // productCount changed
      setDeleteProd(undefined);
    },
  });

  const isMounted = !subcategoriesQuery.isLoading;
  const merchantGated = isMerchantGateError(subcategoriesQuery.error);

  // --- Handlers ---
  const handleSaveSubcategory = (name: string, garmentSubcategoryId: string) => {
    if (editingSub) updateSubMutation.mutate({ id: editingSub.id, name, garmentSubcategoryId });
    else createSubMutation.mutate({ name, garmentSubcategoryId });
  };

  const handleDeleteSubcategory = () => {
    if (deleteSub) deleteSubMutation.mutate(deleteSub.id);
  };

  const handleDeleteProduct = () => {
    if (deleteProd) deleteProductMutation.mutate(deleteProd.id);
  };

  const handleProductSaved = () => {
    invalidateProducts();
    invalidateSubcategories();
    setProdModalOpen(false);
    setEditingProd(undefined);
  };

  const handleBulkSaved = () => {
    invalidateProducts();
    invalidateSubcategories();
    setBulkModalOpen(false);
  };

  const openAddSubcategory = () => {
    setEditingSub(undefined);
    setSubModalOpen(true);
  };

  const openAddProduct = () => {
    setEditingProd(undefined);
    setProdModalOpen(true);
  };

  if (!isMounted) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.mid, fontSize: 14 }}>Loading catalogue...</div>
      </div>
    );
  }

  if (merchantGated) {
    return (
      <>
        <TopBar
          title="Try On Library"
          subtitle="Organize your products by category and garment type."
        />
        <div
          style={{
            flex: 1,
            padding: '64px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>
            Merchant account required
          </h3>
          <p style={{ color: C.light, fontSize: 14, margin: 0, maxWidth: 360 }}>
            This account isn't enabled for virtual try-on yet. Contact support to get your merchant
            account activated.
          </p>
        </div>
      </>
    );
  }

  const selectedSub = subcategories.find((s) => s.id === selectedSubcategoryId);
  const visibleSubs = subcategories.filter((s) => s.category === selectedCategory);

  // --- Views ---
  const renderCategoryTabs = () => (
    <div style={{ display: 'flex', gap: 10, marginBottom: 24, padding: '0 28px', marginTop: 24 }}>
      {CATEGORIES.map((cat) => {
        const isSelected = selectedCategory === cat.id;
        return (
          <button
            type="button"
            key={cat.id}
            onClick={() => {
              setSelectedCategory(cat.id);
              setSelectedSubcategoryId(null);
            }}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: `1px solid ${isSelected ? C.pink : C.border2}`,
              background: isSelected ? 'rgba(245, 92, 122, 0.05)' : C.card,
              color: isSelected ? C.pink : C.text,
              fontWeight: isSelected ? 600 : 500,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              outline: 'none',
            }}
            className="focus-ring hover-surface"
          >
            {cat.label}
          </button>
        );
      })}
    </div>
  );

  const renderSubcategoryGrid = () => {
    if (visibleSubs.length === 0) {
      return (
        <div
          style={{
            padding: '64px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ color: C.pink, opacity: 0.8, marginBottom: 4 }}>
            <GarmentIcon size={48} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>
              No subcategories yet
            </h3>
            <p style={{ color: C.light, fontSize: 14, margin: 0, maxWidth: 300 }}>
              Create your first subcategory to start organizing your products.
            </p>
          </div>
          <div style={{ marginTop: 8 }}>
            <GradBtn onClick={openAddSubcategory}>Add Subcategory</GradBtn>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
          padding: '0 28px 40px',
        }}
      >
        {visibleSubs.map((sub) => {
          const garmentTypeLabel =
            garmentTypes.find((g) => g.id === sub.garmentSubcategoryId)?.label || 'Unknown';

          return (
            // biome-ignore lint/a11y/useSemanticElements: contains a nested interactive <button> (delete) — real <button> here would be invalid HTML (no nesting)
            <div
              key={sub.id}
              className="prod-card focus-ring"
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedSubcategoryId(sub.id);
                }
              }}
              onClick={() => setSelectedSubcategoryId(sub.id)}
              style={{
                position: 'relative',
                padding: '24px 20px 20px',
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                background: C.card,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                transition: 'transform 0.15s, border-color 0.15s',
                outline: 'none',
              }}
            >
              {/* Delete button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteSub(sub);
                }}
                style={{
                  position: 'absolute',
                  top: 14,
                  right: 14,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: C.light,
                  padding: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  transition: 'color 0.12s, background 0.12s',
                  zIndex: 10,
                }}
                className="hover-surface"
                title="Delete subcategory"
              >
                <TrashIcon />
              </button>

              <div
                style={{
                  color: C.pink,
                  width: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(245, 92, 122, 0.08)',
                  borderRadius: 10,
                }}
              >
                <GarmentIcon size={20} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: C.text,
                    wordBreak: 'break-word',
                    paddingRight: 24,
                  }}
                >
                  {sub.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      background: C.border2,
                      color: C.text,
                      padding: '2px 8px',
                      borderRadius: 6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {garmentTypeLabel}
                  </span>
                  <span style={{ fontSize: 12, color: C.mid }}>
                    • {sub.productCount} {sub.productCount === 1 ? 'product' : 'products'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderProductGrid = () => {
    if (!selectedSub) return null;

    if (productsQuery.isLoading) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', color: C.light, fontSize: 14 }}>
          Loading products...
        </div>
      );
    }

    if (products.length === 0) {
      return (
        <div
          style={{
            padding: '64px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ color: C.pink, opacity: 0.8, marginBottom: 4 }}>
            <GarmentIcon size={48} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>
              No products yet
            </h3>
            <p style={{ color: C.light, fontSize: 14, margin: 0, maxWidth: 300 }}>
              Add your first product to this subcategory.
            </p>
          </div>
          <div style={{ marginTop: 8 }}>
            <GradBtn onClick={openAddProduct}>Add Product</GradBtn>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 16,
          padding: '24px 28px 40px',
        }}
      >
        {products.map((product) => (
          <div
            key={product.id}
            className="prod-card"
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              overflow: 'hidden',
              background: C.card,
              position: 'relative',
            }}
          >
            {/* Action Buttons */}
            <div
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                display: 'flex',
                gap: 6,
                zIndex: 10,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setEditingProd(product);
                  setProdModalOpen(true);
                }}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: C.card,
                  border: `1px solid ${C.border2}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: C.text,
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                }}
                className="hover-surface"
                title="Edit Product"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setDeleteProd(product)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: C.card,
                  border: `1px solid ${C.border2}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: C.pink,
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                }}
                className="hover-surface"
                title="Delete Product"
              >
                <TrashIcon />
              </button>
            </div>

            {/* Image Area */}
            <div
              style={{
                aspectRatio: '3/4',
                background: C.lighter,
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div className="prod-card-img" style={{ width: '100%', height: '100%' }}>
                {product.thumbnailUrl || product.imageUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {/* biome-ignore lint/performance/noImgElement: presigned R2 URL */}
                    <img
                      src={product.thumbnailUrl ?? product.imageUrl ?? undefined}
                      alt={product.label}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: 'top center',
                      }}
                    />
                  </>
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: C.mid,
                      opacity: 0.35,
                    }}
                  >
                    <GarmentIcon size={48} />
                  </div>
                )}
              </div>
              {!product.isActive && product.actualPrice === 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    left: 10,
                    background: C.pink,
                    color: C.white,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    textTransform: 'uppercase',
                    zIndex: 5,
                  }}
                >
                  Needs details
                </div>
              )}
            </div>

            {/* Details Area */}
            <div
              style={{
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: C.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {product.label}
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: C.mid,
                  fontFamily: 'monospace',
                }}
              >
                SKU: {product.sku ?? '—'}
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: C.pink }}>
                  ₹{product.offerPrice}
                </span>
                {product.offerPrice < product.actualPrice && (
                  <span style={{ fontSize: 13, color: C.mid, textDecoration: 'line-through' }}>
                    ₹{product.actualPrice}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {!selectedSub ? (
        <>
          <TopBar
            title="Try On Library"
            subtitle="Organize your products by category and garment type."
            right={
              <GradBtn onClick={openAddSubcategory}>
                <PlusIcon size={14} />
                <span className="hide-mobile-tablet">Add Subcategory</span>
                <span className="show-mobile-tablet-only">Add</span>
              </GradBtn>
            }
          />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {renderCategoryTabs()}
            {renderSubcategoryGrid()}
          </div>
        </>
      ) : (
        <>
          <TopBar
            lead={
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <button
                  type="button"
                  onClick={() => setSelectedSubcategoryId(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 6,
                    color: C.text,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    transition: 'background 0.15s',
                  }}
                  className="hover-surface"
                  title="Back to subcategories"
                >
                  <ArrowLeft />
                </button>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 20, lineHeight: '32px', color: C.text }}>
                    {selectedSub.name}
                  </div>
                  <div
                    style={{
                      fontWeight: 500,
                      fontSize: 14,
                      lineHeight: '20px',
                      color: C.mid,
                      marginTop: 2,
                    }}
                  >
                    {garmentTypes.find((g) => g.id === selectedSub.garmentSubcategoryId)?.label ||
                      'Unknown'}
                  </div>
                </div>
              </div>
            }
            right={
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setBulkModalOpen(true)}
                  style={{
                    height: 40,
                    padding: '0 16px',
                    borderRadius: 8,
                    border: `1px solid ${C.border2}`,
                    background: C.card,
                    color: C.text,
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                  }}
                  className="hover-surface focus-ring"
                >
                  Bulk Upload
                </button>
                <GradBtn onClick={openAddProduct}>
                  <PlusIcon size={14} />
                  <span className="hide-mobile-tablet">Add Product</span>
                  <span className="show-mobile-tablet-only">Add</span>
                </GradBtn>
              </div>
            }
          />
          {reconcileFailedCount !== 0 && (
            <div
              style={{
                margin: '16px 28px 0',
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(245,92,122,0.06)',
                border: `1px solid ${C.pink}`,
                fontSize: 13,
                color: C.pink,
              }}
            >
              {reconcileFailedCount > 0
                ? `${reconcileFailedCount} generated image${reconcileFailedCount === 1 ? '' : 's'} failed to load — try reloading this page.`
                : "Couldn't check for newly generated products — try reloading this page."}
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto' }}>{renderProductGrid()}</div>
        </>
      )}

      {/* Modals & Dialogs */}
      <SubcategoryModal
        open={subModalOpen}
        onClose={() => {
          setSubModalOpen(false);
          setEditingSub(undefined);
        }}
        onSave={handleSaveSubcategory}
        initialData={
          editingSub
            ? {
                id: editingSub.id,
                name: editingSub.name,
                garmentSubcategoryId: editingSub.garmentSubcategoryId,
              }
            : undefined
        }
        garmentTypes={garmentTypes}
        isSaving={createSubMutation.isPending || updateSubMutation.isPending}
      />

      <ProductModal
        open={prodModalOpen}
        onClose={() => {
          setProdModalOpen(false);
          setEditingProd(undefined);
        }}
        onSaved={handleProductSaved}
        subcategoryId={selectedSubcategoryId}
        initialData={editingProd}
      />

      <BulkUploadModal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        onSaved={handleBulkSaved}
        subcategoryId={selectedSubcategoryId}
      />

      <ConfirmDialog
        open={!!deleteSub}
        title="Delete Subcategory"
        message={`Are you sure you want to delete "${deleteSub?.name}"? All products inside it will also be deleted.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDeleteSubcategory}
        onCancel={() => setDeleteSub(undefined)}
      />

      <ConfirmDialog
        open={!!deleteProd}
        title="Delete Product"
        message={`Are you sure you want to delete "${deleteProd?.label}"?`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDeleteProduct}
        onCancel={() => setDeleteProd(undefined)}
      />
    </div>
  );
}
