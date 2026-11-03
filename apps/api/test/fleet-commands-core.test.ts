import { describe, expect, it } from 'vitest';
import { type CommandContext, checkCommand } from '../src/modules/fleet/commands-core';

const idle = { running: 0, pending: 0 };
const base = (over: Partial<CommandContext> = {}): CommandContext => ({
  dispatcherStatus: 'DRAINING',
  reserved: false,
  dispatcherQueue: idle,
  agentQueue: idle,
  ...over,
});
const reason = (v: ReturnType<typeof checkCommand>) => (v.ok ? '' : v.reason);

describe('checkCommand: shared safety rules', () => {
  for (const kind of ['restart_comfyui', 'clear_queue'] as const) {
    const q = { running: 0, pending: 2 };
    const ctx = (over: Partial<CommandContext> = {}) =>
      base({
        dispatcherQueue: kind === 'clear_queue' ? q : idle,
        agentQueue: kind === 'clear_queue' ? q : idle,
        ...over,
      });

    it(`${kind}: allowed on a drained, unreserved worker`, () => {
      expect(checkCommand(kind, ctx()).ok).toBe(true);
    });
    it(`${kind}: refused when the dispatcher does not know the worker`, () => {
      expect(checkCommand(kind, ctx({ dispatcherStatus: null })).ok).toBe(false);
    });
    it(`${kind}: refused unless the worker is drained, whatever else its status is`, () => {
      for (const status of ['IDLE', 'BUSY', 'UNKNOWN']) {
        const v = checkCommand(kind, ctx({ dispatcherStatus: status }));
        expect(v.ok, status).toBe(false);
        expect(reason(v)).toMatch(/drain/i);
      }
    });
    it(`${kind}: refused while a reservation holds the worker`, () => {
      const v = checkCommand(kind, ctx({ reserved: true }));
      expect(v.ok).toBe(false);
      expect(reason(v)).toMatch(/reservation/i);
    });
  }
});

describe('checkCommand: restart_comfyui', () => {
  it('needs both observers to have answered', () => {
    expect(checkCommand('restart_comfyui', base({ dispatcherQueue: null })).ok).toBe(false);
    expect(checkCommand('restart_comfyui', base({ agentQueue: null })).ok).toBe(false);
    expect(
      checkCommand('restart_comfyui', base({ agentQueue: { running: null, pending: 0 } })).ok,
    ).toBe(false);
  });
  it('is refused if either observer sees running or pending work, and says how much', () => {
    const v = checkCommand('restart_comfyui', base({ agentQueue: { running: 1, pending: 0 } }));
    expect(v.ok).toBe(false);
    expect(reason(v)).toMatch(/1 running/);
    expect(
      checkCommand('restart_comfyui', base({ dispatcherQueue: { running: 0, pending: 3 } })).ok,
    ).toBe(false);
  });
});

describe('checkCommand: clear_queue', () => {
  it('is refused when nobody has a fresh reading', () => {
    expect(checkCommand('clear_queue', base({ dispatcherQueue: null, agentQueue: null })).ok).toBe(
      false,
    );
  });
  it('is refused when the queue is empty, and allowed when either side sees pending work', () => {
    expect(checkCommand('clear_queue', base()).ok).toBe(false);
    expect(
      checkCommand(
        'clear_queue',
        base({ dispatcherQueue: null, agentQueue: { running: 0, pending: 1 } }),
      ).ok,
    ).toBe(true);
  });
  it('leaves a running prompt alone: running work does not block clearing pending', () => {
    expect(
      checkCommand(
        'clear_queue',
        base({
          agentQueue: { running: 1, pending: 2 },
          dispatcherQueue: { running: 1, pending: 2 },
        }),
      ).ok,
    ).toBe(true);
  });
});
