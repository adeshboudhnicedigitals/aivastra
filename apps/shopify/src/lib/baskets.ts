import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { type ClassifiedError, classifyError } from './errors';

export interface Basket {
  id: string;
  label: string;
  description: string | null;
  imageUrl: string | null;
}

/** The baskets a product can be routed to, fetched once per mount. */
export function useBaskets(): { baskets: Basket[]; error: ClassifiedError | null } {
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [error, setError] = useState<ClassifiedError | null>(null);

  useEffect(() => {
    apiFetch<{ items: Basket[] }>('/v1/shopify/baskets')
      .then((res) => setBaskets(res.items))
      .catch((err) => setError(classifyError(err)));
  }, []);

  return { baskets, error };
}

/** Options for a basket <Select>, led by a disabled placeholder. */
export function basketOptions(baskets: Basket[]) {
  return [
    { label: 'Choose a garment type', value: '', disabled: true },
    ...baskets.map((b) => ({ label: b.label, value: b.id })),
  ];
}
