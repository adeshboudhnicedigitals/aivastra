'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, GarmentIcon, TrashIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GradBtn } from '@/components/ui/grad-btn';
import { BulkUploadModal } from './BulkUploadModal';
import { type Product, ProductModal } from './ProductModal';
import { type GarmentType, type Subcategory, SubcategoryModal } from './SubcategoryModal';

type Category = 'men' | 'women' | 'boys' | 'girls';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'men', label: 'Men' },
  { id: 'women', label: 'Women' },
  { id: 'boys', label: 'Boys' },
  { id: 'girls', label: 'Girls' },
];

const GARMENT_TYPES: GarmentType[] = [
  { id: 'men-shirt', label: 'Shirt', category: 'men' },
  { id: 'men-tshirt', label: 'T-Shirt', category: 'men' },
  { id: 'men-kurta', label: 'Kurta', category: 'men' },
  { id: 'men-jacket', label: 'Jacket', category: 'men' },
  { id: 'women-saree', label: 'Saree', category: 'women' },
  { id: 'women-kurti', label: 'Kurti', category: 'women' },
  { id: 'women-dress', label: 'Dress', category: 'women' },
  { id: 'women-blouse', label: 'Blouse', category: 'women' },
  { id: 'boys-shirt', label: 'Shirt', category: 'boys' },
  { id: 'boys-tshirt', label: 'T-Shirt', category: 'boys' },
  { id: 'girls-frock', label: 'Frock', category: 'girls' },
  { id: 'girls-kurti', label: 'Kurti', category: 'girls' },
];

const INITIAL_SUBCATEGORIES: Subcategory[] = [
  { id: 'sub-1', category: 'men', name: 'Premium Shirts', garmentTypeId: 'men-shirt' },
  { id: 'sub-2', category: 'men', name: 'Casual Jackets', garmentTypeId: 'men-jacket' },
  { id: 'sub-3', category: 'women', name: 'Festival Sarees', garmentTypeId: 'women-saree' },
  { id: 'sub-4', category: 'women', name: 'Summer Kurtis', garmentTypeId: 'women-kurti' },
];

const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'p-1',
    subcategoryId: 'sub-1',
    label: 'Classic Linen Shirt',
    sku: 'SH-LN-WHT-M',
    actualPrice: 1499,
    offerPrice: 1199,
  },
  {
    id: 'p-2',
    subcategoryId: 'sub-1',
    label: 'Striped Cotton Shirt',
    sku: 'SH-CT-STP-L',
    actualPrice: 1299,
    offerPrice: 999,
  },
  {
    id: 'p-3',
    subcategoryId: 'sub-2',
    label: 'Denim Trucker Jacket',
    sku: 'JK-DN-BLU-L',
    actualPrice: 2999,
    offerPrice: 2499,
  },
  {
    id: 'p-4',
    subcategoryId: 'sub-3',
    label: 'Kanjeevaram Silk Saree',
    sku: 'SR-KJ-RED-O',
    actualPrice: 5999,
    offerPrice: 4999,
  },
  {
    id: 'p-5',
    subcategoryId: 'sub-4',
    label: 'Cotton Printed Kurti',
    sku: 'KT-CT-PRT-S',
    actualPrice: 899,
    offerPrice: 899,
  },
];

const generateId = () => Math.random().toString(36).substring(2, 9);

export function CatalogueManagerContent() {
  const [isMounted, setIsMounted] = useState(false);
  const [subcategories, setSubcategories] = useState<Subcategory[]>(INITIAL_SUBCATEGORIES);
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);

  const [selectedCategory, setSelectedCategory] = useState<Category>('men');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);

  // Modals state
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<Subcategory | undefined>(undefined);
  const [deleteSub, setDeleteSub] = useState<Subcategory | undefined>(undefined);

  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<Product | undefined>(undefined);
  const [deleteProd, setDeleteProd] = useState<Product | undefined>(undefined);

  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  // Local Storage syncing
  useEffect(() => {
    const savedSubs = localStorage.getItem('av_subcategories');
    const savedProds = localStorage.getItem('av_products');
    if (savedSubs) {
      try {
        setSubcategories(JSON.parse(savedSubs));
      } catch (e) {
        console.error('Failed to parse subcategories', e);
      }
    }
    if (savedProds) {
      try {
        setProducts(JSON.parse(savedProds));
      } catch (e) {
        console.error('Failed to parse products', e);
      }
    }
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('av_subcategories', JSON.stringify(subcategories));
    }
  }, [subcategories, isMounted]);

  useEffect(() => {
    if (isMounted) {
      try {
        localStorage.setItem('av_products', JSON.stringify(products));
      } catch (_err) {
        console.warn('localStorage quota exceeded, stripping image data to persist state...');
        try {
          const stripped = products.map((p) => ({ ...p, imageDataUrl: undefined }));
          localStorage.setItem('av_products', JSON.stringify(stripped));
        } catch (innerErr) {
          console.error('Failed to save products to localStorage', innerErr);
        }
      }
    }
  }, [products, isMounted]);

  if (!isMounted) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.mid, fontSize: 14 }}>Loading catalogue...</div>
      </div>
    );
  }

  const selectedSub = subcategories.find((s) => s.id === selectedSubcategoryId);

  // --- Handlers ---
  const handleSaveSubcategory = (name: string, garmentTypeId: string) => {
    if (editingSub) {
      setSubcategories((prev) =>
        prev.map((s) => (s.id === editingSub.id ? { ...s, name, garmentTypeId } : s)),
      );
    } else {
      const newSub: Subcategory = {
        id: generateId(),
        category: selectedCategory,
        name,
        garmentTypeId,
      };
      setSubcategories((prev) => [...prev, newSub]);
    }
    setSubModalOpen(false);
    setEditingSub(undefined);
  };

  const handleDeleteSubcategory = () => {
    if (!deleteSub) return;
    setSubcategories((prev) => prev.filter((s) => s.id !== deleteSub.id));
    setProducts((prev) => prev.filter((p) => p.subcategoryId !== deleteSub.id));
    if (selectedSubcategoryId === deleteSub.id) {
      setSelectedSubcategoryId(null);
    }
    setDeleteSub(undefined);
  };

  const handleSaveProduct = (prodData: Omit<Product, 'id' | 'subcategoryId'>) => {
    if (!selectedSubcategoryId) return;
    if (editingProd) {
      setProducts((prev) => prev.map((p) => (p.id === editingProd.id ? { ...p, ...prodData } : p)));
    } else {
      const newProd: Product = {
        id: generateId(),
        subcategoryId: selectedSubcategoryId,
        ...prodData,
      };
      setProducts((prev) => [...prev, newProd]);
    }
    setProdModalOpen(false);
    setEditingProd(undefined);
  };

  const handleDeleteProduct = () => {
    if (!deleteProd) return;
    setProducts((prev) => prev.filter((p) => p.id !== deleteProd.id));
    setDeleteProd(undefined);
  };

  const handleSaveBulkProducts = (newProductsData: Omit<Product, 'id' | 'subcategoryId'>[]) => {
    if (!selectedSubcategoryId) return;
    const newProducts: Product[] = newProductsData.map((prod) => ({
      id: generateId(),
      subcategoryId: selectedSubcategoryId,
      ...prod,
    }));
    setProducts((prev) => [...prev, ...newProducts]);
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
    const visibleSubs = subcategories.filter((s) => s.category === selectedCategory);

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
            GARMENT_TYPES.find((g) => g.id === sub.garmentTypeId)?.label || 'Unknown';
          const productCount = products.filter((p) => p.subcategoryId === sub.id).length;

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
                    • {productCount} {productCount === 1 ? 'product' : 'products'}
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
    const subProducts = products.filter((p) => p.subcategoryId === selectedSub.id);

    if (subProducts.length === 0) {
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
        {subProducts.map((product) => (
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
                {product.imageDataUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {/* biome-ignore lint/performance/noImgElement: local preview */}
                    <img
                      src={product.imageDataUrl}
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
                SKU: {product.sku}
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
            title="Catalogue Manager"
            subtitle="Organize your products by category and garment type."
            right={<GradBtn onClick={openAddSubcategory}>Add Subcategory</GradBtn>}
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
                    {GARMENT_TYPES.find((g) => g.id === selectedSub.garmentTypeId)?.label ||
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
                <GradBtn onClick={openAddProduct}>Add Product</GradBtn>
              </div>
            }
          />
          <div style={{ flex: 1, overflowY: 'auto' }}>{renderProductGrid()}</div>
        </>
      )}

      {/* Modals & Dialogs */}
      <SubcategoryModal
        open={subModalOpen}
        onClose={() => setSubModalOpen(false)}
        onSave={handleSaveSubcategory}
        initialData={editingSub}
        category={selectedCategory}
        garmentTypes={GARMENT_TYPES}
      />

      <ProductModal
        open={prodModalOpen}
        onClose={() => setProdModalOpen(false)}
        onSave={handleSaveProduct}
        initialData={editingProd}
      />

      <BulkUploadModal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        onSave={handleSaveBulkProducts}
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
