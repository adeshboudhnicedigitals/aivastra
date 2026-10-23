/**
 * Why a garment type cannot (fully) be offered in the chat. The seller never
 * sees these; they go to the log, a counter and, later, the admin matrix.
 */
export type ReadinessReason =
  | 'inactive'
  | 'mannequin_flow'
  | 'no_poses'
  | 'poses_inactive'
  | 'no_face'
  | 'no_background'
  | 'no_eligible_looks'
  | 'looks_dropped';

export interface ReadinessFacts {
  // garment_subcategories.is_active for the gender.
  active: boolean;
  // The two-step saree flow, which the bot does not run (D16/D31).
  requiresMannequinStep: boolean;
  // pose_garment_configs rows of the gender's poses for the type, active or not.
  assignedPoses: number;
  // Those a seller could be shown: pose and assignment both active.
  activePoses: number;
  hasFace: boolean;
  hasBackground: boolean;
  // The active poses before and after the eligibility filter (rules.ts buildPool, D49).
  looksTotal: number;
  looksUsable: number;
}

export interface Readiness {
  status: 'ready' | 'degraded' | 'blocked';
  reasons: ReadinessReason[];
}

/**
 * One answer to "can the bot offer this type?". Structural gaps short-circuit,
 * because a face or look count means nothing without an active pose; face
 * and look gaps are independent, so both are reported.
 */
export function decideReadiness(f: ReadinessFacts): Readiness {
  const blocked = (...reasons: ReadinessReason[]): Readiness => ({ status: 'blocked', reasons });
  if (!f.active) return blocked('inactive');
  if (f.requiresMannequinStep) return blocked('mannequin_flow');
  if (f.assignedPoses === 0) return blocked('no_poses');
  if (f.activePoses === 0) return blocked('poses_inactive');

  const reasons: ReadinessReason[] = [];
  if (!f.hasFace) reasons.push('no_face');
  if (!f.hasBackground) reasons.push('no_background');
  if (f.looksUsable === 0) reasons.push('no_eligible_looks');
  if (reasons.length > 0) return blocked(...reasons);
  if (f.looksUsable < f.looksTotal) return { status: 'degraded', reasons: ['looks_dropped'] };
  return { status: 'ready', reasons: [] };
}
