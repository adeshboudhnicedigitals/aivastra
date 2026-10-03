import { afterEach, describe, expect, it } from 'vitest';
import { type ComfyMock, startComfyMock } from '../../test/helpers/comfy-mock.js';
import {
  deleteQueuedPrompt,
  fetchPromptQueueState,
  interruptScopedPrompt,
  submitPrompt,
} from './client.js';

let mock: ComfyMock | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});
describe('ComfyUI mock protocol assumptions (not real-worker validation)', () => {
  it('pending delete never interrupts a foreign running prompt; scoped interrupt only stops matching running prompt', async () => {
    mock = await startComfyMock();
    mock.setOptions({ completionDelayMs: 100_000 });
    const a = await submitPrompt(mock.url, 'test-key', 'a', {});
    mock.setOptions({ startDelayMs: 100_000, completionDelayMs: 100_000 });
    const b = await submitPrompt(mock.url, 'test-key', 'b', {});
    expect(await fetchPromptQueueState(mock.url, 'test-key', a.promptId)).toBe('running');
    expect(await fetchPromptQueueState(mock.url, 'test-key', b.promptId)).toBe('pending');
    await interruptScopedPrompt(mock.url, 'test-key', b.promptId, 500);
    expect(await fetchPromptQueueState(mock.url, 'test-key', a.promptId)).toBe('running');
    await deleteQueuedPrompt(mock.url, 'test-key', b.promptId, 500);
    expect(await fetchPromptQueueState(mock.url, 'test-key', b.promptId)).toBe('absent');
    await deleteQueuedPrompt(mock.url, 'test-key', a.promptId, 500);
    expect(await fetchPromptQueueState(mock.url, 'test-key', a.promptId)).toBe('running');
    await interruptScopedPrompt(mock.url, 'test-key', a.promptId, 500);
    const history = await (await fetch(`${mock.url}/history/${a.promptId}`)).json();
    expect(history[a.promptId].status.messages[0][0]).toBe('execution_interrupted');
    expect(mock.deleteCalls()).toEqual([[b.promptId], [a.promptId]]);
  });
  it('history is empty before finish, written after finish; queue and destructive failure injection is controllable', async () => {
    mock = await startComfyMock();
    mock.setOptions({
      startDelayMs: 30,
      completionDelayMs: 30,
      queueStatus: 500,
      deleteStatus: 500,
      interruptStatus: 500,
    });
    const { promptId } = await submitPrompt(mock.url, 'test-key', 'a', {});
    expect(await (await fetch(`${mock.url}/history/${promptId}`)).json()).toEqual({});
    await expect(fetchPromptQueueState(mock.url, 'test-key', promptId)).rejects.toThrow('500');
    await expect(deleteQueuedPrompt(mock.url, 'test-key', promptId, 500)).rejects.toThrow('500');
    await expect(interruptScopedPrompt(mock.url, 'test-key', promptId, 500)).rejects.toThrow('500');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const history = await (await fetch(`${mock.url}/history/${promptId}`)).json();
    expect(history[promptId].outputs).toBeDefined();
    const stats = await (await fetch(`${mock.url}/system_stats`)).json();
    expect(stats.system.comfyui_version).toBe('0.37.0');
  });
});
