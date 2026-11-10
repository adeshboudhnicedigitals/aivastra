import { describe, expect, it } from 'vitest';
import { validatePassword, validateResetPassword, validateStaffForm } from './staff-form';

const ok = { branchId: 'b1', email: 'a@b.co', displayName: 'Asha', password: 'longenough' };

describe('validatePassword', () => {
  it('enforces 8..128 characters', () => {
    expect(validatePassword('short')).toMatch(/8/);
    expect(validatePassword('x'.repeat(129))).toMatch(/128/);
    expect(validatePassword('x'.repeat(8))).toBeNull();
    expect(validatePassword('x'.repeat(128))).toBeNull();
  });
  it('does not trim (spaces count, as the API does not trim)', () => {
    expect(validatePassword('        ')).toBeNull();
  });
});

describe('validateResetPassword', () => {
  it('requires a valid password first', () => {
    expect(validateResetPassword('short', 'short')).toMatch(/8/);
  });
  it('requires the confirmation to match', () => {
    expect(validateResetPassword('longenough', 'different1')).toBe('Passwords do not match.');
  });
  it('accepts matching valid passwords', () => {
    expect(validateResetPassword('longenough', 'longenough')).toBeNull();
  });
});

describe('validateStaffForm', () => {
  it('accepts a valid form', () => {
    expect(validateStaffForm(ok)).toBeNull();
  });
  it('requires a branch', () => {
    expect(validateStaffForm({ ...ok, branchId: '' })).toBe('Choose a branch.');
  });
  it('checks email shape after trimming', () => {
    expect(validateStaffForm({ ...ok, email: 'nope' })).toMatch(/email/i);
    expect(validateStaffForm({ ...ok, email: 'a@b' })).toMatch(/email/i);
    expect(validateStaffForm({ ...ok, email: '  a@b.co ' })).toBeNull();
  });
  it('requires a trimmed display name of at most 120 characters', () => {
    expect(validateStaffForm({ ...ok, displayName: '   ' })).toMatch(/name/i);
    expect(validateStaffForm({ ...ok, displayName: 'a'.repeat(121) })).toMatch(/120/);
    expect(validateStaffForm({ ...ok, displayName: 'a'.repeat(120) })).toBeNull();
  });
  it('validates the password', () => {
    expect(validateStaffForm({ ...ok, password: 'short' })).toMatch(/8/);
  });
});
