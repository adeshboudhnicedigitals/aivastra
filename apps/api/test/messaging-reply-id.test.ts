import { describe, expect, it } from 'vitest';
import { decodeReplyId, encodeReplyId } from '../src/modules/messaging/engine/reply-id';

describe('reply ids', () => {
  it('round-trips nonce, action and value', () => {
    const id = encodeReplyId('n1', 'look', '6f1c3b2a-0000-4000-8000-000000000001');
    expect(decodeReplyId(id)).toEqual({
      nonce: 'n1',
      action: 'look',
      value: '6f1c3b2a-0000-4000-8000-000000000001',
    });
  });
  it('allows an empty value', () => {
    expect(decodeReplyId(encodeReplyId('n1', 'change'))).toEqual({
      nonce: 'n1',
      action: 'change',
      value: '',
    });
  });
  it('rejects ids it did not make', () => {
    expect(decodeReplyId('hello')).toBeNull();
    expect(decodeReplyId('a|b|c|d')).toBeNull();
  });
});
