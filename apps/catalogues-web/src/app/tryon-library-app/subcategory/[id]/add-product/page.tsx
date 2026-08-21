'use client';
import type { MerchantCatalogSubcategoryListResponse } from '@aivastra/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { catalogAppApi as api } from '../../../catalog-app-api';
import { ProductForm } from '../../../components/ProductForm';
import { ScreenHeader } from '../../../components/ScreenHeader';

export default function AddProductScreen() {
  const params = useParams<{ id: string }>();
  const subcategoryId = params.id;
  const router = useRouter();
  const qc = useQueryClient();

  const subcategoriesQuery = useQuery({
    queryKey: ['merchant-catalog-subcategories'],
    queryFn: () =>
      api.get<MerchantCatalogSubcategoryListResponse>(
        '/v1/merchant/catalog/subcategories?includeDemo=false',
      ),
  });
  const subcategory = subcategoriesQuery.data?.items.find((s) => s.id === subcategoryId);

  function goBackToProducts() {
    router.push(`/tryon-library-app/subcategory/${subcategoryId}`);
  }

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['merchant-catalog-products', subcategoryId] });
    qc.invalidateQueries({ queryKey: ['merchant-catalog-subcategories'] });
    goBackToProducts();
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader variant="back" title="Add Product" onBack={goBackToProducts} />
      <ProductForm
        subcategoryId={subcategoryId}
        supportsTwoInputMannequin={subcategory?.supportsTwoInputMannequin ?? false}
        supportsTwoInputDirectTryon={subcategory?.supportsTwoInputDirectTryon ?? false}
        onSaved={handleSaved}
        onCancel={goBackToProducts}
      />
    </div>
  );
}
