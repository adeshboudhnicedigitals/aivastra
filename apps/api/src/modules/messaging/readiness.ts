/**
 * Why a garment type cannot (fully) be offered in the chat. The seller never
 * sees these; they go to the log, a counter and, later, the admin matrix.
 */
export type ReadinessReason =
  | 'inactive'
  | 'mannequin_flow'
  | 'no_mapping'
  | 'template_inactive'
  | 'no_face'
  | 'no_eligible_looks'
  | 'looks_dropped';

export interface ReadinessFacts {
  // garment_subcategories.is_active for the gender.
  active: boolean;
  // The two-step saree flow, which the bot does not run (D16/D31).
  requiresMannequinStep: boolean;
  // catalogue_template_subcategories rows for the type and gender, active or not.
  mappedTemplates: number;
  // Those whose template is active.
  activeTemplates: number;
  hasFace: boolean;
  // Distinct (pose, background) looks across the active templates, before and
  // after the eligibility filter (rules.ts buildPool, D49).
  looksTotal: number;
  looksUsable: number;
}

export interface Readiness {
  status: 'ready' | 'degraded' | 'blocked';
  reasons: ReadinessReason[];
}

/**
 * One answer to "can the bot offer this type?". Structural gaps short-circuit,
 * because a face or look count means nothing without an active template; face
 * and look gaps are independent, so both are reported.
 */
export function decideReadiness(f: ReadinessFacts): Readiness {
  const blocked = (...reasons: ReadinessReason[]): Readiness => ({ status: 'blocked', reasons });
  if (!f.active) return blocked('inactive');
  if (f.requiresMannequinStep) return blocked('mannequin_flow');
  if (f.mappedTemplates === 0) return blocked('no_mapping');
  if (f.activeTemplates === 0) return blocked('template_inactive');

  const reasons: ReadinessReason[] = [];
  if (!f.hasFace) reasons.push('no_face');
  if (f.looksUsable === 0) reasons.push('no_eligible_looks');
  if (reasons.length > 0) return blocked(...reasons);
  if (f.looksUsable < f.looksTotal) return { status: 'degraded', reasons: ['looks_dropped'] };
  return { status: 'ready', reasons: [] };
}
