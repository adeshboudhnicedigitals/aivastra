/**
 * Fetch-based SSE client.
 *
 * Native EventSource doesn't support custom headers (no Authorization),
 * so we use fetch + ReadableStream instead. This gives us full control
 * over auth, reconnect logic, and parsing.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const BACKOFF_FACTOR = 2;
const RESET_DELAY_AFTER_MS = 10_000; // reset backoff if we received data recently

export interface SSEEvent<T = unknown> {
  type: string;
  data: T;
}

export interface SSEConnection {
  close(): void;
}

export type SSEState = 'connecting' | 'connected' | 'reconnecting';

function getToken(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
  return m?.[1] !== undefined ? decodeURIComponent(m[1]) : null;
}

async function tryRefreshToken(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST' });
    if (!res.ok) return null;
    const { accessToken } = (await res.json()) as { accessToken: string };
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `access_token=${encodeURIComponent(accessToken)}; path=/; max-age=900; SameSite=Lax${secure}`;
    return accessToken;
  } catch {
    return null;
  }
}

function parseSSEBlocks<T>(text: string, onEvent: (e: SSEEvent<T>) => void): void {
  for (const block of text.split('\n\n')) {
    let eventType = 'message';
    let dataLine = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
      // comment lines starting with ':' are heartbeats — skip
    }
    if (!dataLine) continue;
    try {
      onEvent({ type: eventType, data: JSON.parse(dataLine) as T });
    } catch {
      /* ignore malformed data */
    }
  }
}

export function createSSEConnection<T = unknown>(
  path: string,
  onEvent: (e: SSEEvent<T>) => void,
  onError?: (err: Error) => void,
  onStateChange?: (state: SSEState) => void,
): SSEConnection {
  let closed = false;
  let controller: AbortController | null = null;
  let retryDelay = INITIAL_DELAY_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDataAt = 0;

  async function connect(): Promise<void> {
    if (closed) return;
    onStateChange?.('connecting');
    controller = new AbortController();

    try {
      let token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      let res = await fetch(`${API_URL}${path}`, {
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      if (res.status === 401) {
        token = await tryRefreshToken();
        if (!token) {
          // Session expired — stop reconnecting, redirect handled by app
          closed = true;
          return;
        }
        res = await fetch(`${API_URL}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
          signal: controller.signal,
        });
      }

      if (!res.ok || !res.body) {
        throw new Error(`SSE ${res.status}`);
      }

      // Successful connection — if we received data recently, reset the backoff
      if (Date.now() - lastDataAt < RESET_DELAY_AFTER_MS) retryDelay = INITIAL_DELAY_MS;

      const reader = res.body.getReader();
      onStateChange?.('connected');
      const decoder = new TextDecoder();
      let buf = '';

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        lastDataAt = Date.now();
        retryDelay = INITIAL_DELAY_MS; // reset backoff on data
        buf += decoder.decode(value, { stream: true });
        // SSE blocks are separated by double newlines
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const block of parts) {
          parseSSEBlocks(`${block}\n\n`, onEvent);
        }
      }
    } catch (err) {
      if (closed) return;
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'AbortError') return;
      onError?.(error);
    }

    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    if (closed) return;
    onStateChange?.('reconnecting');
    retryTimer = setTimeout(() => {
      retryDelay = Math.min(retryDelay * BACKOFF_FACTOR, MAX_DELAY_MS);
      void connect();
    }, retryDelay);
  }

  void connect();

  return {
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
    },
  };
}
