import type { FleetSnapshot } from './contracts';

export type ProcessAction = 'START' | 'STOP' | 'RESTART' | 'KILL';
export type ProcessStatus =
  | 'RUNNING'
  | 'STOPPED'
  | 'UNKNOWN'
  | 'STARTING'
  | 'DRAINING'
  | 'RESTARTING';
export type DemoInstance = {
  id: string;
  name: string;
  hostId: string;
  gpuId: string;
  workerId: string | null;
  port: number;
  profile: 'Standard' | 'Low VRAM';
  status: ProcessStatus;
  pending: ProcessAction | null;
};
export type ProcessDemo = {
  instances: DemoInstance[];
  history: {
    id: string;
    at: string;
    instance: string;
    action: string;
    detail: string;
    actor?: string;
    workerId?: string;
  }[];
};
export function seedProcesses(snapshot: FleetSnapshot): ProcessDemo {
  return {
    instances: snapshot.workers.map((worker) => ({
      id: `demo-${worker.workerId}`,
      name: worker.workerId,
      hostId: worker.hostId,
      gpuId: worker.gpuId,
      workerId: worker.workerId,
      port: worker.workerId.endsWith('secondary') ? 8189 : 8188,
      profile: 'Standard',
      status: !worker.active ? 'STOPPED' : worker.comfy.reachable === true ? 'RUNNING' : 'UNKNOWN',
      pending: null,
    })),
    history: [],
  };
}
export function canSimulate(instance: DemoInstance, action: ProcessAction) {
  if (instance.pending) return false;
  return action === 'START' ? instance.status === 'STOPPED' : instance.status === 'RUNNING';
}
export function creationError(
  draft: Pick<DemoInstance, 'name' | 'hostId' | 'gpuId' | 'port'>,
  state: ProcessDemo,
  snapshot: FleetSnapshot,
): string | null {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,47}$/.test(draft.name))
    return 'Use 2–48 letters, numbers, hyphens or underscores for the instance name.';
  if (state.instances.some((instance) => instance.name.toLowerCase() === draft.name.toLowerCase()))
    return 'An instance with this name already exists.';
  if (
    !snapshot.hosts.some((host) => host.id === draft.hostId) ||
    !snapshot.gpus.some((gpu) => gpu.id === draft.gpuId && gpu.hostId === draft.hostId)
  )
    return 'Choose a GPU belonging to the selected host.';
  if (!Number.isInteger(draft.port) || draft.port < 1024 || draft.port > 65535)
    return 'Choose a port from 1024 to 65535.';
  if (
    state.instances.some(
      (instance) => instance.hostId === draft.hostId && instance.port === draft.port,
    )
  )
    return 'This port is already assigned on that host, including stopped instances.';
  return null;
}
export type DemoEvent =
  | { type: 'REQUEST'; id: string; action: ProcessAction; at: string; eventId: string }
  | { type: 'COMPLETE'; id: string; at: string; eventId: string }
  | { type: 'CREATE'; instance: DemoInstance; at: string; eventId: string }
  | {
      type: 'CONFIGURE';
      instance: DemoInstance;
      at: string;
      eventId: string;
      actor: string;
      reason: string;
    }
  | { type: 'RESET'; snapshot: FleetSnapshot };
// A browser-only preview reducer. It has no command transport and never edits fleet observations.
export function processReducer(state: ProcessDemo, event: DemoEvent): ProcessDemo {
  if (event.type === 'RESET') return seedProcesses(event.snapshot);
  if (event.type === 'CONFIGURE') {
    const previous = state.instances.find((item) => item.id === event.instance.id);
    if (
      previous?.status !== 'STOPPED' ||
      previous.pending ||
      !event.actor.trim() ||
      !event.reason.trim() ||
      state.instances.some(
        (item) =>
          item.id !== previous.id &&
          (item.name.toLowerCase() === event.instance.name.toLowerCase() ||
            (item.hostId === event.instance.hostId && item.port === event.instance.port)),
      )
    )
      return state;
    return {
      instances: state.instances.map((item) =>
        item.id === previous.id
          ? {
              ...event.instance,
              id: previous.id,
              workerId: previous.workerId,
              status: 'STOPPED',
              pending: null,
            }
          : item,
      ),
      history: [
        {
          id: event.eventId,
          at: event.at,
          instance: event.instance.name,
          workerId: previous.workerId ?? undefined,
          action: 'CONFIGURE',
          actor: event.actor,
          detail: `Demo configuration saved by ${event.actor}: ${event.reason}. No files or processes changed.`,
        },
        ...state.history,
      ],
    };
  }
  if (event.type === 'CREATE') {
    if (
      state.instances.some(
        (item) =>
          item.id === event.instance.id ||
          item.name.toLowerCase() === event.instance.name.toLowerCase() ||
          (item.hostId === event.instance.hostId && item.port === event.instance.port),
      )
    )
      return state;
    return {
      instances: [...state.instances, event.instance],
      history: [
        {
          id: event.eventId,
          at: event.at,
          instance: event.instance.name,
          workerId: event.instance.workerId ?? undefined,
          action: 'CREATE',
          detail: 'Demo instance created stopped; no worker registered and no command executed.',
        },
        ...state.history,
      ],
    };
  }
  const instance = state.instances.find((item) => item.id === event.id);
  if (!instance) return state;
  if (event.type === 'REQUEST') {
    if (!canSimulate(instance, event.action)) return state;
    const status = { START: 'STARTING', STOP: 'DRAINING', RESTART: 'RESTARTING', KILL: 'STOPPED' }[
      event.action
    ] as ProcessStatus;
    return {
      instances: state.instances.map((item) =>
        item.id !== event.id
          ? item
          : { ...item, status, pending: event.action === 'KILL' ? null : event.action },
      ),
      history: [
        {
          id: event.eventId,
          at: event.at,
          instance: instance.name,
          workerId: instance.workerId ?? undefined,
          action: event.action,
          detail:
            event.action === 'KILL'
              ? 'Force stop simulated. No real process or job was affected.'
              : 'Simulation requested. No command executed.',
        },
        ...state.history,
      ],
    };
  }
  if (!instance.pending) return state;
  return {
    instances: state.instances.map((item) =>
      item.id !== event.id
        ? item
        : { ...item, status: item.pending === 'STOP' ? 'STOPPED' : 'RUNNING', pending: null },
    ),
    history: [
      {
        id: event.eventId,
        at: event.at,
        instance: instance.name,
        workerId: instance.workerId ?? undefined,
        action: `${instance.pending} COMPLETE`,
        detail: 'Preview transition completed. Fleet telemetry and job records are unchanged.',
      },
      ...state.history,
    ],
  };
}
