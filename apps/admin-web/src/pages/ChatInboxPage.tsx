import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ImageLightbox } from '../components/ImageLightbox';
import { SearchableSelect } from '../components/SearchableSelect';
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import type { ChatMessageT, WsAgentFrameT, WsServerFrameT } from '../lib/chatws';
import { connectAgentWs, fetchChatbot } from '../lib/chatws';
import { apiErrorMessage, apiFetch } from '../lib/data';

// Renders the light markdown subset the bot model emits (**bold**, numbered/bulleted
// lists) — mirrors apps/catalogues-web/src/components/chat-widget.tsx so agents see the
// same formatting a user sees, without pulling in a markdown library for one widget.
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

// Short relative-time label for a conversation-list row ("2m", "3h", "5d") —
// falls back to a short date once it's further back than a week.
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusBadgeClass(status: string | null): string {
  switch (status) {
    case 'OPEN':
      return 'badge info';
    case 'IN_PROGRESS':
      return 'badge accent';
    case 'RESOLVED':
      return 'badge success';
    default:
      return 'badge';
  }
}

interface ConvRow {
  id: string;
  userId: string;
  status: string;
  source: string;
  category: string | null;
  priority: string;
  subject: string | null;
  assignedAgentId: string | null;
  escalationReason: string | null;
  lastMessageAt: string;
  userEmail: string;
  createdAt: string;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

// Per-admin "have I looked at this ticket's latest message" tracking. There's no
// server-side read-receipt field for this (chatbot_conversations has no per-agent
// last-seen column), so it's tracked client-side only, keyed by conversation id —
// a convenience for this browser, not shared/synced state.
const SEEN_STORAGE_KEY = 'aivastra-chat-inbox-seen-at';

function loadSeenMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveSeenMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can throw (private browsing, quota) — this is a convenience, drop it.
  }
}

function isUnread(c: ConvRow, seenMap: Record<string, string>): boolean {
  const seenAt = seenMap[c.id];
  return !seenAt || new Date(c.lastMessageAt).getTime() > new Date(seenAt).getTime();
}

const CATEGORY_OPTIONS = ['billing', 'bug', 'order', 'account', 'other'] as const;
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'] as const;
const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'var(--danger)',
  high: 'var(--warn)',
  normal: 'var(--muted-2)',
  low: 'var(--muted-2)',
};

export default function ChatInboxPage({ toast }: Props) {
  const [queue, setQueue] = useState<ConvRow[]>([]);
  const [myTickets, setMyTickets] = useState<ConvRow[]>([]);
  const [onDuty, setOnDuty] = useState(false);
  const [activeTab, setActiveTab] = useState<'unclaimed' | 'mine'>('unclaimed');
  const [search, setSearch] = useState('');
  const [selectedConv, setSelectedConv] = useUrlState('conv');
  const closeConv = useCloseOverlay(['conv']);
  const [messages, setMessages] = useState<ChatMessageT[]>([]);
  // Tracks which conversation's messages are currently loaded, so the fetch
  // effect below doesn't refire on every unrelated queue poll.
  const [messagesConvId, setMessagesConvId] = useState<string | null>(null);
  // Tracks which conversation's status/fields/meta have been resolved from the
  // queue/myTickets lists — lets a deep link resolve once those lists finish
  // their initial load, without clobbering an in-progress subject edit on
  // every later poll. A row can only be selected from a list it's visible in,
  // so this always finds it once (even after it later moves between lists or
  // leaves them on resolve/close).
  const [resolvedConvId, setResolvedConvId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<{ userEmail: string } | null>(null);
  const [seenMap, setSeenMap] = useState<Record<string, string>>(() => loadSeenMap());
  const [input, setInput] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [wsReady, setWsReady] = useState(false);
  // Local edit buffer for the selected ticket's subject/category/priority — seeded from
  // the row when a conversation is selected, pushed to the server via updateFields.
  const [fields, setFields] = useState<{ subject: string; category: string; priority: string }>({
    subject: '',
    category: '',
    priority: 'normal',
  });
  const wsRef = useRef<Awaited<ReturnType<typeof connectAgentWs>> | null>(null);
  const selectedRef = useRef(selectedConv);
  selectedRef.current = selectedConv;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useCrumb(
    0,
    selectedConv
      ? {
          label:
            [...queue, ...myTickets].find((c) => c.id === selectedConv)?.subject ?? 'Conversation',
          href: `/chat-inbox?conv=${encodeURIComponent(selectedConv)}`,
        }
      : null,
  );

  // Records that this admin has seen a conversation's latest message as of `at`
  // — skips the write if the stored timestamp is already at least that recent,
  // so an out-of-order WS frame can't rewind it.
  const markSeen = useCallback((id: string, at: string) => {
    setSeenMap((prev) => {
      if (prev[id] && new Date(prev[id]).getTime() >= new Date(at).getTime()) return prev;
      const next = { ...prev, [id]: at };
      saveSeenMap(next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const [q, m, d] = await Promise.all([
      apiFetch<{ rows: ConvRow[] }>('/admin/chatbot/conversations?status=OPEN'),
      apiFetch<{ rows: ConvRow[] }>('/admin/chatbot/conversations?status=IN_PROGRESS'),
      apiFetch<{ on: boolean }>('/admin/chatbot/duty'),
    ]);
    setQueue(q.rows);
    setMyTickets(m.rows);
    setOnDuty(d.on);
  }, []);

  useEffect(() => {
    void load();
    const p = connectAgentWs((f: WsServerFrameT) => {
      const cur = selectedRef.current;
      if (f.type === 'message' && cur && f.message.conversationId === cur) {
        setMessages((m) => [...m, f.message]);
        markSeen(cur, f.message.createdAt);
      } else if (f.type === 'state_change') {
        if (f.conversationId === cur) setStatus(f.status);
        void load();
      } else if (f.type === 'queue_update') {
        void load();
      } else if (f.type === 'typing' && f.conversationId === cur) {
        setTyping(f.role);
        setTimeout(() => setTyping(null), 4000);
      }
    });
    p.then((w) => {
      wsRef.current = w;
      setWsReady(true);
    });
    return () => {
      wsRef.current?.close();
    };
  }, [load, markSeen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: needed to trigger scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Reconstructs the message list from the URL alone — hard refresh or deep
  // link. Skipped once already loaded for this id, so a row click doesn't
  // double-fetch.
  useEffect(() => {
    if (!selectedConv || messagesConvId === selectedConv) return;
    let cancelled = false;
    (async () => {
      const msgs = await fetchChatbot<{ messages: ChatMessageT[] }>(
        `/conversations/${selectedConv}/messages?limit=100`,
      );
      if (!cancelled) {
        setMessages(msgs.messages);
        setMessagesConvId(selectedConv);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedConv, messagesConvId]);

  useEffect(() => {
    if (!selectedConv || resolvedConvId === selectedConv) return;
    const conv = [...queue, ...myTickets].find((c) => c.id === selectedConv);
    if (!conv) return;
    setStatus(conv.status);
    setFields({
      subject: conv.subject ?? '',
      category: conv.category ?? '',
      priority: conv.priority,
    });
    setSelectedMeta({ userEmail: conv.userEmail });
    setResolvedConvId(selectedConv);
    markSeen(selectedConv, conv.lastMessageAt);
  }, [selectedConv, queue, myTickets, resolvedConvId, markSeen]);

  useEffect(() => {
    if (!selectedConv || !wsReady) return;
    wsRef.current?.send({ type: 'join', conversationId: selectedConv } as WsAgentFrameT);
  }, [selectedConv, wsReady]);

  async function claim(id: string) {
    try {
      await apiFetch(`/admin/chatbot/conversations/${id}/claim`, { method: 'POST' });
      toast({ title: 'Claimed' });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to claim conversation',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }

  async function endConv(id: string) {
    try {
      await apiFetch(`/admin/chatbot/conversations/${id}/end`, { method: 'POST' });
      toast({ title: 'Closed' });
      closeConv();
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to close conversation',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }

  async function resolveConv(id: string) {
    try {
      await apiFetch(`/admin/chatbot/conversations/${id}/resolve`, { method: 'POST' });
      toast({ title: 'Resolved' });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to resolve',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }

  async function updateFields(
    id: string,
    updates: { subject?: string; category?: string; priority?: string },
  ) {
    try {
      await apiFetch(`/admin/chatbot/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update ticket',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }

  async function toggleDuty() {
    try {
      const r = await apiFetch<{ on: boolean }>('/admin/chatbot/duty', {
        method: 'POST',
        body: JSON.stringify({ on: !onDuty }),
      });
      setOnDuty(r.on);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to toggle duty',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }

  function sendMsg() {
    if (!input.trim() || !selectedConv || status !== 'IN_PROGRESS') return;
    wsRef.current?.send({
      type: 'message',
      conversationId: selectedConv,
      content: input,
    } as WsAgentFrameT);
    setInput('');
  }

  // Newest activity first, in both tabs — so a fresh reply always surfaces at
  // the top instead of getting buried under older, higher-priority tickets.
  // Priority is still visible per-row (colored dot + badge), just not the sort key.
  const byRecency = (a: ConvRow, b: ConvRow) =>
    new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  const q = search.trim().toLowerCase();
  const matchesSearch = (c: ConvRow) =>
    !q || c.userEmail.toLowerCase().includes(q) || (c.subject ?? '').toLowerCase().includes(q);
  const sortedQueue = [...queue].sort(byRecency).filter(matchesSearch);
  const sortedMine = [...myTickets].sort(byRecency).filter(matchesSearch);
  const list = activeTab === 'unclaimed' ? sortedQueue : sortedMine;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 112px)', gap: 12 }}
    >
      <div className="page-head" style={{ flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Chat Inbox</h2>
          <div className="lede" style={{ margin: '2px 0 0' }}>
            Replies from Contact Us, the Support form and the live chat widget land here.
          </div>
        </div>
        <button
          className="btn"
          onClick={toggleDuty}
          title={
            onDuty
              ? 'You can claim new tickets. Click to go off duty.'
              : 'Go on duty to start claiming new tickets.'
          }
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: onDuty ? 'var(--success)' : 'var(--muted-2)',
              display: 'inline-block',
            }}
          />
          {onDuty ? 'On duty' : 'Off duty'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        {/* Conversation list */}
        <div
          style={{
            width: 320,
            flexShrink: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '10px 12px 0', flexShrink: 0 }}>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email or subject…"
              style={{ fontSize: 13, padding: '7px 10px' }}
            />
          </div>
          <div className="tabs" style={{ margin: '10px 12px 0', flexShrink: 0 }}>
            <button
              className={`tab ${activeTab === 'unclaimed' ? 'active' : ''}`}
              onClick={() => setActiveTab('unclaimed')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              Unclaimed
              <span className="badge" style={{ fontSize: 11, padding: '1px 7px' }}>
                {queue.length}
              </span>
            </button>
            <button
              className={`tab ${activeTab === 'mine' ? 'active' : ''}`}
              onClick={() => setActiveTab('mine')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              My tickets
              <span className="badge" style={{ fontSize: 11, padding: '1px 7px' }}>
                {myTickets.length}
              </span>
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {list.length === 0 ? (
              <div className="empty" style={{ padding: '32px 16px' }}>
                {search
                  ? 'No tickets match your search.'
                  : activeTab === 'unclaimed'
                    ? 'No unclaimed tickets. You’re all caught up.'
                    : 'You have no tickets assigned yet.'}
              </div>
            ) : (
              list.map((c) => {
                const unread = isUnread(c, seenMap);
                return (
                  <div
                    key={c.id}
                    className={`chat-row ${selectedConv === c.id ? 'active' : ''}`}
                    onClick={() => setSelectedConv(c.id)}
                  >
                    <div className="chat-avatar">
                      {(c.userEmail || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {unread && (
                          <span
                            title="Unread"
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: 'var(--accent)',
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 13,
                            fontWeight: unread ? 700 : 500,
                            color: 'var(--ink)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.userEmail}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: unread ? 'var(--accent)' : 'var(--muted-2)',
                            fontWeight: unread ? 600 : 400,
                            flexShrink: 0,
                          }}
                        >
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: unread ? 'var(--ink-2)' : 'var(--muted)',
                          fontWeight: unread ? 500 : 400,
                          marginTop: 2,
                          marginLeft: unread ? 13 : 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.subject || 'No subject'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                        <span
                          title={`Priority: ${c.priority}`}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: PRIORITY_COLOR[c.priority] ?? 'var(--muted-2)',
                            flexShrink: 0,
                          }}
                        />
                        {c.category && (
                          <span className="badge" style={{ fontSize: 11, padding: '1px 7px' }}>
                            {c.category}
                          </span>
                        )}
                        {c.escalationReason && (
                          <span className="badge warn" style={{ fontSize: 11, padding: '1px 7px' }}>
                            {c.escalationReason}
                          </span>
                        )}
                        {activeTab === 'unclaimed' ? (
                          <button
                            className="btn sm ghost"
                            style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 11 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              claim(c.id);
                            }}
                          >
                            Claim
                          </button>
                        ) : (
                          <span
                            className={statusBadgeClass(c.status)}
                            style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 7px' }}
                          >
                            {c.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Conversation pane */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
          }}
        >
          {selectedConv ? (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  flexShrink: 0,
                  flexWrap: 'wrap',
                }}
              >
                <div className="chat-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                  {(selectedMeta?.userEmail || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--ink)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {selectedMeta?.userEmail ?? '—'}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fields.subject || 'No subject'}
                  </div>
                </div>
                <span className={statusBadgeClass(status)}>{status}</span>
                {status === 'OPEN' && (
                  <button className="btn sm primary" onClick={() => claim(selectedConv)}>
                    Claim ticket
                  </button>
                )}
                {status === 'IN_PROGRESS' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn sm ghost" onClick={() => resolveConv(selectedConv)}>
                      Resolve
                    </button>
                    <button className="btn sm ghost" onClick={() => endConv(selectedConv)}>
                      Close
                    </button>
                  </div>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-end',
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--border)',
                  flexShrink: 0,
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 200px' }}
                >
                  <label
                    htmlFor="chat-subject"
                    style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}
                  >
                    SUBJECT
                  </label>
                  <input
                    id="chat-subject"
                    value={fields.subject}
                    onChange={(e) => setFields((f) => ({ ...f, subject: e.target.value }))}
                    onBlur={() => updateFields(selectedConv, { subject: fields.subject })}
                    placeholder="No subject"
                    style={{
                      padding: '6px 10px',
                      fontSize: 13,
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r)',
                      background: 'var(--bg)',
                      color: 'var(--ink)',
                    }}
                  />
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}
                >
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                    CATEGORY
                  </span>
                  <SearchableSelect
                    options={CATEGORY_OPTIONS.map((c) => ({ id: c, label: capitalize(c) }))}
                    value={fields.category}
                    onChange={(category) => {
                      setFields((f) => ({ ...f, category }));
                      updateFields(selectedConv, { category });
                    }}
                    emptyLabel="Uncategorized"
                    ariaLabel="Ticket category"
                  />
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}
                >
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                    PRIORITY
                  </span>
                  <SearchableSelect
                    options={PRIORITY_OPTIONS.map((p) => ({ id: p, label: capitalize(p) }))}
                    value={fields.priority}
                    onChange={(priority) => {
                      setFields((f) => ({ ...f, priority }));
                      updateFields(selectedConv, { priority });
                    }}
                    ariaLabel="Ticket priority"
                  />
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {messages.map((m, idx) => {
                  // System rows are status events ("ticket resolved", "escalated to
                  // an agent"), not a conversational party — a left/right chat bubble
                  // mislabels them (they used to render as a right-aligned "Bot"
                  // bubble, indistinguishable from an actual agent reply). Render
                  // them as a centered, bubble-less event line instead.
                  if (m.role === 'system') {
                    return (
                      <div
                        key={m.id}
                        style={{
                          alignSelf: 'center',
                          maxWidth: '85%',
                          textAlign: 'center',
                          fontSize: 11.5,
                          color: 'var(--muted)',
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 999,
                          padding: '4px 12px',
                        }}
                      >
                        {m.content}
                        <span style={{ color: 'var(--muted-2)', marginLeft: 6 }}>
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    );
                  }
                  // 'user' and the legacy 'bot' role both read as "them" and sit on
                  // the left; 'agent' is the admin replying, on the right.
                  const mine = m.role === 'agent';
                  // Only label the first bubble in a run of consecutive same-role
                  // messages — repeating "User" on every single bubble (the old
                  // behavior) is what made the thread look like stacked tags
                  // instead of a conversation.
                  const prev = messages[idx - 1];
                  const showLabel = !prev || prev.role !== m.role;
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: mine ? 'flex-end' : 'flex-start',
                        maxWidth: '70%',
                        marginTop: showLabel && idx > 0 ? 6 : 0,
                      }}
                    >
                      <div
                        style={{
                          background: mine ? 'var(--accent-soft)' : 'var(--surface-2)',
                          borderRadius: 'var(--r-lg)',
                          padding: '8px 12px',
                          fontSize: 13,
                        }}
                      >
                        {showLabel && (
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'var(--muted)',
                              marginBottom: 2,
                            }}
                          >
                            {mine ? 'You' : m.role === 'bot' ? 'Bot' : 'User'}
                          </div>
                        )}
                        <div style={{ lineHeight: 1.5 }}>{renderMessageContent(m.content)}</div>
                        {/* A shopper can attach a PDF (SupportModal and the presign route both
                            accept one), so only images get an <img> — anything else would show
                            the agent a broken image icon. Rows written before attachmentType
                            was populated have none; those were images. */}
                        {m.attachmentKey &&
                          (!m.attachmentType || m.attachmentType.startsWith('image/') ? (
                            // biome-ignore lint/performance/noImgElement: chatbot attachment preview, not a Next.js app
                            <img
                              src={`/v1/support/attachment?key=${encodeURIComponent(m.attachmentKey)}`}
                              alt="attachment"
                              style={{
                                maxWidth: '100%',
                                borderRadius: 6,
                                marginTop: 4,
                                cursor: 'zoom-in',
                              }}
                              onClick={() =>
                                setPreviewUrl(
                                  `/v1/support/attachment?key=${encodeURIComponent(m.attachmentKey as string)}`,
                                )
                              }
                            />
                          ) : (
                            <a
                              href={`/v1/support/attachment?key=${encodeURIComponent(m.attachmentKey)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'inline-block',
                                marginTop: 4,
                                fontSize: 12,
                                color: 'var(--accent)',
                                textDecoration: 'underline',
                              }}
                            >
                              View attachment
                            </a>
                          ))}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: 'var(--muted-2)',
                          marginTop: 3,
                          textAlign: mine ? 'right' : 'left',
                        }}
                      >
                        {new Date(m.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  );
                })}
                {typing && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--muted)',
                      fontStyle: 'italic',
                      padding: '4px 0',
                    }}
                  >
                    {typing === 'user' ? 'User' : typing === 'agent' ? 'You' : 'Bot'} is typing…
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {status === 'IN_PROGRESS' ? (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '12px 16px',
                    borderTop: '1px solid var(--border)',
                    flexShrink: 0,
                  }}
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMsg()}
                    placeholder="Type a reply…"
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      fontSize: 13,
                      border: '1px solid var(--border)',
                      borderRadius: 999,
                      background: 'var(--bg)',
                      color: 'var(--ink)',
                    }}
                  />
                  <button
                    className="btn primary"
                    onClick={sendMsg}
                    disabled={!input.trim()}
                    style={{ borderRadius: 999, padding: '10px 18px' }}
                  >
                    Send
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    padding: '12px 16px',
                    borderTop: '1px solid var(--border)',
                    flexShrink: 0,
                    fontSize: 12,
                    color: 'var(--muted)',
                    textAlign: 'center',
                  }}
                >
                  {status === 'OPEN'
                    ? 'Claim this ticket to start replying.'
                    : `This conversation is ${(status ?? '').toLowerCase()} — no further replies can be sent.`}
                </div>
              )}
            </>
          ) : (
            <div
              className="empty"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div className="ico">
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  style={{ width: 32, height: 32 }}
                >
                  <path d="M2 3h12v9H5l-3 2V3z" />
                </svg>
              </div>
              Select a conversation to start chatting.
            </div>
          )}
        </div>
      </div>

      {previewUrl && <ImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}
