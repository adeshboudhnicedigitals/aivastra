// Single derivation of which garment slots a resolved workflow consumes. `hasUpper`
// exists so a client can tell a lower-only ("sole lower hero") workflow apart from
// a full-outfit one — createJob rejects a sole-lower pose without a lower upload
// (jobs/create.ts), and hasLower alone can't distinguish the two.
export function poseGarmentRoles(w: {
  upperNodeIds?: string[] | null;
  lowerNodeId?: string | null;
  shoeNodeId?: string | null;
  accessoryNodeId?: string | null;
}) {
  return {
    hasUpper: (w.upperNodeIds?.length ?? 0) > 0,
    hasLower: w.lowerNodeId != null,
    hasShoes: w.shoeNodeId != null,
    hasAccessory: w.accessoryNodeId != null,
  };
}
