'use client';
import type { ChatMessageT, ConversationStatusT, WsServerFrameT } from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken } from '../lib/api';
import { BREAKPOINTS } from '../lib/breakpoints';
import { C, M } from './tokens';

const CHATBOT_URL = process.env.NEXT_PUBLIC_CHATBOT_URL || 'http://localhost:4200';

interface MeResponse {
  email: string;
  displayName: string | null;
}

// Renders the light markdown subset the bot model actually emits (**bold**, numbered/
// bulleted lists) — no markdown library in this repo, and the widget has no other rich
// content needs, so a small hand-rolled parser avoids pulling one in.
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static text-parse output, never reordered
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: static text-parse output, never reordered
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function renderMessageContent(content: string) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} style={{ margin: '4px 0', paddingLeft: '20px' }}>
        {list.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static text-parse output, never reordered
          <li key={i}>{renderInline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const line of lines) {
    const ordered = line.match(/^\s*\d+\.\s+(.*)/);
    const bulleted = line.match(/^\s*[-*]\s+(.*)/);
    if (ordered) {
      if (!list?.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1] ?? '');
    } else if (bulleted) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bulleted[1] ?? '');
    } else {
      flushList();
      if (line.trim()) blocks.push(<div key={blocks.length}>{renderInline(line)}</div>);
    }
  }
  flushList();
  return blocks;
}

// Short local time label for a message bubble ("2:14 PM").
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Round initials bubble shown next to each non-system message — the customer's
// own messages get their real account initials (same two-letter convention as
// the header's own avatar in UserMenu: displayName.slice(0, 2).toUpperCase()),
// while an agent/bot message's bubble is keyed off its display label so a
// different agent visibly gets a different avatar.
function Avatar({ isUser, initials }: { isUser: boolean; initials: string }) {
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontWeight: 600,
        background: isUser ? 'linear-gradient(135deg, #ec4899, #8b5cf6)' : '#ece0fb',
        color: isUser ? '#fff' : '#6d28d9',
      }}
    >
      {initials}
    </div>
  );
}

// Renders an attachment image, falling back to a plain link if the fetch fails
// (expired/deleted object, network blip) instead of the browser's broken-image icon.
function AttachmentImage({ src, href, isUser }: { src: string; href: string; isUser: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-block',
          marginTop: 4,
          fontSize: '13px',
          textDecoration: 'underline',
          color: isUser ? '#fff' : C.pink,
        }}
      >
        Attachment failed to load — view original
      </a>
    );
  }
  return (
    <img
      src={src}
      alt="attachment"
      onError={() => setFailed(true)}
      style={{ maxWidth: '100%', borderRadius: 8, marginTop: 4 }}
    />
  );
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ConversationStatusT>('OPEN');
  const [messages, setMessages] = useState<ChatMessageT[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const convRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const unmountedRef = useRef(false);

  // Shares the 'me' query cache with UserMenu, so the "you" bubble shows the
  // same initials as the account avatar in the header (e.g. "CH"), not a
  // generic "You".
  const { data: me } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get('/v1/me'),
    retry: false,
  });
  const myDisplayName = me?.displayName || me?.email?.split('@')[0] || 'You';

  const connect = useCallback(async () => {
    if (unmountedRef.current) return;
    const token = getToken();
    if (!token) return;
    const tRes = await fetch(`${CHATBOT_URL}/ws-ticket`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!tRes.ok) return;
    const { ticket } = (await tRes.json()) as { ticket: string };
    if (unmountedRef.current) return;
    const ws = new WebSocket(`${CHATBOT_URL.replace(/^http/, 'ws')}/ws?ticket=${ticket}`);
    ws.onmessage = async (ev) => {
      const f = JSON.parse(ev.data) as WsServerFrameT;
      if (f.type === 'ready') {
        convRef.current = f.conversationId;
        setStatus(f.status);
        const h = await fetch(
          `${CHATBOT_URL}/conversations/${f.conversationId}/messages?limit=50`,
          { headers: { authorization: `Bearer ${getToken()}` } },
        );
        // Replaces the whole list wholesale (not just appends), so a reconnect
        // after a drop always re-derives who the live agent is from scratch —
        // otherwise the header keeps naming whoever replied last before the
        // drop, even once someone else has since taken over the ticket.
        if (h.ok) setMessages(((await h.json()) as { messages: ChatMessageT[] }).messages);
      } else if (f.type === 'message') {
        setTyping(null);
        setMessages((m) => [...m, f.message]);
      } else if (f.type === 'state_change') {
        setStatus(f.status);
        if (f.status === 'CLOSED') convRef.current = null;
      } else if (f.type === 'typing' && f.role !== 'user') {
        setTyping(f.role);
        setTimeout(() => setTyping(null), 4000);
      }
    };
    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
    };
    ws.onclose = () => {
      wsRef.current = null;
      if (unmountedRef.current) return;
      // A dropped connection (network blip, an idle proxy closing the socket,
      // the device sleeping) must reconnect on its own — otherwise the widget
      // freezes on whatever it last received, including which agent's name the
      // header shows as "live", until the customer happens to reload the page.
      const delay = Math.min(1_000 * 2 ** reconnectAttemptRef.current, 15_000);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => void connect(), delay);
    };
    wsRef.current = ws;
  }, []);

  useEffect(() => {
    if (open && !wsRef.current) void connect();
  }, [open, connect]);

  useEffect(
    () => () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages.length is a deliberate trigger, not referenced in the body
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  async function send() {
    const content = input.trim();
    if ((!content && !pendingFile) || !wsRef.current || status === 'CLOSED') return;
    let attachmentKey: string | undefined;
    let attachmentType: string | undefined;
    setError(null);
    if (pendingFile) {
      setUploading(true);
      try {
        const token = getToken();
        const presignRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/support/presign`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ contentType: pendingFile.type }),
        });
        // Without this, a rejected content-type would be destructured into
        // uploadUrl: undefined and blow up downstream as fetch(undefined, …).
        if (!presignRes.ok) throw new Error(`presign failed (${presignRes.status})`);
        const { uploadUrl, attachmentKey: key } = (await presignRes.json()) as {
          uploadUrl: string;
          attachmentKey: string;
        };
        const put = await fetch(uploadUrl, {
          method: 'PUT',
          body: pendingFile,
          headers: { 'Content-Type': pendingFile.type },
        });
        if (!put.ok) throw new Error(`upload failed (${put.status})`);
        attachmentKey = key;
        attachmentType = pendingFile.type;
      } catch {
        // A failed attachment must not swallow the user's typed message: without a
        // catch here the rejection escaped an async onClick handler, so nothing was
        // shown and the ws.send below never ran.
        attachmentKey = undefined;
        attachmentType = undefined;
        setError(
          content
            ? 'Attachment upload failed — sending your message without it.'
            : 'Attachment upload failed. Please try again.',
        );
      } finally {
        setUploading(false);
        setPendingFile(null);
      }
    }
    // Nothing left to send if the attachment was the whole message and it failed.
    if (!content && !attachmentKey) return;
    wsRef.current.send(
      JSON.stringify({
        type: 'message',
        content: content || '(attachment)',
        attachmentKey,
        attachmentType,
      }),
    );
    setInput('');
  }

  // Most recent agent message's name, so the header can say who's actually
  // replying instead of just "Live agent" once a ticket is claimed.
  const liveAgentName = [...messages]
    .reverse()
    .find((m) => m.role === 'agent' && m.senderName)?.senderName;

  function reset() {
    setStatus('OPEN');
    setMessages([]);
    setError(null);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectAttemptRef.current = 0;
    // Detach onclose first so this deliberate close doesn't also trigger the
    // auto-reconnect path above and race the explicit connect() below.
    if (wsRef.current) wsRef.current.onclose = null;
    wsRef.current?.close();
    wsRef.current = null;
    convRef.current = null;
    void connect();
  }

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .chat-widget-trigger {
              position: fixed;
              bottom: 24px;
              right: 24px;
              width: 56px;
              height: 56px;
              border-radius: 50%;
              border: none;
              cursor: pointer;
              z-index: 1000;
              background: #521D9C;
              color: #fff;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 4px 12px rgba(82, 29, 156, 0.25);
              transition: transform 0.2s ease, bottom 0.2s ease, right 0.2s ease;
            }
            .chat-widget-panel {
              position: fixed;
              bottom: 92px;
              right: 24px;
              width: 360px;
              max-width: calc(100vw - 32px);
              height: 640px;
              max-height: calc(100vh - 140px);
              border-radius: 12px;
              background: var(--c-card);
              color: var(--c-text);
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
              display: flex;
              flex-direction: column;
              z-index: 1000;
              overflow: hidden;
              font-family: system-ui, -apple-system, sans-serif;
              box-sizing: border-box;
            }
            @media (max-width: ${BREAKPOINTS.sm}px) {
              .chat-widget-trigger {
                bottom: 16px !important;
                right: 16px !important;
                width: 48px !important;
                height: 48px !important;
              }
              .chat-widget-panel {
                bottom: 72px !important;
                right: 16px !important;
                width: calc(100vw - 32px) !important;
                max-height: calc(100vh - 90px) !important;
                height: 560px;
              }
            }
          `,
        }}
      />
      <button type="button" className="chat-widget-trigger" onClick={() => setOpen(!open)}>
        {open ? (
          '✕'
        ) : (
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {open && (
        <div className="chat-widget-panel">
          <div
            style={{
              padding: '16px',
              borderBottom: `1px solid ${C.border}`,
              background: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
              color: '#fff',
            }}
          >
            <strong>Aivastra Support</strong>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>
              {status === 'OPEN' && 'Waiting for an agent…'}
              {status === 'IN_PROGRESS' &&
                (liveAgentName ? `Live agent — ${liveAgentName}` : 'Live agent')}
              {status === 'RESOLVED' && 'Marked resolved — send a message to reopen'}
              {status === 'CLOSED' && 'Conversation ended'}
            </div>
          </div>

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              padding: '12px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minHeight: '200px',
            }}
          >
            {messages.map((m) => {
              // System rows are status events ("agent joined", "ticket resolved"), not
              // a conversational party — no avatar/name, just a centered event line.
              if (m.role === 'system') {
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: 'center',
                      maxWidth: '90%',
                      textAlign: 'center',
                      fontSize: '12px',
                      fontStyle: 'italic',
                      color: C.mid,
                    }}
                  >
                    {renderMessageContent(m.content)}
                    <span style={{ fontStyle: 'normal', marginLeft: 6 }}>
                      {formatTime(m.createdAt)}
                    </span>
                  </div>
                );
              }
              const isUser = m.role === 'user';
              const label = isUser
                ? 'You'
                : m.role === 'bot'
                  ? 'Assistant'
                  : m.senderName || 'Support';
              const initials = (isUser ? myDisplayName : label).slice(0, 2).toUpperCase();
              return (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                    maxWidth: '88%',
                  }}
                >
                  {/* The customer knows their own messages are theirs — no label needed.
                      An agent/bot message names who's actually replying (the real admin's
                      name once claimed, not a generic "Admin") so the customer can trust
                      there's a person on the other end. */}
                  {!isUser && (
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: C.mid,
                        marginBottom: '2px',
                        marginLeft: '32px',
                      }}
                    >
                      {label}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: isUser ? 'row-reverse' : 'row',
                      alignItems: 'flex-end',
                      gap: '8px',
                      minWidth: 0,
                    }}
                  >
                    <Avatar isUser={isUser} initials={initials} />
                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: '12px',
                        fontSize: '14px',
                        lineHeight: 1.4,
                        background: isUser ? '#ec4899' : C.lighter,
                        color: isUser ? '#fff' : C.text,
                        minWidth: 0,
                      }}
                    >
                      {renderMessageContent(m.content)}
                      {/* A PDF is a legitimate attachment here (SupportModal and the presign
                          route both accept one), so only images get an <img> — anything else
                          would render as a broken image icon. Rows written before
                          attachmentType was populated have none; those were images. */}
                      {m.attachmentKey &&
                        (!m.attachmentType || m.attachmentType.startsWith('image/') ? (
                          <AttachmentImage
                            src={`${process.env.NEXT_PUBLIC_API_URL}/v1/support/attachment?key=${encodeURIComponent(m.attachmentKey)}`}
                            href={`${process.env.NEXT_PUBLIC_API_URL}/v1/support/attachment?key=${encodeURIComponent(m.attachmentKey)}`}
                            isUser={isUser}
                          />
                        ) : (
                          <a
                            href={`${process.env.NEXT_PUBLIC_API_URL}/v1/support/attachment?key=${encodeURIComponent(m.attachmentKey)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-block',
                              marginTop: 4,
                              fontSize: '13px',
                              textDecoration: 'underline',
                              color: isUser ? '#fff' : C.pink,
                            }}
                          >
                            View attachment
                          </a>
                        ))}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '10px',
                      color: C.mid,
                      marginTop: '2px',
                      // Offsets past the avatar (24px) + its gap (8px) so the
                      // timestamp lines up under the bubble, not the avatar.
                      marginLeft: isUser ? 0 : '32px',
                      marginRight: isUser ? '32px' : 0,
                    }}
                  >
                    {formatTime(m.createdAt)}
                  </div>
                </div>
              );
            })}
            {typing && (
              <em style={{ fontSize: '12px', color: C.mid, alignSelf: 'flex-start' }}>
                {typing === 'bot' ? 'Assistant is typing…' : 'Agent is typing…'}
              </em>
            )}
          </div>

          {error && (
            <div
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                color: M.danger,
                background: M.dangerTint,
                borderTop: `1px solid ${C.border}`,
              }}
            >
              {error}
            </div>
          )}

          {status !== 'CLOSED' ? (
            <div
              style={{
                padding: '12px',
                borderTop: `1px solid ${C.border}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              {pendingFile && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    color: C.pink,
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '220px',
                    }}
                  >
                    {pendingFile.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingFile(null)}
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      color: C.mid,
                      fontSize: '14px',
                      lineHeight: 1,
                    }}
                    aria-label="Remove attachment"
                  >
                    ×
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach file"
                    style={{
                      position: 'absolute',
                      left: '6px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      padding: '4px',
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      height="20px"
                      viewBox="0 -960 960 960"
                      width="20px"
                      fill="#8b5cf6"
                    >
                      <path d="M720-330q0 104-73 177T470-80q-104 0-177-73t-73-177v-370q0-75 52.5-127.5T400-880q75 0 127.5 52.5T580-700v350q0 46-32 78t-78 32q-46 0-78-32t-32-78v-370h80v370q0 13 8.5 21.5T470-320q13 0 21.5-8.5T500-350v-350q-1-42-29.5-71T400-800q-42 0-71 29t-29 71v370q-1 71 49 120.5T470-160q70 0 119-49.5T640-330v-390h80v390Z" />
                    </svg>
                  </button>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && send()}
                    placeholder="Type a message…"
                    style={{
                      width: '100%',
                      padding: '8px 12px 8px 34px',
                      borderRadius: '20px',
                      border: `1px solid ${C.border}`,
                      outline: 'none',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      background: C.field,
                      color: C.text,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={send}
                  disabled={uploading}
                  aria-label="Send"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: 'none',
                    background: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
                    cursor: uploading ? 'default' : 'pointer',
                    opacity: uploading ? 0.7 : 1,
                    flexShrink: 0,
                  }}
                >
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    height="20px"
                    viewBox="0 -960 960 960"
                    width="20px"
                    fill="#e3e3e3"
                  >
                    <path d="M120-160v-640l760 320-760 320Zm80-120 474-200-474-200v140l240 60-240 60v140Zm0 0v-400 400Z" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{ padding: '12px', borderTop: `1px solid ${C.border}`, textAlign: 'center' }}
            >
              <button
                type="button"
                onClick={reset}
                style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Start new chat
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
