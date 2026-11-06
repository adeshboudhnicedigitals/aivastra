import { describe, expect, it } from 'vitest';
import { canManageOrg } from './roles';

describe('canManageOrg', () => {
  it('is true only for admin', () => {
    expect(canManageOrg('admin')).toBe(true);
    expect(canManageOrg('staff')).toBe(false);
  });
});
