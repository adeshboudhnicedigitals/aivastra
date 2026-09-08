import type { ChatMessageT, ConversationStatusT, WsServerFrameT } from '@aivastra/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

const CHATBOT_URL = import.meta.env.VITE_CHATBOT_URL || 'http://localhost:4200';

interface SupportSessionResponse {
  token: string;
}

export interface UseSupportChatResult {
  status: ConversationStatusT;
  messages: ChatMessageT[];
  typing: 'agent' | 'bot' | null;
  error: string | null;
  connecting: boolean;
  send: (content: string) => boolean;
  reset: () => void;
}

/**
 * Drives the same chatbot WS protocol apps/catalogues-web's chat-widget.tsx
 * uses, but authenticated via a per-store synthetic platform user
 * (POST /v1/shopify/support/session) instead of a real logged-in user's
 * token — see docs/superpowers/specs/2026-09-05-shopify-admin-support-chat-design.md.
 */
export function useSupportChat(active: boolean): UseSupportChatResult {
  const [status, setStatus] = useState<ConversationStatusT>('OPEN');
  const [messages, setMessages] = useState<ChatMessageT[]>([]);
  const [typing, setTyping] = useState<'agent' | 'bot' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      let ticket: string | null = null;
      // Up to 2 attempts: the first uses a cached platform token if we have
      // one; a 401 from /ws-ticket means it expired, so we clear it and mint
      // a fresh one via /v1/shopify/support/session (a cheap no-op after the
      // support user already exists) and try once more.
      for (let attempt = 0; attempt < 2 && !ticket; attempt++) {
        if (!tokenRef.current) {
          const session = await apiFetch<SupportSessionResponse>('/v1/shopify/support/session', {
            method: 'POST',
          });
          tokenRef.current = session.token;
        }
        const tRes = await fetch(`${CHATBOT_URL}/ws-ticket`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tokenRef.current}` },
        });
        if (tRes.ok) {
          const body = (await tRes.json()) as { ticket: string };
          ticket = body.ticket;
        } else if (tRes.status === 401) {
          tokenRef.current = null;
        } else {
          throw new Error(`ws-ticket failed (${tRes.status})`);
        }
      }
      if (!ticket) throw new Error('ws-ticket failed after retry');

      const ws = new WebSocket(`${CHATBOT_URL.replace(/^http/, 'ws')}/ws?ticket=${ticket}`);
      ws.onmessage = async (ev) => {
        const f = JSON.parse(ev.data) as WsServerFrameT;
        if (f.type === 'ready') {
          setStatus(f.status);
          const h = await fetch(
            `${CHATBOT_URL}/conversations/${f.conversationId}/messages?limit=50`,
            { headers: { authorization: `Bearer ${tokenRef.current}` } },
          );
          if (h.ok) setMessages(((await h.json()) as { messages: ChatMessageT[] }).messages);
        } else if (f.type === 'message') {
          setTyping(null);
          setMessages((m) => [...m, f.message]);
        } else if (f.type === 'state_change') {
          setStatus(f.status);
        } else if (f.type === 'typing' && f.role !== 'user') {
          setTyping(f.role);
          setTimeout(() => setTyping(null), 4000);
        } else if (f.type === 'error') {
          // The gateway emits this for rate-limiting (RATE_LIMITED) and
          // oversized messages (BAD_FRAME) — without surfacing it, both look
          // identical to nothing happening at all.
          setError(f.message);
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
      };
      ws.onerror = () => {
        setError("Couldn't connect to support. Please try again.");
      };
      wsRef.current = ws;
    } catch {
      setError("Couldn't connect to support. Please try again.");
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    if (active && !wsRef.current) void connect();
    if (!active && wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    // Closes the socket on unmount/navigate-away too — without this, leaving
    // the modal mounted while routing elsewhere leaks an open connection.
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [active, connect]);

  const send = useCallback(
    (content: string): boolean => {
      const trimmed = content.trim();
      if (
        !trimmed ||
        !wsRef.current ||
        wsRef.current.readyState !== WebSocket.OPEN ||
        status === 'CLOSED'
      ) {
        return false;
      }
      wsRef.current.send(JSON.stringify({ type: 'message', content: trimmed }));
      return true;
    },
    [status],
  );

  const reset = useCallback(() => {
    setStatus('OPEN');
    setMessages([]);
    setError(null);
    wsRef.current?.close();
    wsRef.current = null;
    void connect();
  }, [connect]);

  return { status, messages, typing, error, connecting, send, reset };
}
