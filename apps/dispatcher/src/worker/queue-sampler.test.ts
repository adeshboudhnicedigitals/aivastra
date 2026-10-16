import { describe, expect, it } from 'vitest';
import { promptIds } from './queue-sampler.js';

describe('promptIds', () => {
  it('reads only the prompt id from /queue entries and never the workflow body', () => {
    const entries = [
      [0, 'prompt-a', { 1: { class_type: 'SecretNode' } }, { client_id: 'c' }, ['9']],
      [1, 'prompt-b', {}, {}, []],
    ];
    const ids = promptIds(entries);
    expect(ids).toEqual(['prompt-a', 'prompt-b']);
    expect(JSON.stringify(ids)).not.toContain('SecretNode');
  });

  it('skips malformed entries instead of throwing', () => {
    expect(promptIds([null, 'x', [1], [1, 42], [2, 'ok']])).toEqual(['ok']);
  });

  it('caps the list, so a longer queue reads as incomplete rather than silently truncated', () => {
    const many = Array.from({ length: 80 }, (_, i) => [i, `p${i}`]);
    expect(promptIds(many)).toHaveLength(50);
  });
});
