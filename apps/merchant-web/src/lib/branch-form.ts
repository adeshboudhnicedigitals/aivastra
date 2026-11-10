export type BranchForm = { name: string; city: string; address: string };

// Limits mirror MerchantBranchCreateBody in @aivastra/types; the API stays authoritative.
export function validateBranchForm(f: BranchForm): string | null {
  if (!f.name.trim()) return 'Name is required.';
  if (f.name.trim().length > 120) return 'Name must be 120 characters or fewer.';
  if (f.city.trim().length > 120) return 'City must be 120 characters or fewer.';
  if (f.address.trim().length > 500) return 'Address must be 500 characters or fewer.';
  return null;
}

/** Fields that differ from the saved branch, trimmed; null when nothing changed. */
export function branchPatch(saved: BranchForm, next: BranchForm): Partial<BranchForm> | null {
  const patch: Partial<BranchForm> = {};
  for (const k of ['name', 'city', 'address'] as const) {
    const v = next[k].trim();
    if (v !== saved[k].trim()) patch[k] = v;
  }
  return Object.keys(patch).length ? patch : null;
}
