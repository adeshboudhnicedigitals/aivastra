export type StaffForm = { branchId: string; email: string; displayName: string; password: string };

// Limits mirror MerchantStaffCreateBody / MerchantStaffPasswordBody in @aivastra/types;
// the API stays authoritative.
export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password must be 128 characters or fewer.';
  return null;
}

export function validateResetPassword(pw: string, confirm: string): string | null {
  const err = validatePassword(pw);
  if (err) return err;
  if (pw !== confirm) return 'Passwords do not match.';
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateStaffForm(f: StaffForm): string | null {
  if (!f.branchId) return 'Choose a branch.';
  if (!EMAIL.test(f.email.trim())) return 'Enter a valid email address.';
  const name = f.displayName.trim();
  if (!name) return 'Name is required.';
  if (name.length > 120) return 'Name must be 120 characters or fewer.';
  return validatePassword(f.password);
}
