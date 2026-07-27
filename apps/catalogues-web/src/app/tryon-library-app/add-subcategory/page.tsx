'use client';
import { MerchantCatalogCategory, type MerchantCatalogSubcategory } from '@aivastra/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { PremiumSelect } from '@/components/ui/premium-select';
import { catalogAppApi as api } from '../catalog-app-api';
import { ScreenHeader } from '../components/ScreenHeader';
import { StickyBottomBar } from '../components/StickyBottomBar';

function AddSubcategoryScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const category = MerchantCatalogCategory.safeParse(searchParams.get('category')).data ?? 'men';

  const [name, setName] = useState('');
  const [garmentSubcategoryId, setGarmentSubcategoryId] = useState('');
  const [error, setError] = useState('');

  const garmentTypesQuery = useQuery({
    queryKey: ['garment-types', category],
    queryFn: () =>
      api.get<{ items: { id: string; label: string }[] }>(
        `/v1/models/garment-types?gender=${category}`,
      ),
  });
  const garmentTypes = garmentTypesQuery.data?.items ?? [];
  const garmentOptions = garmentTypes.map((g) => ({ value: g.id, label: g.label }));

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<MerchantCatalogSubcategory>('/v1/merchant/catalog/subcategories', {
        category,
        name: name.trim(),
        garmentSubcategoryId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-catalog-subcategories'] });
      router.back();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to save subcategory.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !garmentSubcategoryId) return;
    createMutation.mutate();
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader
        variant="back"
        title="Add Subcategory"
        subtitle={`Category: ${category.charAt(0).toUpperCase()}${category.slice(1)}`}
        onBack={() => router.back()}
      />

      <form
        onSubmit={handleSubmit}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20, padding: 16 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="sub-name" style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
            Name <span style={{ color: C.pink }}>*</span>
          </label>
          <input
            id="sub-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summer Collection"
            style={{
              width: '100%',
              height: 48,
              borderRadius: 8,
              border: `1px solid ${C.border2}`,
              padding: '0 14px',
              fontSize: 15,
              fontFamily: 'inherit',
              background: C.field,
              color: C.text,
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
            Garment Type <span style={{ color: C.pink }}>*</span>
          </span>
          <div style={{ border: `1px solid ${C.border2}`, borderRadius: 8, background: C.field }}>
            <PremiumSelect
              value={garmentSubcategoryId}
              onChange={(val) => setGarmentSubcategoryId(val as string)}
              options={garmentOptions}
              fullWidth
              height={48}
              placeholder="Select garment type…"
            />
          </div>
        </div>

        {error && <p style={{ fontSize: 13, color: C.pink, margin: 0 }}>{error}</p>}
      </form>

      <StickyBottomBar>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={createMutation.isPending}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 8,
            border: `1px solid ${C.border2}`,
            background: C.white,
            color: C.text,
            fontFamily: 'inherit',
            fontSize: 15,
            fontWeight: 600,
            cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
        <div style={{ flex: 1 }}>
          <GradBtn
            type="button"
            onClick={() => {
              if (!name.trim() || !garmentSubcategoryId) {
                setError('Please fill in the name and garment type.');
                return;
              }
              setError('');
              createMutation.mutate();
            }}
            disabled={createMutation.isPending}
            style={{ width: '100%', height: 48 }}
          >
            {createMutation.isPending ? 'Saving…' : 'Save'}
          </GradBtn>
        </div>
      </StickyBottomBar>
    </div>
  );
}

export default function AddSubcategoryScreen() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: C.white }} />}>
      <AddSubcategoryScreenInner />
    </Suspense>
  );
}
