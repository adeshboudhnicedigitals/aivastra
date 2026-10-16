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
  it('accepts an exact unique label (D55 — Qwen sometimes answers with the label)', () => {
    const opts = [{ id: 'gt-s', slug: 'suit-women', label: 'Two Piece Suit' }];
    expect(matchAnswer('Two Piece Suit', opts)?.id).toBe('gt-s');
  });
  it('accepts the label case-insensitively, with quote/punctuation trim', () => {
    const opts = [{ id: 'gt-s', slug: 'suit-women', label: 'Two Piece Suit' }];
    expect(matchAnswer('  "two piece suit".', opts)?.id).toBe('gt-s');
  });
  it('rejects a label shared by two options', () => {
    const opts = [
      { id: 'gt-a', slug: 'suit-a', label: 'Suit' },
      { id: 'gt-b', slug: 'suit-b', label: 'Suit' },
    ];
    expect(matchAnswer('Suit', opts)).toBeNull();
  });
  it('does not accept NONE, a sentence or nothing', () => {
    expect(matchAnswer('NONE', C)).toBeNull();
    expect(matchAnswer('This is a kurti', C)).toBeNull();
    expect(matchAnswer(null, C)).toBeNull();
    expect(matchAnswer('', C)).toBeNull();
  });
});
