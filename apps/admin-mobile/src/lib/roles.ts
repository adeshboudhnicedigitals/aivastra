import type { AdminRole } from '../types';

const ROLE_LEVEL: Record<AdminRole, number> = {
  SUPER_ADMIN: 3,
  MODERATOR: 2,
  ADMIN: 2,
  SUPPORT: 1,
};

export function canAccessAssets(role: AdminRole | null): boolean {
  if (!role) return false;
  return ROLE_LEVEL[role] >= 2;
}

export function canManageUsers(role: AdminRole | null): boolean {
  if (!role) return false;
  return ROLE_LEVEL[role] >= 2;
}

export function isSuperAdmin(role: AdminRole | null): boolean {
  return role === 'SUPER_ADMIN';
}

export function canDeleteAssets(role: AdminRole | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'MODERATOR';
}

export function canManageTryonSaree(role: AdminRole | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'MODERATOR';
}
