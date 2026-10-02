import { describe, expect, it } from 'vitest';
import { poseGarmentRoles } from './garment-roles.js';

describe('poseGarmentRoles', () => {
  it('reports hasAccessory true when accessoryNodeId is set', () => {
    const roles = poseGarmentRoles({
      upperNodeIds: ['1'],
      lowerNodeId: null,
      shoeNodeId: null,
      accessoryNodeId: '42',
    });
    expect(roles.hasAccessory).toBe(true);
  });

  it('reports hasAccessory false when accessoryNodeId is null or omitted', () => {
    expect(
      poseGarmentRoles({
        upperNodeIds: [],
        lowerNodeId: null,
        shoeNodeId: null,
        accessoryNodeId: null,
      }),
    ).toMatchObject({ hasAccessory: false });
    expect(
      poseGarmentRoles({ upperNodeIds: [], lowerNodeId: null, shoeNodeId: null }),
    ).toMatchObject({ hasAccessory: false });
  });
});
