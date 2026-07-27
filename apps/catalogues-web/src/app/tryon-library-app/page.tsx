'use client';
import type {
  MerchantCatalogCategory as Category,
  MerchantCatalogSubcategory,
  MerchantCatalogSubcategoryListResponse,
} from '@aivastra/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { GarmentIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { catalogAppApi as api, CatalogAppSessionExpiredError } from './catalog-app-api';
import { CategoryTabs } from './components/CategoryTabs';
import { Fab } from './components/Fab';
import { ScreenHeader } from './components/ScreenHeader';
import { SubcategoryCard } from './components/SubcategoryCard';
import { useLoggedOut } from './logged-out-context';

// "not a merchant account" / "merchant account inactive" — thrown by requireMerchant
// (apps/api/src/plugins/portal-auth.ts) when the logged-in user has no merchants row.
function isMerchantGateError(err: unknown): boolean {
  return err instanceof Error && /merchant account/i.test(err.message);
}

function SubcategoriesScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const onLoggedOut = useLoggedOut();

  const selectedCategory = (searchParams.get('category') as Category | null) ?? 'men';
  const [deleteTarget, setDeleteTarget] = useState<MerchantCatalogSubcategory | undefined>(
    undefined,
  );

  function selectCategory(category: Category) {
    const params = new URLSearchParams(searchParams);
    params.set('category', category);
    router.replace(`/tryon-library-app?${params.toString()}`);
  }

  const subcategoriesQuery = useQuery({
    queryKey: ['merchant-catalog-subcategories'],
    queryFn: () =>
      api.get<MerchantCatalogSubcategoryListResponse>('/v1/merchant/catalog/subcategories'),
  });

  const merchantGated = isMerchantGateError(subcategoriesQuery.error);

  useEffect(() => {
    if (subcategoriesQuery.error instanceof CatalogAppSessionExpiredError) {
      onLoggedOut();
    }
  }, [subcategoriesQuery.error, onLoggedOut]);

  const subcategories = subcategoriesQuery.data?.items ?? [];

  const garmentTypesQuery = useQuery({
    queryKey: ['garment-types', selectedCategory],
    queryFn: () =>
      api.get<{ items: { id: string; label: string }[] }>(
        `/v1/models/garment-types?gender=${selectedCategory}`,
      ),
    enabled: !merchantGated,
  });
  const garmentTypes = garmentTypesQuery.data?.items ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/merchant/catalog/subcategories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-catalog-subcategories'] });
      setDeleteTarget(undefined);
    },
  });

  if (subcategoriesQuery.isLoading) {
    return (
      <>
        <ScreenHeader variant="root" title="Try On Library" />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
          }}
        >
          <div style={{ color: C.mid, fontSize: 14 }}>Loading catalogue…</div>
        </div>
      </>
    );
  }

  if (merchantGated) {
    return (
      <>
        <ScreenHeader variant="root" title="Try On Library" />
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
          <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>
            Merchant account required
          </h3>
          <p style={{ color: C.light, fontSize: 14, margin: 0, maxWidth: 320 }}>
            This account isn't enabled for virtual try-on yet. Contact support to get your merchant
            account activated.
          </p>
        </div>
      </>
    );
  }

  const visibleSubs = subcategories.filter((s) => s.category === selectedCategory);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader variant="root" title="Try On Library" />
      <CategoryTabs selected={selectedCategory} onSelect={selectCategory} />

      {visibleSubs.length === 0 ? (
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
            No subcategories yet
          </h3>
          <p style={{ color: C.light, fontSize: 13, margin: 0, maxWidth: 280 }}>
            Tap the + button to create your first subcategory.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            padding: '4px 16px 100px',
          }}
        >
          {visibleSubs.map((sub) => {
            const garmentTypeLabel =
              garmentTypes.find((g) => g.id === sub.garmentSubcategoryId)?.label || 'Unknown';
            return (
              <SubcategoryCard
                key={sub.id}
                subcategory={sub}
                garmentTypeLabel={garmentTypeLabel}
                onOpen={() => router.push(`/tryon-library-app/subcategory/${sub.id}`)}
                onDelete={() => setDeleteTarget(sub)}
              />
            );
          })}
        </div>
      )}

      <Fab
        onClick={() =>
          router.push(`/tryon-library-app/add-subcategory?category=${selectedCategory}`)
        }
        label="Add Subcategory"
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Subcategory"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? All products inside it will also be deleted.`}
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(undefined)}
      />
    </div>
  );
}

export default function SubcategoriesScreen() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: C.white }} />}>
      <SubcategoriesScreenInner />
    </Suspense>
  );
}
