import { Modal, Thumbnail } from '@shopify/polaris';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { ShopifyProductImage } from '../types';

interface Props {
  shopifyProductId: number;
  onClose: () => void;
  onSelect: (src: string) => void;
}

export function ImagePickerModal({ shopifyProductId, onClose, onSelect }: Props) {
  const [images, setImages] = useState<ShopifyProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ images: ShopifyProductImage[] }>(`/v1/shopify/products/${shopifyProductId}/images`)
      .then((data) => setImages(data.images))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [shopifyProductId]);

  return (
    <Modal open title="Choose garment image" onClose={onClose}>
      <Modal.Section>
        {error && <p>{error}</p>}
        {loading && <p>Loading images...</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {images.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => onSelect(img.src)}
              style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
            >
              <Thumbnail source={img.src} alt="" size="large" />
            </button>
          ))}
        </div>
      </Modal.Section>
    </Modal>
  );
}
