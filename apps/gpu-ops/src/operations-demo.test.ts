import { describe, expect, it } from 'vitest';
import { fixtureSnapshot } from './fixtures';
import type { Maintenance, OperationEntry } from './operations-demo';
import {
  incidentPreview,
  operationsReducer,
  reservationError,
  seedOperations,
  windowError,
} from './operations-demo';

const now = '2026-10-12T10:00:00Z';
const entry = (action: string, target = 'worker-1'): OperationEntry => ({
  id: `${action}-${target}`,
  at: now,
  target,
  actor: 'Demo tester',
  action,
  note: 'Preview review',
});
const maintenance: Maintenance = {
  id: 'maintenance-1',
  workerId: 'worker-1',
  owner: 'Demo tester',
  reason: 'Preview',
  from: '2026-10-12T11:00:00Z',
  until: '2026-10-12T12:00:00Z',
  state: 'SCHEDULED',
};
describe('operations session preview', () => {
  it('validates future maintenance and reservation times', () => {
    expect(windowError(maintenance.from, maintenance.until, now)).toBeNull();
    expect(windowError(now, maintenance.until, now)).toContain('future');
    expect(windowError(maintenance.until, maintenance.from, now)).toContain('after');
    expect(windowError('invalid', maintenance.until, now)).toContain('valid');
    expect(reservationError(now, now)).toContain('future');
    expect(reservationError(maintenance.until, now)).toBeNull();
  });
  it('reserves and releases without overwriting someone else’s reservation', () => {
    let state = seedOperations(fixtureSnapshot);
    const reservation = { owner: 'Demo tester', reason: 'Review', until: maintenance.until };
    state = operationsReducer(state, { type: 'RESERVE', entry: entry('RESERVE'), reservation });
    expect(state.reservations['worker-1']).toEqual(reservation);
    expect(
      operationsReducer(state, {
        type: 'RESERVE',
        entry: entry('RESERVE'),
        reservation: { ...reservation, owner: 'Other' },
      }),
    ).toBe(state);
    state = operationsReducer(state, { type: 'RELEASE', entry: entry('RELEASE') });
    expect(state.reservations['worker-1']).toBeNull();
    expect(state.history).toHaveLength(2);
  });
  it('keeps routing intent separate from shared-GPU siblings and dispatcher observations', () => {
    const original = structuredClone(fixtureSnapshot);
    let state = seedOperations(fixtureSnapshot);
    state = operationsReducer(state, { type: 'DRAIN', entry: entry('DRAIN', 'worker-6') });
    expect(state.routing['worker-6']).toBe('DRAINING');
    expect(state.routing['worker-6-secondary']).toBeUndefined();
    state = operationsReducer(state, { type: 'RESUME', entry: entry('RESUME', 'worker-6') });
    expect(state.routing['worker-6']).toBe('RESUMED');
    expect(fixtureSnapshot).toEqual(original);
  });
  it('rejects overlapping maintenance and preserves cancellation history', () => {
    let state = seedOperations(fixtureSnapshot);
    state = operationsReducer(state, { type: 'SCHEDULE', entry: entry('SCHEDULE'), maintenance });
    const overlap = { ...maintenance, id: 'maintenance-2', from: '2026-10-12T11:30:00Z' };
    expect(
      operationsReducer(state, {
        type: 'SCHEDULE',
        entry: entry('SCHEDULE'),
        maintenance: overlap,
      }),
    ).toBe(state);
    state = operationsReducer(state, {
      type: 'CANCEL_MAINTENANCE',
      entry: entry('CANCEL_MAINTENANCE'),
      id: maintenance.id,
    });
    expect(state.maintenance[0].state).toBe('CANCELLED');
    state = operationsReducer(state, {
      type: 'SCHEDULE',
      entry: entry('SCHEDULE'),
      maintenance: overlap,
    });
    expect(state.maintenance).toHaveLength(2);
  });
  it('acknowledges and annotates without modifying evidence, classification or recovered state', () => {
    let state = seedOperations(fixtureSnapshot);
    const incident = fixtureSnapshot.incidents[0];
    state = operationsReducer(state, { type: 'ACK', entry: entry('ACK', incident.id) });
    state = operationsReducer(state, {
      type: 'NOTE',
      entry: { ...entry('NOTE', incident.id), note: '<script>plain text</script>' },
    });
    const view = incidentPreview(incident, state);
    expect(view.state).toBe('ACK');
    expect(view.classification).toBe(incident.classification);
    expect(view.evidence).toEqual(incident.evidence);
    expect(view.notes.at(-1)).toContain('<script>plain text</script>');
    expect(view.audit).toHaveLength(incident.audit.length + 2);
    expect(incident.state).toBe('OPEN');
    const recovered = fixtureSnapshot.incidents[3];
    state = operationsReducer(state, { type: 'ACK', entry: entry('ACK', recovered.id) });
    expect(incidentPreview(recovered, state).state).toBe('RECOVERED');
  });
  it('requires an actor and reason, and resets all local overlays', () => {
    let state = seedOperations(fixtureSnapshot);
    expect(
      operationsReducer(state, { type: 'DRAIN', entry: { ...entry('DRAIN'), note: '  ' } }),
    ).toBe(state);
    state = operationsReducer(state, { type: 'DRAIN', entry: entry('DRAIN') });
    state = operationsReducer(state, { type: 'RESET', data: fixtureSnapshot });
    expect(state.history).toHaveLength(0);
    expect(state.routing).toEqual({});
    expect(state.incidents).toEqual({});
    expect(state.reservations['worker-4']?.owner).toBe('Demo operator');
  });
});
