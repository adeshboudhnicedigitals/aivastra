import type { ChatMessageT, ConversationStatusT } from '@aivastra/types';
import { Banner, BlockStack, Button, InlineStack, Modal, Text, TextField } from '@shopify/polaris';
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

export function SupportChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status, messages, typing, error, connecting, send, reset } = useSupportChat(open);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages.length is a deliberate trigger, not referenced in the body
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  function handleSend() {
    if (!input.trim()) return;
    // Only clear the box when the message actually went out — send() no-ops
    // (no socket, closed status, or the socket still connecting) and clearing
    // unconditionally would silently vanish what the merchant typed.
    if (send(input)) setInput('');
  }

  return (
    <Modal open={open} title="Aivastra Support" onClose={onClose}>
      <Modal.Section>
        <BlockStack gap="300">
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
            <InlineStack gap="200" blockAlign="end">
              <div style={{ flex: 1 }}>
                <TextField
                  label="Message"
                  labelHidden
                  autoComplete="off"
                  value={input}
                  onChange={setInput}
                  placeholder="Type a message…"
                  maxLength={2000}
                  // NOTE (Minor #3, final review): Enter-to-send was
                  // specified as an onKeyDown handler on this TextField, but
                  // the installed Polaris version (13.9.5) does not forward
                  // onKeyDown — TextFieldProps has no such prop and tsc
                  // rejects it (TS2322). Not implemented; see the final
                  // review fix report for the confirming typecheck output.
                />
              </div>
              <Button onClick={handleSend} variant="primary">
                Send
              </Button>
            </InlineStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
