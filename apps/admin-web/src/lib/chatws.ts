import { apiErrorFromResponse, getToken } from './data';

export interface ChatMessageT {
  id: string;
  conversationId: string;
  role: string;
  senderId: string | null;
  content: string;
  attachmentKey: string | null;
  attachmentType: string | null;
  createdAt: string;
}

export type WsAgentFrameT =
  | { type: 'join'; conversationId: string }
  | { type: 'leave'; conversationId: string }
  | { type: 'message'; conversationId: string; content: string }
  | { type: 'typing'; conversationId: string };

export type WsServerFrameT =
  | { type: 'ready'; conversationId: string; status: string }
  | { type: 'message'; message: ChatMessageT }
  | { type: 'token'; conversationId: string; delta: string }
  | { type: 'typing'; conversationId: string; role: string }
  | { type: 'state_change'; conversationId: string; status: string; reason: string | null }
  | { type: 'queue_update'; pending: number }
  | { type: 'error'; code: string; message: string };

const CHATBOT_URL = (import.meta.env.VITE_CHATBOT_URL as string) || 'http://localhost:4200';

export async function fetchChatbot<T>(path: string): Promise<T> {
  const res = await fetch(`${CHATBOT_URL}${path}`, {
    headers: { authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw await apiErrorFromResponse(res);
  return res.json() as Promise<T>;
}

/**
 * Auto-reconnects with exponential backoff on any drop (network blip, an idle
 * proxy closing the socket, a laptop waking from sleep). Without this, a
 * silently-dead connection stops the 15s agent-presence heartbeat the
 * chatbot's sweeper relies on — within a minute it treats the agent as gone,
 * unassigns the ticket and reopens it to the queue even though the agent is
 * still there and already answered it. `onConnectionChange` fires on every
 * open/close transition (not just the first) so a caller like ChatInboxPage
 * can re-send `join` for whatever conversation is selected once reconnected.
 */
export function connectAgentWs(
  onFrame: (f: WsServerFrameT) => void,
  onConnectionChange?: (connected: boolean) => void,
): { send: (f: WsAgentFrameT) => void; close: () => void } {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleReconnect() {
    if (closed) return;
    clearTimeout(reconnectTimer);
    const delay = Math.min(1_000 * 2 ** attempt, 15_000);
    attempt += 1;
    reconnectTimer = setTimeout(() => void open(), delay);
  }

  async function open() {
    if (closed) return;
    try {
      const res = await fetch(`${CHATBOT_URL}/ws-ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      const { ticket } = (await res.json()) as { ticket: string };
      if (closed) return;
      const socket = new WebSocket(`${CHATBOT_URL.replace(/^http/, 'ws')}/ws?ticket=${ticket}`);
      socket.onmessage = (ev) => onFrame(JSON.parse(ev.data as string) as WsServerFrameT);
      socket.onopen = () => {
        if (closed) {
          socket.close();
          return;
        }
        attempt = 0;
        ws = socket;
        onConnectionChange?.(true);
      };
      socket.onclose = () => {
        if (ws === socket) ws = null;
        onConnectionChange?.(false);
        scheduleReconnect();
      };
      socket.onerror = () => socket.close();
    } catch {
      scheduleReconnect();
    }
  }

  void open();

  return {
    send: (f) => ws?.send(JSON.stringify(f)),
    close: () => {
      closed = true;
      clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    },
  };
}
