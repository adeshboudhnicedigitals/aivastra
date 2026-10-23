import { describe, expect, it } from 'vitest';
import { decideReadiness, type ReadinessFacts } from '../src/modules/messaging/readiness';

const OK: ReadinessFacts = {
  active: true,
  requiresMannequinStep: false,
  assignedPoses: 6,
  activePoses: 6,
  hasFace: true,
  hasBackground: true,
  looksTotal: 6,
  looksUsable: 6,
};
const with_ = (over: Partial<ReadinessFacts>) => decideReadiness({ ...OK, ...over });

describe('decideReadiness', () => {
  it('ready when everything is in place', () => {
    expect(with_({})).toEqual({ status: 'ready', reasons: [] });
  });

  it.each([
    [{ active: false }, 'inactive'],
    [{ requiresMannequinStep: true }, 'mannequin_flow'],
    [{ assignedPoses: 0, activePoses: 0 }, 'no_poses'],
    [{ activePoses: 0 }, 'poses_inactive'],
  ] as const)('blocked on a structural gap %j -> %s', (over, reason) => {
    expect(with_(over)).toEqual({ status: 'blocked', reasons: [reason] });
  });

  it('a structural gap hides the facts that depend on it', () => {
    // No active pose means the face and look counts are meaningless.
    expect(with_({ activePoses: 0, hasFace: false, looksUsable: 0 }).reasons).toEqual([
      'poses_inactive',
    ]);
  });

  it('collects a missing face and missing looks together', () => {
    expect(with_({ hasFace: false, looksUsable: 0 })).toEqual({
      status: 'blocked',
      reasons: ['no_face', 'no_eligible_looks'],
    });
  });

  it('a missing background is reported like a missing face', () => {
    expect(with_({ hasBackground: false })).toEqual({
      status: 'blocked',
      reasons: ['no_background'],
    });
  });

  it('degraded when some looks were dropped but some remain', () => {
    expect(with_({ looksUsable: 2 })).toEqual({ status: 'degraded', reasons: ['looks_dropped'] });
  });

  it('no looks at all is blocked, not degraded', () => {
    expect(with_({ looksTotal: 0, looksUsable: 0 })).toEqual({
      status: 'blocked',
      reasons: ['no_eligible_looks'],
    });
  });
});
