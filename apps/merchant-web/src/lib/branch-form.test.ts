import { describe, expect, it } from 'vitest';
import { branchPatch, validateBranchForm } from './branch-form';

describe('validateBranchForm', () => {
  it('requires a name', () => {
    expect(validateBranchForm({ name: '  ', city: '', address: '' })).toBe('Name is required.');
  });
  it('enforces the API length limits', () => {
    expect(validateBranchForm({ name: 'a'.repeat(121), city: '', address: '' })).toMatch(/Name/);
    expect(validateBranchForm({ name: 'a', city: 'c'.repeat(121), address: '' })).toMatch(/City/);
    expect(validateBranchForm({ name: 'a', city: '', address: 'x'.repeat(501) })).toMatch(
      /Address/,
    );
  });
  it('accepts a valid form', () => {
    expect(validateBranchForm({ name: 'Main', city: 'Pune', address: '' })).toBeNull();
  });
});

describe('branchPatch', () => {
  const base = { name: 'Main', city: 'Pune', address: 'MG Road' };
  it('returns only changed, trimmed fields', () => {
    expect(branchPatch(base, { name: ' Main ', city: 'Mumbai', address: 'MG Road' })).toEqual({
      city: 'Mumbai',
    });
  });
  it('returns null when nothing changed', () => {
    expect(branchPatch(base, { ...base })).toBeNull();
  });
});
