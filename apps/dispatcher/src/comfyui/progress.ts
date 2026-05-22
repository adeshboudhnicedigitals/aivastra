export interface ProgressUpdate {
  node: string | null;
  value: number;
  max: number;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

/**
 * Polls /history/{promptId} every 3s until outputs appear or timeout.
 * More reliable than WebSocket for production use.
 */
export async function waitForCompletion(
  workerUrl: string,
  apiKey: string,
  _clientUuid: string,
  promptId: string,
  timeoutMs: number = 300_000,
  _onProgress?: ProgressCallback,
  log?: { info: (obj: unknown, msg: string) => void; debug: (obj: unknown, msg: string) => void },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `${workerUrl}/history/${promptId}`;
  log?.info({ url, promptId }, 'polling ComfyUI /history for completion');

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));

    const res = await fetch(url, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log?.debug({ status: res.status }, 'ComfyUI /history not ready yet');
      continue;
    }

    const history = await res.json() as Record<string, unknown>;
    const entry = history[promptId] as { outputs?: Record<string, unknown>; status?: { status_str?: string } } | undefined;

    if (entry?.status?.status_str === 'error') {
      throw new Error(`ComfyUI execution error for prompt ${promptId}`);
    }

    if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
      log?.info({ promptId }, 'ComfyUI generation complete');
      return;
    }

    log?.debug({ promptId }, 'ComfyUI still generating…');
  }

  throw new Error(`ComfyUI history polling timeout after ${timeoutMs}ms for prompt ${promptId}`);
}
