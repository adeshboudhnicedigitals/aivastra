import type { ChatMessageT, ConversationStatusT } from '@aivastra/types';
import { Banner, BlockStack, Button, Icon, InlineStack, Text, TextField } from '@shopify/polaris';
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
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '8px 12px',
          borderRadius: '12px',
          background: isUser ? '#008060' : isSystem ? 'transparent' : '#f1f1f1',
          color: isUser ? '#fff' : '#202223',
          fontStyle: isSystem ? 'italic' : 'normal',
          textAlign: isSystem ? 'center' : 'left',
          fontSize: '14px',
        }}
      >
        {message.content}
      </div>
    </div>
  );
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
    <div style={{ position: 'fixed', right: 32, bottom: 32, zIndex: WIDGET_Z }}>
      {open && (
        <div
          role="dialog"
          aria-label="Aivastra Support"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 68,
            width: 'min(380px, calc(100vw - 64px))',
            maxHeight: 'calc(100vh - 132px)',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
            padding: 16,
          }}
        >
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Aivastra Support
              </Text>
              <Button
                variant="plain"
                icon={XIcon}
                accessibilityLabel="Close chat"
                onClick={() => setOpen(false)}
              />
            </InlineStack>
            {error && <Banner tone="critical">{error}</Banner>}
            <Text as="p" tone="subdued">
              {connecting ? 'Connecting…' : STATUS_COPY[status]}
            </Text>
            <div
              ref={scrollRef}
              style={{
                height: '320px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '4px',
              }}
            >
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
              {typing && (
                <Text as="p" tone="subdued">
                  {typing === 'bot' ? 'Assistant is typing…' : 'Agent is typing…'}
                </Text>
              )}
            </div>
            {status === 'CLOSED' ? (
              <Button onClick={reset}>Start new chat</Button>
            ) : (
              <InlineStack gap="200" blockAlign="end" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Message"
                    labelHidden
                    autoComplete="off"
                    value={input}
                    onChange={setInput}
                    placeholder="Type a message…"
                    maxLength={2000}
                    // NOTE: Enter-to-send is not implemented — Polaris 13.9.5's
                    // TextField does not forward onKeyDown (TS2322).
                  />
                </div>
                <Button onClick={handleSend} variant="primary">
                  Send
                </Button>
              </InlineStack>
            )}
          </BlockStack>
        </div>
      )}
      <button
        type="button"
        aria-label={open ? 'Close support chat' : 'Open support chat'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          background: '#008060',
          color: '#fff',
          boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ width: 28, height: 28, display: 'block', fill: '#fff' }}>
          <Icon source={open ? XIcon : ChatIcon} tone="inherit" />
        </span>
      </button>
    </div>
  );
}
