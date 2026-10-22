import { describe, expect, it } from 'vitest';
import {
  canFill,
  drawTryonPoses,
  TRYON_COUNTS,
  TRYON_SPLIT,
  type TryonPose,
} from '../src/modules/messaging/engine/tryon-rules';

const pose = (
  id: string,
  gender: TryonPose['gender'],
  shotType: TryonPose['shotType'],
): TryonPose => ({
  id,
  gender,
  shotType,
  r2Key: `${id}.jpg`,
  workflowTemplateId: 'wf',
  templateVersion: 1,
});

const men = [
  pose('f1', 'men', 'full'),
  pose('f2', 'men', 'full'),
  pose('f3', 'men', 'full'),
  pose('h1', 'men', 'half'),
  pose('h2', 'men', 'half'),
  pose('w1', 'women', 'full'),
];
const keep = (ids: string[]) => ids; // deterministic "shuffle"
const reverse = (ids: string[]) => [...ids].reverse();

describe('tryon rules', () => {
  it('splits are Full-first with no Back', () => {
    expect(TRYON_COUNTS).toEqual([1, 3, 5]);
    expect(TRYON_SPLIT[1]).toEqual({ full: 1, half: 0 });
    expect(TRYON_SPLIT[3]).toEqual({ full: 2, half: 1 });
    expect(TRYON_SPLIT[5]).toEqual({ full: 3, half: 2 });
  });

  it('canFill needs enough poses of each shot type for that gender', () => {
    expect(canFill(men, 'men', 5)).toBe(true);
    expect(canFill(men, 'women', 1)).toBe(true);
    expect(canFill(men, 'women', 3)).toBe(false); // one Full, no Half
    expect(canFill(men, 'boys', 1)).toBe(false);
  });

  it('draws the split for the tapped gender only, Full first', () => {
    const drawn = drawTryonPoses(men, 'men', 5, keep);
    expect(drawn.map((p) => p.id)).toEqual(['f1', 'f2', 'f3', 'h1', 'h2']);
    expect(drawTryonPoses(men, 'men', 3, keep).map((p) => p.id)).toEqual(['f1', 'f2', 'h1']);
    expect(drawTryonPoses(men, 'men', 1, keep).map((p) => p.id)).toEqual(['f1']);
  });

  it('uses the injected shuffle within each category and never repeats a pose', () => {
    const drawn = drawTryonPoses(men, 'men', 3, reverse);
    expect(drawn.map((p) => p.id)).toEqual(['f3', 'f2', 'h2']);
    expect(new Set(drawn.map((p) => p.id)).size).toBe(drawn.length);
  });

  it('takes what exists when a category is short', () => {
    expect(drawTryonPoses(men, 'women', 3, keep).map((p) => p.id)).toEqual(['w1']);
  });
});
