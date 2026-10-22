import type { Gender } from './types.js';

// The two shot types the WhatsApp pool uses. Back poses need a photo of the
// garment's back (jobs/create.ts), which the bot does not ask for yet.
export type ShotType = 'full' | 'half';

// One drawable pose, as the engine and job creation see it.
export interface TryonPose {
  id: string;
  gender: Gender;
  shotType: ShotType;
  // The pose image: sent to the workflow as the person.
  r2Key: string;
  workflowTemplateId: string;
  templateVersion: number | null;
}

export const TRYON_COUNTS = [1, 3, 5] as const;
export type TryonCount = (typeof TRYON_COUNTS)[number];

// Full is always drawn first (spec 2026-10-22, decision 4).
export const TRYON_SPLIT: Record<TryonCount, Record<ShotType, number>> = {
  1: { full: 1, half: 0 },
  3: { full: 2, half: 1 },
  5: { full: 3, half: 2 },
};

const of = (pool: TryonPose[], gender: Gender, shot: ShotType) =>
  pool.filter((p) => p.gender === gender && p.shotType === shot);

/** True when the pool holds enough poses of each shot type to draw exactly `n`. */
export function canFill(pool: TryonPose[], gender: Gender, n: TryonCount): boolean {
  const need = TRYON_SPLIT[n];
  return (
    of(pool, gender, 'full').length >= need.full && of(pool, gender, 'half').length >= need.half
  );
}

/**
 * `n` distinct poses for the gender: the Full share first, then the Half share,
 * each shuffled on its own. A short category yields what exists (callers check
 * canFill first). `shuffle` works on ids so the engine's injected shuffle (and
 * a test's fixed one) can be used unchanged.
 */
export function drawTryonPoses(
  pool: TryonPose[],
  gender: Gender,
  n: TryonCount,
  shuffle: (ids: string[]) => string[],
): TryonPose[] {
  const byId = new Map(pool.map((p) => [p.id, p] as const));
  const need = TRYON_SPLIT[n];
  const pick = (shot: ShotType) =>
    shuffle(of(pool, gender, shot).map((p) => p.id))
      .slice(0, need[shot])
      .flatMap((id) => {
        const p = byId.get(id);
        return p ? [p] : [];
      });
  return [...pick('full'), ...pick('half')];
}
