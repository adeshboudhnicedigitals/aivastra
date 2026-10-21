import { comfyEmptyOutputTotal } from '@aivastra/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHistory } from './client.js';
import {
  classifyEmptyOutput,
  type EmptyOutputHistoryEntry,
  isTerminalJobError,
  OUTPUT_WITHHELD,
  RESULT_NODE_NOT_IN_WORKFLOW,
} from './output-withheld.js';

// A finished run whose result node '9' never produced an image. Node '5' is a different output
// that did run, so `outputs` is non-empty — the shape a gated template produces.
function entry(over: Partial<EmptyOutputHistoryEntry> = {}): EmptyOutputHistoryEntry {
  return {
    status: { status_str: 'success', messages: [['execution_cached', { nodes: ['1'] }]] },
    outputs: { '5': { images: [{ filename: 'p.png', subfolder: '', type: 'temp' }] } },
    prompt: [0, 'p1', { '1': {}, '5': {}, '9': {} }, {}, ['5', '9']],
    ...over,
  };
}

describe('classifyEmptyOutput', () => {
  it('calls it withheld when the result node was meant to run, did not, and was not cached', () => {
    expect(classifyEmptyOutput(entry(), '9')).toBe('withheld');
  });

  it('is a config error when the result node is not in the workflow that ran', () => {
    expect(classifyEmptyOutput(entry(), '42')).toBe('node_not_in_workflow');
  });

  it('is unknown without a configured result node', () => {
    expect(classifyEmptyOutput(entry(), undefined)).toBe('unknown');
  });

  it('is unknown unless the run reported success', () => {
    expect(classifyEmptyOutput(entry({ status: { status_str: 'error', messages: [] } }), '9')).toBe(
      'unknown',
    );
  });

  it('is unknown when the history carries no workflow graph', () => {
    expect(classifyEmptyOutput(entry({ prompt: undefined }), '9')).toBe('unknown');
  });

  it('is unknown when the result node was not an output ComfyUI meant to run', () => {
    expect(classifyEmptyOutput(entry({ prompt: [0, 'p1', { '9': {} }, {}, ['5']] }), '9')).toBe(
      'unknown',
    );
  });

  it('is unknown when the result node was cached', () => {
    const cached = entry({
      status: { status_str: 'success', messages: [['execution_cached', { nodes: ['9'] }]] },
    });
    expect(classifyEmptyOutput(cached, '9')).toBe('unknown');
  });

  it('is unknown when the result node ran but yielded no output-type image', () => {
    const ran = entry({ outputs: { '9': { images: [] } } });
    expect(classifyEmptyOutput(ran, '9')).toBe('unknown');
  });
});

describe('isTerminalJobError', () => {
  it('only treats the deterministic codes as terminal', () => {
    expect(isTerminalJobError(OUTPUT_WITHHELD)).toBe(true);
    expect(isTerminalJobError(RESULT_NODE_NOT_IN_WORKFLOW)).toBe(true);
    expect(isTerminalJobError('ComfyUI returned no output images')).toBe(false);
    expect(isTerminalJobError(undefined)).toBe(false);
  });
});

describe('fetchHistory with a result node', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubHistory(e: EmptyOutputHistoryEntry) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ p1: e }) }));
  }

  async function count(verdict: string) {
    const metric = await comfyEmptyOutputTotal.get();
    return metric.values.find((v) => v.labels.verdict === verdict)?.value ?? 0;
  }

  it('throws OUTPUT_WITHHELD for a gated result node and counts it', async () => {
    stubHistory(entry());
    const before = await count('withheld');
    await expect(fetchHistory('https://w', 'k', 'p1', undefined, '9')).rejects.toThrow(
      OUTPUT_WITHHELD,
    );
    expect(await count('withheld')).toBe(before + 1);
  });

  it('logs a missing result node at error level and counts it', async () => {
    stubHistory(entry());
    const log = { info: vi.fn(), error: vi.fn() };
    const before = await count('node_not_in_workflow');
    await expect(fetchHistory('https://w', 'k', 'p1', log, '42')).rejects.toThrow(
      RESULT_NODE_NOT_IN_WORKFLOW,
    );
    expect(log.error).toHaveBeenCalledOnce();
    expect(await count('node_not_in_workflow')).toBe(before + 1);
  });

  it('throws the config error when the node is not in the workflow', async () => {
    stubHistory(entry());
    await expect(fetchHistory('https://w', 'k', 'p1', undefined, '42')).rejects.toThrow(
      RESULT_NODE_NOT_IN_WORKFLOW,
    );
  });

  it('still returns an empty list when it cannot tell, so callers keep the generic error', async () => {
    stubHistory(entry({ prompt: undefined }));
    await expect(fetchHistory('https://w', 'k', 'p1', undefined, '9')).resolves.toEqual([]);
  });

  it('returns the images when the result node produced one', async () => {
    const image = { filename: 'r.png', subfolder: '', type: 'output' };
    stubHistory(entry({ outputs: { '9': { images: [image] } } }));
    await expect(fetchHistory('https://w', 'k', 'p1', undefined, '9')).resolves.toEqual([image]);
  });
});
