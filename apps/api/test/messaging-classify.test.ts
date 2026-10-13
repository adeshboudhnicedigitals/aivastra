import { describe, expect, it } from 'vitest';
import { matchAnswer } from '../src/modules/messaging/classify';

const C = [
  { id: 'gt-1', slug: 'full-shirt', label: 'Full shirt' },
  { id: 'gt-2', slug: 'kurti', label: 'Kurti' },
];

describe('matchAnswer', () => {
  it('matches a slug exactly', () => {
    expect(matchAnswer('kurti', C)?.id).toBe('gt-2');
  });
  it('ignores case, surrounding space, quotes and trailing punctuation', () => {
    expect(matchAnswer('  Full-Shirt.\n', C)?.id).toBe('gt-1');
    expect(matchAnswer('"kurti"', C)?.id).toBe('gt-2');
  });
  it('does not accept a label, NONE, a sentence or nothing', () => {
    expect(matchAnswer('Full shirt', C)).toBeNull();
    expect(matchAnswer('NONE', C)).toBeNull();
    expect(matchAnswer('This is a kurti', C)).toBeNull();
    expect(matchAnswer(null, C)).toBeNull();
    expect(matchAnswer('', C)).toBeNull();
  });
});
