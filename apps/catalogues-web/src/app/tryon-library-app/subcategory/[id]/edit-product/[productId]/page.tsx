'use client';
import type { MerchantCatalogListResponse } from '@aivastra/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { C } from '@/components/tokens';
import { catalogAppApi as api } from '../../../../catalog-app-api';
import { ProductForm } from '../../../../components/ProductForm';
import { ScreenHeader } from '../../../../components/ScreenHeader';

export default function EditProductScreen() {
  const params = useParams<{ id: string; productId: string }>();
  const subcategoryId = params.id;
  const productId = params.productId;
  const router = useRouter();
  const qc = useQueryClient();

  const productsQuery = useQuery({
    queryKey: ['merchant-catalog-products', subcategoryId],
    queryFn: () =>
      api.get<MerchantCatalogListResponse>(
        `/v1/merchant/catalog?includeDemo=false&subcategoryId=${subcategoryId}`,
      ),
  });
  const product = productsQuery.data?.items.find((p) => p.id === productId);

  function goBackToProducts() {
    router.push(`/tryon-library-app/subcategory/${subcategoryId}`);
  }

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['merchant-catalog-products', subcategoryId] });
    qc.invalidateQueries({ queryKey: ['merchant-catalog-subcategories'] });
    goBackToProducts();
  }

  if (productsQuery.isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <ScreenHeader variant="back" title="Edit Product" onBack={goBackToProducts} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '40vh',
          }}
        >
          <div style={{ color: C.mid, fontSize: 14 }}>Loading product…</div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <ScreenHeader variant="back" title="Edit Product" onBack={goBackToProducts} />
        <div style={{ padding: '64px 24px', textAlign: 'center' }}>
          <p style={{ color: C.mid, fontSize: 14 }}>
            This product couldn't be found. It may have been deleted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader variant="back" title="Edit Product" onBack={goBackToProducts} />
      <ProductForm
        subcategoryId={subcategoryId}
        initialData={product}
        onSaved={handleSaved}
        onCancel={goBackToProducts}
      />
    </div>
  );
}
