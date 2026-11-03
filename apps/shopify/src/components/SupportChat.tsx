import type { ChatMessageT, ConversationStatusT } from '@aivastra/types';
import { Icon } from '@shopify/polaris';
import { ChatIcon, XIcon } from '@shopify/polaris-icons';
import { useEffect, useRef, useState } from 'react';
import { useSupportChat } from '../hooks/useSupportChat';

const STATUS_COPY: Record<ConversationStatusT, string> = {
  OPEN: 'Waiting for an agent…',
  IN_PROGRESS: 'Live agent',
  RESOLVED: 'Marked resolved — send a message to reopen',
  CLOSED: 'Conversation ended',
  // Legacy statuses — never actually produced (see ConversationStatus's own
  // comment in packages/types/src/chatbot.ts) — but map to a neutral fallback
  // rather than a blank status line in case one somehow arrives.
  BOT: 'Connected',
  PENDING_HUMAN: 'Connected',
  HUMAN: 'Connected',
};

function MessageRow({ message }: { message: ChatMessageT }) {
  return <div className={`av-chat-msg ${message.role}`}>{message.content}</div>;
}

// Above Polaris's Frame/Modal layers so the launcher stays reachable on every page.
const WIDGET_Z = 600;

/**
 * Floating support chatbot: a launcher button fixed to the bottom-right of the
 * embedded app that opens a chat panel. Mounted once in App so it is present on
 * every page; the socket only connects while the panel is open.
 */
export function SupportChat() {
  const [open, setOpen] = useState(false);
  const { status, messages, typing, error, connecting, send, reset } = useSupportChat(open);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages.length is a deliberate trigger, not referenced in the body
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, open]);

  function handleSend() {
    if (!input.trim()) return;
    // Only clear the box when the message actually went out — send() no-ops
    // (no socket, closed status, or the socket still connecting) and clearing
    // unconditionally would silently vanish what the merchant typed.
    if (send(input)) setInput('');
  }

  return (
    <div className="av-chat" style={{ zIndex: WIDGET_Z }}>
      {open && (
        <div role="dialog" aria-label="Aivastra Support" className="av-chat-panel">
          <div className="av-chat-head">
            <div>
              <h2>Aivastra Support</h2>
              <p>{connecting ? 'Connecting…' : STATUS_COPY[status]}</p>
            </div>
            <button
              type="button"
              className="av-chat-x"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              <Icon source={XIcon} tone="inherit" />
            </button>
          </div>
          {error && (
            <div className="av-chat-err" role="alert">
              {error}
            </div>
          )}
          <div ref={scrollRef} className="av-chat-body">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}
            {typing && (
              <div className="av-chat-typing">
                {typing === 'bot' ? 'Assistant is typing…' : 'Agent is typing…'}
              </div>
            )}
          </div>
          {status === 'CLOSED' ? (
            <div className="av-chat-foot">
              <button type="button" className="av-btn-ghost av-btn-sm" onClick={reset}>
                Start new chat
              </button>
            </div>
          ) : (
            <form
              className="av-chat-foot"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              {/* A native input, unlike Polaris's TextField, submits on Enter. */}
              <input
                aria-label="Message"
                autoComplete="off"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message…"
                maxLength={2000}
              />
              <button type="submit" className="av-btn-primary av-btn-sm">
                Send
              </button>
            </form>
          )}
        </div>
      )}
      <button
        type="button"
        data-support-chat-launcher
        className="av-chat-fab"
        aria-label={open ? 'Close support chat' : 'Open support chat'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon source={open ? XIcon : ChatIcon} tone="inherit" />
      </button>
    </div>
  );
}
