import { describe, expect, it } from 'vitest';
import { validateAddDevice, validateDeviceName } from './device-form';

describe('validateDeviceName', () => {
  it('requires a non-blank name', () => {
    expect(validateDeviceName('   ')).toBe('Name is required.');
    expect(validateDeviceName('')).toBe('Name is required.');
  });
  it('enforces 80 characters after trimming', () => {
    expect(validateDeviceName('a'.repeat(81))).toMatch(/80/);
    expect(validateDeviceName(`  ${'a'.repeat(80)}  `)).toBeNull();
  });
  it('accepts a normal name', () => {
    expect(validateDeviceName('Front counter')).toBeNull();
  });
});

describe('validateAddDevice', () => {
  it('requires a branch before checking the name', () => {
    expect(validateAddDevice({ branchId: '', name: 'x' })).toBe('Choose a branch.');
  });
  it('delegates name checks', () => {
    expect(validateAddDevice({ branchId: 'b1', name: ' ' })).toBe('Name is required.');
    expect(validateAddDevice({ branchId: 'b1', name: 'Tablet 1' })).toBeNull();
  });
});
