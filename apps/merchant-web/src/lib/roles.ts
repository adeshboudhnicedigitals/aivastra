export type OrgMe = {
  merchantId: string;
  role: 'admin' | 'staff';
  branchId: string | null;
  staffId: string | null;
  companyName: string;
  staffLimitPerBranch: number;
  deviceQuotaPerMonth: number | null;
};

/** Org-level management (branches, staff, quotas) is admin-only; staff are branch-scoped. */
export function canManageOrg(role: OrgMe['role']): boolean {
  return role === 'admin';
}
