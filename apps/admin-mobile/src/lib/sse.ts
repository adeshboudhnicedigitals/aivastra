export interface SSEEvent {
  event: string;
  data: string;
}

export interface SSEConnection {
  close: () => void;
}

interface SSEConnectionOptions {
  baseUrl: string;
  path: string;
  token: string;
  onEvent: (event: SSEEvent) => void;
  onError?: (error: unknown) => void;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();

    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function parseEventBlock(block: string): SSEEvent | null {
  let event = 'message';
  const data: string[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(':')) continue;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value || 'message';
    if (field === 'data') data.push(value);
  }

  return data.length > 0 ? { event, data: data.join('\n') } : null;
}

export function createSSEConnection({
  baseUrl,
  path,
  token,
  onEvent,
  onError,
}: SSEConnectionOptions): SSEConnection {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closed = false;

  async function connect(): Promise<void> {
    let backoff = INITIAL_BACKOFF_MS;

    while (!closed) {
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE connection failed with status ${response.status}`);
        }

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        backoff = INITIAL_BACKOFF_MS;

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';

          for (const block of blocks) {
            const event = parseEventBlock(block);
            if (event) onEvent(event);
          }
        }
      } catch (error) {
        if (closed || controller.signal.aborted) return;
        onError?.(error);
      } finally {
        reader = null;
      }

      if (closed) return;
      await delay(backoff, controller.signal);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  void connect();

  return {
    close() {
      if (closed) return;
      closed = true;
      controller.abort();
      void reader?.cancel();
    },
  };
}
