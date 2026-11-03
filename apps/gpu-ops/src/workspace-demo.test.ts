import { describe, expect, it } from 'vitest';
import { fixtureSnapshot } from './fixtures';
import { processReducer, seedProcesses } from './process-demo';
import {
  canCancel,
  canRetry,
  captureComplete,
  captureFixtures,
  draftInventoryError,
  seedWorkspace,
  workspaceReducer,
} from './workspace-demo';

const entry = (target: string, action: string) => ({
  id: `${target}-${action}`,
  at: '2026-10-12T11:00:00Z',
  target,
  action,
  actor: 'Demo tester',
  note: 'Synthetic review',
});
describe('job queue preview', () => {
  it('protects foreign work and cancels only an active owned attempt', () => {
    const state = seedWorkspace(fixtureSnapshot);
    const foreign = state.jobs.find((job) => job.ownership === 'FOREIGN');
    if (!foreign) throw new Error('Missing foreign fixture');
    expect(canCancel(foreign)).toBe(false);
    expect(
      workspaceReducer(state, {
        type: 'CANCEL',
        id: foreign.id,
        entry: entry(foreign.id, 'CANCEL_JOB'),
      }),
    ).toBe(state);
    const cancelled = workspaceReducer(state, {
      type: 'CANCEL',
      id: 'demo-job-021',
      entry: entry('demo-job-021', 'CANCEL_JOB'),
    });
    expect(cancelled.jobs.find((job) => job.id === 'demo-job-021')?.status).toBe('CANCELLED');
    expect(state.jobs.find((job) => job.id === 'demo-job-021')?.status).toBe('RUNNING');
  });
  it('creates a distinct retry, rejects duplicates and preserves original outcome', () => {
    const state = seedWorkspace(fixtureSnapshot);
    const event = {
      type: 'RETRY' as const,
      data: fixtureSnapshot,
      id: 'demo-job-018',
      newId: 'retry-1',
      workerId: 'worker-1',
      entry: entry('demo-job-018', 'RETRY_JOB'),
    };
    const next = workspaceReducer(state, event);
    expect(next.jobs.find((job) => job.id === 'retry-1')).toMatchObject({
      status: 'QUEUED',
      retryOf: 'demo-job-018',
      attempt: 2,
      promptId: null,
      executionMs: null,
    });
    const failed = next.jobs.find((job) => job.id === 'demo-job-018');
    if (!failed) throw new Error('Missing original attempt');
    expect(failed.status).toBe('FAILED');
    expect(canRetry(failed, next.jobs)).toBe(false);
    expect(workspaceReducer(next, { ...event, newId: 'retry-2' })).toBe(next);
    expect(workspaceReducer(state, { ...event, workerId: 'worker-5' })).toBe(state);
  });
});
describe('inventory drafts and evidence annotations', () => {
  it('validates mappings and unknown versus zero metadata', () => {
    const state = seedWorkspace(fixtureSnapshot);
    expect(draftInventoryError(state)).toBeNull();
    state.hosts[0].monthlyCostUsd = 0;
    expect(draftInventoryError(state)).toBeNull();
    state.hosts[0].monthlyCostUsd = Number.NaN;
    expect(draftInventoryError(state)).toContain('cost');
    state.hosts[0].monthlyCostUsd = null;
    state.workers[0].gpuId = 'gpu-2';
    expect(draftInventoryError(state)).toContain('map');
  });
  it('edits a cloned inventory without changing source telemetry or physical counts', () => {
    const before = structuredClone(fixtureSnapshot);
    const state = seedWorkspace(fixtureSnapshot);
    const draft = structuredClone({ hosts: state.hosts, gpus: state.gpus, workers: state.workers });
    draft.hosts[0].label = 'Draft VPS';
    draft.workers[0].hostId = 'host-2';
    draft.workers[0].gpuId = 'gpu-2';
    const next = workspaceReducer(state, {
      type: 'INVENTORY',
      draft,
      entry: entry('host-1', 'EDIT_HOST'),
    });
    expect(next.hosts[0].label).toBe('Draft VPS');
    expect(next.gpus).toHaveLength(8);
    expect(state.hosts[0].label).toBe('VPS 01');
    expect(fixtureSnapshot).toEqual(before);
  });
  it('does not convert incomplete or truncated evidence into all-OK after review', () => {
    const before = structuredClone(captureFixtures);
    let state = seedWorkspace(fixtureSnapshot);
    expect(captureComplete(captureFixtures[0])).toBe(true);
    expect(captureComplete(captureFixtures[1])).toBe(false);
    expect(captureComplete(captureFixtures[2])).toBe(false);
    expect(captureComplete({ ...captureFixtures[0], coverage: { time: 'OK' } })).toBe(false);
    state = workspaceReducer(state, {
      type: 'REVIEW',
      id: captureFixtures[1].id,
      entry: entry(captureFixtures[1].id, 'EVIDENCE_REVIEW'),
    });
    expect(state.reviews[captureFixtures[1].id].owner).toBe('Demo tester');
    expect(captureFixtures).toEqual(before);
    expect(captureComplete(captureFixtures[1])).toBe(false);
  });
  it('resets one workspace area while retaining unrelated state and audit records', () => {
    let state = seedWorkspace(fixtureSnapshot);
    state = workspaceReducer(state, {
      type: 'RESOLUTION',
      id: 'host-3',
      entry: entry('host-3', 'RECONCILIATION_NOTE'),
    });
    state = workspaceReducer(state, {
      type: 'CANCEL',
      id: 'demo-job-021',
      entry: entry('demo-job-021', 'CANCEL_JOB'),
    });
    state = workspaceReducer(state, {
      type: 'RESET_QUEUE',
      data: fixtureSnapshot,
      entry: entry('queue', 'RESET_QUEUE'),
    });
    expect(state.jobs.find((job) => job.id === 'demo-job-021')?.status).toBe('RUNNING');
    expect(state.resolutions['host-3']).toBeDefined();
    expect(state.history).toHaveLength(3);
  });
});
describe('configuration preview', () => {
  it('only changes stopped instances and preserves linked worker identity', () => {
    const state = seedProcesses(fixtureSnapshot);
    const running = state.instances[0];
    const at = fixtureSnapshot.asOf;
    expect(
      processReducer(state, {
        type: 'CONFIGURE',
        instance: { ...running, port: 8200 },
        at,
        eventId: 'edit',
        actor: 'Tester',
        reason: 'Test',
      }),
    ).toBe(state);
    const stopped = state.instances[6];
    const next = processReducer(state, {
      type: 'CONFIGURE',
      instance: { ...stopped, port: 8200, name: 'renamed-preview', workerId: 'spoofed' },
      at,
      eventId: 'edit2',
      actor: 'Tester',
      reason: 'Test',
    });
    expect(next.instances[6]).toMatchObject({
      port: 8200,
      name: 'renamed-preview',
      workerId: stopped.workerId,
      status: 'STOPPED',
    });
    expect(next.history[0].actor).toBe('Tester');
  });
});
