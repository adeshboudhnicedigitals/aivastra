import WebSocket from 'ws';

export interface ProgressUpdate {
  node: string | null;
  value: number;
  max: number;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

/**
 * Connects to ComfyUI WebSocket and waits for the given promptId to complete.
 * Calls onProgress for intermediate progress events.
 * Resolves when execution_complete; rejects on execution_error or timeout.
 */
export function waitForCompletion(
  workerUrl: string,
  clientId: string,
  clientSecret: string,
  clientUuid: string,
  promptId: string,
  timeoutMs: number = 300_000,
  onProgress?: ProgressCallback,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = workerUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsUrl}/ws?clientId=${clientUuid}`, {
      headers: {
        'CF-Access-Client-Id': clientId,
        'CF-Access-Client-Secret': clientSecret,
      },
    });

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`ComfyUI WS timeout after ${timeoutMs}ms for prompt ${promptId}`));
    }, timeoutMs);

    ws.on('message', (raw) => {
      let msg: { type: string; data?: Record<string, unknown> };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (!msg.data || (msg.data['prompt_id'] as string | undefined) !== promptId) return;

      if (msg.type === 'progress') {
        onProgress?.({
          node: (msg.data['node'] as string | null) ?? null,
          value: (msg.data['value'] as number) ?? 0,
          max: (msg.data['max'] as number) ?? 1,
        });
      } else if (msg.type === 'execution_complete') {
        clearTimeout(timer);
        ws.close();
        resolve();
      } else if (msg.type === 'execution_error') {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`ComfyUI execution_error: ${JSON.stringify(msg.data)}`));
      }
    });

    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    ws.on('close', (code) => {
      if (code !== 1000 && code !== 1005) {
        clearTimeout(timer);
        reject(new Error(`ComfyUI WS closed unexpectedly: code ${code}`));
      }
    });
  });
}
