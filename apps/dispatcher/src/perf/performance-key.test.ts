import { describe, expect, it } from 'vitest';
import { performanceKey, promptNodeCount } from './performance-key.js';

describe('performance keys and conservative graph counting', () => {
  it('changes for in-place edits', () => {
    expect(performanceKey({ id: 't', updatedAt: new Date(10) })).toBe('t:10');
    expect(performanceKey({ id: 't', updatedAt: new Date(11) })).toBe('t:11');
  });
  it('isolates archived content from live edits', () => {
    expect(
      performanceKey({ id: 't', updatedAt: new Date(99), performanceArchivedVersion: 3 }),
    ).toBe('t:v3:archived');
  });
  it('records API-shaped candidates without claiming executable semantics', () => {
    expect(
      promptNodeCount({
        a: { class_type: 'LoadImage', inputs: {} },
        b: { class_type: 'CustomNote', inputs: {} },
        notes: { text: 'x' },
      }),
    ).toEqual({ totalNodeCount: 2, reliable: false });
  });
});
