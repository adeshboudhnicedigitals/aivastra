'use client';
import type {
  MerchantCatalogCategory as Category,
  MerchantCatalogSubcategory,
  MerchantCatalogSubcategoryListResponse,
} from '@aivastra/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ChevronRight, GarmentIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { catalogAppApi as api, CatalogAppSessionExpiredError } from './catalog-app-api';
import { ScreenHeader } from './components/ScreenHeader';
import { SubcategoryCard } from './components/SubcategoryCard';
import { useLoggedOut } from './logged-out-context';

// "not a merchant account" / "merchant account inactive" — thrown by requireMerchant
// (apps/api/src/plugins/portal-auth.ts) when the logged-in user has no merchants row.
function isMerchantGateError(err: unknown): boolean {
  return err instanceof Error && /merchant account/i.test(err.message);
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const GENDER_OPTIONS: { id: Category; label: string }[] = [
  { id: 'women', label: 'Women' },
  { id: 'men', label: 'Men' },
  { id: 'girls', label: 'Girls' },
  { id: 'boys', label: 'Boys' },
];

function GenderPicker({ onSelect }: { onSelect: (category: Category) => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        gap: 20,
        padding: '40px 16px 16px',
        maxWidth: 420,
        width: '100%',
        margin: '0 auto',
      }}
    >
      {GENDER_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onSelect(opt.id)}
          className="focus-ring hover-surface"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            background: C.card,
            padding: '26px 20px',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ flex: 1, fontSize: 19, fontWeight: 700, color: C.text, paddingLeft: 12 }}>
            {opt.label}
          </div>
          <div style={{ color: C.light }}>
            <ChevronRight />
          </div>
        </button>
      ))}
    </div>
  );
}

// Docked at the bottom of the starting screen only — once the user drills
// into a category the credit breakdown isn't relevant, so this unmounts along
// with GenderPicker rather than living in ScreenHeader (empty on that screen).
function CreditSummaryBar() {
  const { data: me } = useQuery<{ balance: number; used: number }>({
    queryKey: ['catalog-app-me'],
    queryFn: () => api.get('/v1/merchant/me'),
    retry: false,
  });

  const available = me?.balance ?? 0;
  const used = me?.used ?? 0;

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        background: C.white,
        borderTop: `1px solid ${C.border}`,
        padding: '14px 20px calc(14px + env(safe-area-inset-bottom))',
        display: 'flex',
        alignItems: 'stretch',
        gap: 16,
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'flex', flexShrink: 0 }}>
          {/* biome-ignore lint/performance/noImgElement: credit icon, standalone page not using next/image */}
          <img src={`${BASE}/assets/credit.png`} alt="" width={20} height={20} />
        </span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>
            {available}
          </div>
          <div style={{ fontSize: 11, color: C.mid }}>Credits Available</div>
        </div>
      </div>

      <div style={{ width: 1, background: C.border }} />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>
            {used}
          </div>
          <div style={{ fontSize: 11, color: C.mid }}>Credits Used</div>
        </div>
      </div>
    </div>
  );
}

function SubcategoriesScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const onLoggedOut = useLoggedOut();

  const selectedCategory = searchParams.get('category') as Category | null;
  const [deleteTarget, setDeleteTarget] = useState<MerchantCatalogSubcategory | undefined>(
    undefined,
  );

  function selectGender(category: Category) {
    router.push(`/tryon-library-app?category=${category}`);
  }

  const subcategoriesQuery = useQuery({
    queryKey: ['merchant-catalog-subcategories'],
    queryFn: () =>
      api.get<MerchantCatalogSubcategoryListResponse>(
        '/v1/merchant/catalog/subcategories?includeDemo=false',
      ),
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
    enabled: !merchantGated && !!selectedCategory,
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
        <ScreenHeader variant="root" />
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
        <ScreenHeader variant="root" />
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

  if (!selectedCategory) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <ScreenHeader variant="root" />
        <GenderPicker onSelect={selectGender} />
        <CreditSummaryBar />
      </div>
    );
  }

  const categoryLabel = GENDER_OPTIONS.find((g) => g.id === selectedCategory)?.label ?? '';
  const visibleSubs = subcategories.filter((s) => s.category === selectedCategory);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader
        variant="back"
        title={categoryLabel}
        onBack={() => router.push('/tryon-library-app')}
        actions={[
          {
            label: 'Add Subcategory',
            onClick: () =>
              router.push(`/tryon-library-app/add-subcategory?category=${selectedCategory}`),
          },
        ]}
      />

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
            Tap "Add Subcategory" above to create your first one.
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
