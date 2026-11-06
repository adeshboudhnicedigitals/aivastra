// Limits mirror MerchantDeviceCreateBody / MerchantDeviceUpdateBody in @aivastra/types
// (name trimmed, 1..80); the API stays authoritative.
export function validateDeviceName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Name is required.';
  if (n.length > 80) return 'Name must be 80 characters or fewer.';
  return null;
}

export function validateAddDevice(f: { branchId: string; name: string }): string | null {
  if (!f.branchId) return 'Choose a branch.';
  return validateDeviceName(f.name);
}
