import { describe, expect, it } from 'vitest';
import { fixtureSnapshot } from './fixtures';
import { canSimulate, creationError, processReducer, seedProcesses } from './process-demo';

const at = '2026-10-12T10:00:00Z';
describe('browser-only instance simulation', () => {
  it('requires a stopped instance for start and prevents duplicate actions in flight', () => {
    let state = seedProcesses(fixtureSnapshot);
    const running = state.instances[0];
    expect(canSimulate(running, 'START')).toBe(false);
    state = processReducer(state, {
      type: 'REQUEST',
      id: running.id,
      action: 'STOP',
      at,
      eventId: 'stop',
    });
    expect(state.instances[0].status).toBe('DRAINING');
    expect(canSimulate(state.instances[0], 'RESTART')).toBe(false);
    state = processReducer(state, { type: 'COMPLETE', id: running.id, at, eventId: 'done' });
    expect(state.instances[0].status).toBe('STOPPED');
    expect(canSimulate(state.instances[0], 'START')).toBe(true);
    state = processReducer(state, {
      type: 'REQUEST',
      id: running.id,
      action: 'START',
      at,
      eventId: 'start',
    });
    expect(state.instances[0].status).toBe('STARTING');
    state = processReducer(state, { type: 'COMPLETE', id: running.id, at, eventId: 'started' });
    expect(state.instances[0].status).toBe('RUNNING');
  });
  it('changes only the selected instance on a shared GPU and preserves fleet fixtures', () => {
    const before = structuredClone(fixtureSnapshot);
    const state = seedProcesses(fixtureSnapshot);
    const target = state.instances.find((instance) => instance.workerId === 'worker-6');
    if (!target) throw new Error('Missing shared-GPU fixture');
    const next = processReducer(state, {
      type: 'REQUEST',
      id: target.id,
      action: 'KILL',
      at,
      eventId: 'kill',
    });
    expect(next.instances.find((instance) => instance.id === target.id)?.status).toBe('STOPPED');
    expect(
      next.instances.find((instance) => instance.workerId === 'worker-6-secondary')?.status,
    ).toBe('RUNNING');
    expect(next.history[0].detail).toContain('No real process or job');
    expect(fixtureSnapshot).toEqual(before);
    expect(state.instances.find((instance) => instance.id === target.id)?.status).toBe('RUNNING');
  });
  it('returns restarted instances to running and disables unknown-state actions', () => {
    let state = seedProcesses(fixtureSnapshot);
    const target = state.instances[0];
    state = processReducer(state, {
      type: 'REQUEST',
      id: target.id,
      action: 'RESTART',
      at,
      eventId: 'restart',
    });
    expect(state.instances[0].status).toBe('RESTARTING');
    state = processReducer(state, { type: 'COMPLETE', id: target.id, at, eventId: 'done' });
    expect(state.instances[0].status).toBe('RUNNING');
    const unknown = state.instances.find((instance) => instance.status === 'UNKNOWN');
    if (!unknown) throw new Error('Missing unknown fixture');
    for (const action of ['START', 'STOP', 'RESTART', 'KILL'] as const)
      expect(canSimulate(unknown, action)).toBe(false);
  });
  it('validates port collisions per host, duplicate names, GPU mapping and port bounds', () => {
    const state = seedProcesses(fixtureSnapshot);
    const draft = { name: 'preview-new', hostId: 'host-1', gpuId: 'gpu-1', port: 8190 };
    expect(creationError(draft, state, fixtureSnapshot)).toBeNull();
    expect(creationError({ ...draft, port: 8188 }, state, fixtureSnapshot)).toContain('port');
    expect(creationError({ ...draft, name: 'WORKER-1' }, state, fixtureSnapshot)).toContain('name');
    expect(creationError({ ...draft, gpuId: 'gpu-2' }, state, fixtureSnapshot)).toContain('GPU');
    for (const port of [0, 1023, 65536, 8190.5, Number.NaN])
      expect(creationError({ ...draft, port }, state, fixtureSnapshot)).toContain('port');
  });
  it('creates stopped unregistered drafts and resets preview history', () => {
    const state = seedProcesses(fixtureSnapshot);
    const instance = {
      ...state.instances[0],
      id: 'new',
      name: 'preview-new',
      port: 8190,
      workerId: null,
      status: 'STOPPED' as const,
    };
    const created = processReducer(state, { type: 'CREATE', instance, at, eventId: 'created' });
    expect(created.instances).toHaveLength(10);
    expect(created.instances[9].workerId).toBeNull();
    expect(created.history[0].detail).toContain('no worker registered');
    expect(
      processReducer(created, {
        type: 'CREATE',
        instance: { ...instance, id: 'other' },
        at,
        eventId: 'duplicate',
      }),
    ).toBe(created);
    const reset = processReducer(created, { type: 'RESET', snapshot: fixtureSnapshot });
    expect(reset.instances).toHaveLength(9);
    expect(reset.history).toHaveLength(0);
  });
});
