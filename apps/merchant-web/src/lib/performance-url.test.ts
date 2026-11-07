import { describe, expect, it } from 'vitest';
import { performanceUrl } from './performance-url';

describe('performanceUrl', () => {
  it('branches tab clears both filters', () => {
    expect(performanceUrl({ tab: 'branches', branchId: 'b1', staffId: 's1' })).toBe(
      '/performance?tab=branches',
    );
  });
  it('staff tab clears staffId and keeps branchId', () => {
    expect(performanceUrl({ tab: 'staff', branchId: 'b1', staffId: 's1' })).toBe(
      '/performance?tab=staff&branchId=b1',
    );
  });
  it('devices tab keeps both', () => {
    expect(performanceUrl({ tab: 'devices', branchId: 'b1', staffId: 's1' })).toBe(
      '/performance?tab=devices&branchId=b1&staffId=s1',
    );
  });
  it('drill from a branch row sets branchId and tab=staff', () => {
    expect(performanceUrl({ tab: 'staff', branchId: 'b2' })).toBe(
      '/performance?tab=staff&branchId=b2',
    );
  });
  it('drill from a staff row sets staffId and keeps branchId', () => {
    expect(performanceUrl({ tab: 'devices', branchId: 'b1', staffId: 's9' })).toBe(
      '/performance?tab=devices&branchId=b1&staffId=s9',
    );
    expect(performanceUrl({ tab: 'devices', staffId: 's9' })).toBe(
      '/performance?tab=devices&staffId=s9',
    );
  });
  it('chip removal: dropping the staff filter stays on devices with the branch', () => {
    expect(performanceUrl({ tab: 'devices', branchId: 'b1' })).toBe(
      '/performance?tab=devices&branchId=b1',
    );
  });
});
