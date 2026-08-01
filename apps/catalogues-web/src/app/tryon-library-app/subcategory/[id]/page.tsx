'use client';
import type {
  MerchantCatalogItem,
  MerchantCatalogListResponse,
  MerchantCatalogSubcategoryListResponse,
} from '@aivastra/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GarmentIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { catalogAppApi as api, CatalogAppSessionExpiredError } from '../../catalog-app-api';
import { reconcileHeldProducts } from '../../catalog-app-helpers';
import { ProductCard } from '../../components/ProductCard';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useLoggedOut } from '../../logged-out-context';

export default function ProductsScreen() {
  const params = useParams<{ id: string }>();
  const subcategoryId = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  const onLoggedOut = useLoggedOut();
  const [deleteTarget, setDeleteTarget] = useState<MerchantCatalogItem | undefined>(undefined);
  const [reconcileFailedCount, setReconcileFailedCount] = useState(0);

  const subcategoriesQuery = useQuery({
    queryKey: ['merchant-catalog-subcategories'],
    queryFn: () =>
      api.get<MerchantCatalogSubcategoryListResponse>(
        '/v1/merchant/catalog/subcategories?includeDemo=false',
      ),
  });
  const subcategory = subcategoriesQuery.data?.items.find((s) => s.id === subcategoryId);

  const garmentTypesQuery = useQuery({
    queryKey: ['garment-types', subcategory?.category],
    queryFn: () =>
      api.get<{ items: { id: string; label: string }[] }>(
        `/v1/models/garment-types?gender=${subcategory?.category}`,
      ),
    enabled: !!subcategory,
  });
  const garmentTypeLabel =
    garmentTypesQuery.data?.items.find((g) => g.id === subcategory?.garmentSubcategoryId)?.label ??
    'Unknown';

  const productsQuery = useQuery({
    queryKey: ['merchant-catalog-products', subcategoryId],
    queryFn: () =>
      api.get<MerchantCatalogListResponse>(
        `/v1/merchant/catalog?includeDemo=false&subcategoryId=${subcategoryId}`,
      ),
  });
  const products = productsQuery.data?.items ?? [];

  // Pull in any held batches that finished while the merchant was away.
  useEffect(() => {
    let cancelled = false;
    void reconcileHeldProducts().then(({ created, failed }) => {
      if (cancelled) return;
      if (created.length > 0) {
        qc.invalidateQueries({ queryKey: ['merchant-catalog-products', subcategoryId] });
      }
      // failed === -1 means the reconcile request itself never completed (network
      // error, 5xx, session expiry) — distinct from failed > 0, a partial failure
      // the server already logged. Either way, silently showing nothing here would
      // look identical to "nothing new yet" — see reconcileHeldProducts' doc comment.
      setReconcileFailedCount(failed);
    });
    return () => {
      cancelled = true;
    };
  }, [qc, subcategoryId]);

  useEffect(() => {
    const err = subcategoriesQuery.error ?? productsQuery.error;
    if (err instanceof CatalogAppSessionExpiredError) {
      onLoggedOut();
    }
  }, [subcategoriesQuery.error, productsQuery.error, onLoggedOut]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/merchant/catalog/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-catalog-products', subcategoryId] });
      qc.invalidateQueries({ queryKey: ['merchant-catalog-subcategories'] }); // productCount changed
      setDeleteTarget(undefined);
    },
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader
        variant="back"
        title={subcategory?.name ?? 'Products'}
        subtitle={garmentTypeLabel}
        onBack={() =>
          router.push(
            subcategory
              ? `/tryon-library-app?category=${subcategory.category}`
              : '/tryon-library-app',
          )
        }
        action={{
          label: 'Add Product',
          onClick: () => router.push(`/tryon-library-app/subcategory/${subcategoryId}/add-product`),
        }}
      />

      {reconcileFailedCount !== 0 && (
        <div
          style={{
            margin: '12px 16px 0',
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(245,92,122,0.06)',
            border: `1px solid ${C.pink}`,
            fontSize: 13,
            color: C.pink,
          }}
        >
          {reconcileFailedCount > 0
            ? `${reconcileFailedCount} generated image${reconcileFailedCount === 1 ? '' : 's'} failed to load — try reopening this screen.`
            : "Couldn't check for newly generated products — try reopening this screen."}
        </div>
      )}

      {productsQuery.isLoading ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '40vh',
          }}
        >
          <div style={{ color: C.mid, fontSize: 14 }}>Loading products…</div>
        </div>
      ) : products.length === 0 ? (
        <div
          style={{
            padding: '64px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ color: C.pink, opacity: 0.8 }}>
            <GarmentIcon size={44} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>
            No products yet
          </h3>
          <p style={{ color: C.light, fontSize: 13, margin: 0, maxWidth: 280 }}>
            Tap "Add Product" above to add your first one.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            padding: '12px 16px 100px',
          }}
        >
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onOpen={() =>
                router.push(
                  `/tryon-library-app/subcategory/${subcategoryId}/edit-product/${product.id}`,
                )
              }
              onDelete={() => setDeleteTarget(product)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Product"
        message={`Are you sure you want to delete "${deleteTarget?.label}"?`}
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(undefined)}
      />
    </div>
  );
}
