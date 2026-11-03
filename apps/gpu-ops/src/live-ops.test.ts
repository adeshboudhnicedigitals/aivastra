import { describe, expect, it } from 'vitest';
import { parseLiveJobPage, parseLiveWorkerConfigs, parseLiveWorkerHistory } from './live-ops';

const job = {
  id: 'job-1',
  status: 'FAILED',
  workerId: 'worker-1',
  jobType: 'tryon',
  attempts: 2,
  errorCode: 'WORKER_TIMEOUT',
  createdAt: '2026-11-02T10:00:00.000Z',
  startedAt: null,
  completedAt: null,
  userEmail: null,
};

describe('live operations response parsing', () => {
  it('accepts the documented paginated jobs shape', () => {
    expect(parseLiveJobPage({ page: 1, pageSize: 25, total: 1, items: [job] }).items[0]).toEqual(
      job,
    );
  });

  it('rejects incomplete jobs instead of supplying defaults', () => {
    expect(() =>
      parseLiveJobPage({
        page: 1,
        pageSize: 25,
        total: 1,
        items: [{ ...job, attempts: undefined }],
      }),
    ).toThrow('Unexpected jobs response');
  });

  it('projects the worker list to safe, displayable configuration fields', () => {
    const [worker] = parseLiveWorkerConfigs([
      {
        id: 'worker-1',
        label: 'GPU 1',
        url: 'https://worker.invalid/path',
        apiKeyHint: '******',
        isActive: true,
        allowedJobTypes: ['tryon'],
        status: 'IDLE',
        inRegistry: true,
        healthy: true,
        queueGateEnabled: true,
        capabilities: { status: 'configured' },
        capabilityWarning: null,
        queue: null,
        routing: 'ok',
        lastSeen: 100,
        createdAt: '2026-11-02T10:00:00.000Z',
        updatedAt: '2026-11-02T10:00:00.000Z',
        comfyVersion: null,
      },
    ]);
    expect(worker).toEqual({
      id: 'worker-1',
      label: 'GPU 1',
      isActive: true,
      allowedJobTypes: ['tryon'],
      status: 'IDLE',
      inRegistry: true,
      healthy: true,
      lastSeen: 100,
    });
    expect(worker).not.toHaveProperty('url');
  });

  it('rejects malformed worker configuration', () => {
    expect(() => parseLiveWorkerConfigs([{ id: 'worker-1' }])).toThrow(
      'Unexpected worker response',
    );
  });

  it('keeps unknown history samples null and rejects malformed points', () => {
    const history = {
      workerId: 'worker-1',
      generatedAt: '2026-11-02T10:00:00.000Z',
      windowMinutes: 60,
      points: [
        {
          t: 1793613600000,
          vramUsedMb: null,
          vramTotalMb: null,
          ramUsedGb: null,
          ramTotalGb: null,
        },
      ],
    };
    expect(parseLiveWorkerHistory(history).points[0]?.vramUsedMb).toBeNull();
    expect(() =>
      parseLiveWorkerHistory({
        ...history,
        points: [{ ...history.points[0], ramUsedGb: 'unknown' }],
      }),
    ).toThrow('Unexpected worker history response');
  });
});
