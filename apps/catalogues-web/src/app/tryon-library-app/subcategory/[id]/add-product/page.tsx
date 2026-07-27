'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ProductForm } from '../../../components/ProductForm';
import { ScreenHeader } from '../../../components/ScreenHeader';

export default function AddProductScreen() {
  const params = useParams<{ id: string }>();
  const subcategoryId = params.id;
  const router = useRouter();
  const qc = useQueryClient();

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
        onSaved={handleSaved}
        onCancel={goBackToProducts}
      />
    </div>
  );
}
