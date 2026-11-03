import {
  fleetGpuUpsertSchema,
  fleetHostUpsertSchema,
  fleetInventoryIdSchema,
  fleetWorkerMapSchema,
} from '@aivastra/types';
import { describe, expect, it } from 'vitest';
import {
  changedFields,
  gpuDeleteError,
  hostDeleteError,
  mappingError,
  moneyIn,
  moneyOut,
} from '../src/modules/fleet/inventory-core.js';

describe('mapping and deletion rules', () => {
  it('a worker needs an existing GPU on its own host', () => {
    expect(mappingError('h1', 'g1', { id: 'g1', hostId: 'h1' })).toBeNull();
    expect(mappingError('h1', 'g1', undefined)).toMatch(/does not exist/);
    expect(mappingError('h1', 'g1', { id: 'g1', hostId: 'h2' })).toMatch(/is on host h2, not h1/);
  });
  it('nothing in use can be deleted, and reviews are kept', () => {
    expect(hostDeleteError({ gpus: 0, workers: 2, reviews: 0 })).toMatch(/2 mapped workers/);
    expect(hostDeleteError({ gpus: 1, workers: 0, reviews: 0 })).toMatch(/1 GPU;/);
    expect(hostDeleteError({ gpus: 0, workers: 0, reviews: 3 })).toMatch(/kept/);
    expect(hostDeleteError({ gpus: 0, workers: 0, reviews: 0 })).toBeNull();
    expect(gpuDeleteError(1)).toMatch(/1 mapped worker;/);
    expect(gpuDeleteError(0)).toBeNull();
  });
});

describe('money and audit diff', () => {
  it('round-trips two decimals and tolerates null or junk', () => {
    expect(moneyIn(12.5)).toBe('12.50');
    expect(moneyOut('12.50')).toBe(12.5);
    expect(moneyIn(null)).toBeNull();
    expect(moneyOut(null)).toBeNull();
    expect(moneyOut('abc')).toBeNull();
  });
  it('audits only what changed', () => {
    expect(changedFields({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({
      before: { b: 2 },
      after: { b: 3 },
    });
    expect(changedFields(null, { a: 1 })).toEqual({ before: null, after: { a: 1 } });
  });
});

describe('write schemas', () => {
  const host = {
    label: 'GPU box 7',
    provider: ' Provider ',
    rented: true,
    monthlyCostUsd: 450.5,
    inventoryVerified: false,
    reason: 'checked invoice',
  };
  it('accepts a host, trims text and turns blank text into null', () => {
    expect(fleetHostUpsertSchema.parse(host).provider).toBe('Provider');
    expect(fleetHostUpsertSchema.parse({ ...host, provider: '   ' }).provider).toBeNull();
    expect(
      fleetHostUpsertSchema.parse({ ...host, rented: null, monthlyCostUsd: null }).monthlyCostUsd,
    ).toBeNull();
  });
  it('rejects negative, huge or sub-cent costs and a missing reason', () => {
    for (const bad of [
      { monthlyCostUsd: -1 },
      { monthlyCostUsd: 2_000_000 },
      { monthlyCostUsd: 1.234 },
      { reason: 'ab' },
      { label: '  ' },
    ]) {
      expect(fleetHostUpsertSchema.safeParse({ ...host, ...bad }).success).toBe(false);
    }
  });
  it('gpu: positive integer VRAM or null', () => {
    const gpu = {
      hostId: 'box-1',
      model: 'RTX 4090',
      vramTotalMb: 24576,
      reason: 'from nvidia-smi',
    };
    expect(fleetGpuUpsertSchema.safeParse(gpu).success).toBe(true);
    expect(fleetGpuUpsertSchema.safeParse({ ...gpu, vramTotalMb: null }).success).toBe(true);
    for (const v of [0, -5, 1.5])
      expect(fleetGpuUpsertSchema.safeParse({ ...gpu, vramTotalMb: v }).success).toBe(false);
  });
  it('worker map: both or neither', () => {
    const r = 'moved to new box';
    expect(
      fleetWorkerMapSchema.safeParse({ hostId: 'box-1', gpuId: 'gpu-1', reason: r }).success,
    ).toBe(true);
    expect(fleetWorkerMapSchema.safeParse({ hostId: null, gpuId: null, reason: r }).success).toBe(
      true,
    );
    expect(
      fleetWorkerMapSchema.safeParse({ hostId: 'box-1', gpuId: null, reason: r }).success,
    ).toBe(false);
  });
  it('ids are lowercase slugs', () => {
    for (const ok of ['box-1', 'a', 'gpu7'])
      expect(fleetInventoryIdSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['', 'Box', '-x', 'a b', 'a/b', 'x'.repeat(60)])
      expect(fleetInventoryIdSchema.safeParse(bad).success).toBe(false);
  });
});
