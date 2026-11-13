// Small pure helpers for the cart and stock screens (CRM phase 3).

/** ₹ with Indian digit grouping, from paise. */
export function rupees(paise: number): string {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(paise / 100))}`;
}

/** What staff type at the counter: case and spaces forgiven, the server's alphabet only. */
export function normaliseCartCode(raw: string): string | null {
  const code = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-HJ-KM-NP-Z2-9]{8}$/.test(code) ? code : null;
}

export const STOCK_LABEL: Record<string, string> = {
  in_stock: 'In stock',
  low: 'Low',
  out: 'Out of stock',
};
