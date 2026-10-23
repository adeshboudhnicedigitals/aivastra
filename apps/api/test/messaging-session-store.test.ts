import { describe, expect, it } from 'vitest';
import { loadSession } from '../src/modules/messaging/session-store';

const redisWith = (value: unknown) =>
  ({ get: async () => JSON.stringify(value) }) as unknown as Parameters<typeof loadSession>[0];
const base = {
  v: 1,
  nonce: 'n1',
  page: 0,
  aspectRatio: '3:4',
  resolution: 'HD',
  photos: {},
  picked: [],
};

describe('loadSession: sessions saved by the card-picking flow', () => {
  it('reads PICK_LOOKS as the pose count question and drops the old recognition ticket', async () => {
    const s = await loadSession(
      redisWith({ ...base, state: 'PICK_LOOKS', recognition: { requestId: 'r' } }),
      'whatsapp',
      '1',
    );
    expect(s?.state).toBe('ASK_POSE_COUNT');
    expect(s).not.toHaveProperty('recognition');
    // Old buttons carry n1: a changed nonce sends their tap down the stale path.
    expect(s?.nonce).not.toBe('n1');
  });

  it('reads CONFIRM_GARMENT_TYPE as the garment-type list', async () => {
    const s = await loadSession(
      redisWith({ ...base, state: 'CONFIRM_GARMENT_TYPE' }),
      'whatsapp',
      '1',
    );
    expect(s?.state).toBe('ASK_GARMENT_TYPE');
    expect(s?.nonce).not.toBe('n1');
  });

  it('leaves current states alone', async () => {
    const s = await loadSession(redisWith({ ...base, state: 'ASK_GENDER' }), 'whatsapp', '1');
    expect(s?.state).toBe('ASK_GENDER');
    expect(s?.nonce).toBe('n1');
  });
});
