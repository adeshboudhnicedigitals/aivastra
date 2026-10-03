import { describe, expect, it } from 'vitest';
import { executionTiming } from './execution-timing.js';

describe('worker-clock timing parser', () => {
  it('reads start, success and cache count', () => {
    expect(
      executionTiming(
        {
          status: {
            messages: [
              ['execution_start', { timestamp: 100 }],
              ['execution_cached', { nodes: ['1', '2'] }],
              ['execution_success', { timestamp: 900 }],
            ],
          },
        },
        5,
      ),
    ).toEqual({
      executionStartMs: 100,
      executionSuccessMs: 900,
      cachedNodeCount: 2,
      totalNodeCount: 5,
    });
  });
  it.each([
    undefined,
    [],
    [['execution_start', { timestamp: 100 }]],
    [['execution_success', { timestamp: 900 }]],
    [
      ['execution_start', { timestamp: '100' }],
      ['execution_success', { timestamp: 900 }],
    ],
  ])('omits unusable timing %j', (messages) => {
    expect(
      executionTiming({ status: { messages: messages as [string, Record<string, unknown>][] } }),
    ).toBeUndefined();
  });
});
