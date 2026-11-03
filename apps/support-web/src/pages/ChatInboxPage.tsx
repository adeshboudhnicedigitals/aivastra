import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageLightbox } from '../components/ImageLightbox';
import { SearchableSelect } from '../components/SearchableSelect';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import type { ChatMessageT, WsAgentFrameT, WsServerFrameT } from '../lib/chatws';
import { connectAgentWs, fetchChatbot } from '../lib/chatws';
import { apiErrorMessage, apiFetch } from '../lib/data';
import '../styles/chat-inbox.css';

// This panel mirrors ChatInboxPage's design and ticket workflow (same tabs, row
// layout, badges, message bubbles, claim/resolve/close actions) so Support has
// full feature parity rather than a stripped-down monitoring view — it calls
// the exact same admin chatbot endpoints ChatInboxPage does, nothing new.

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

function formatRaisedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusLabel(status: string | null): string {
  switch (status) {
    case 'OPEN':
      return 'Waiting for an agent';
    case 'IN_PROGRESS':
      return 'Online';
    case 'RESOLVED':
      return 'Resolved';
    case 'CLOSED':
      return 'Closed';
    default:
      return '';
  }
}

const AVATAR_COLORS = ['#e5566b', '#a56ae8', '#3b82f6', '#14a37f', '#e0892b', '#6b7280'];
function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] as string;
}

// A user's uploaded picture, when there is one. Shopify tickets belong to a
// per-store placeholder user, so they never carry one.
function AvatarFace({ url, fallback }: { url: string | null | undefined; fallback: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <>{fallback}</>;
  return (
    // biome-ignore lint/performance/noImgElement: short-lived presigned storage URL
    <img src={url} alt="" onError={() => setBroken(true)} />
  );
}

function initials(label: string): string {
  const words = label
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0]}${words[1]?.[0]}` : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

// Mirrors the row shape GET /admin/chatbot/conversations already returns
// (see apps/api/src/modules/admin/chatbot.routes.ts) — same fields
// ChatInboxPage's own ConvRow uses.
interface ConvRow {
  id: string;
  userId: string;
  status: string;
  category: string | null;
  priority: string;
  subject: string | null;
  lastMessageAt: string;
  createdAt: string;
  userEmail: string;
  userName: string | null;
  userAvatarUrl: string | null;
  userPhone: string | null;
  userCompany: string | null;
  agentName: string | null;
  agentEmail: string | null;
  shopifyStoreId: string | null;
  shopDomain: string | null;
  shopName: string | null;
  shopOwnerName: string | null;
  shopEmail: string | null;
  shopPhone: string | null;
  shopAddress: string | null;
}

// Same browser-local read-tracking key ChatInboxPage uses — sharing it means
// "seen" state stays consistent whichever of the two pages an admin opens a
// ticket from, since it's the same underlying ticket set either way.
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

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function ChatInboxPage({ toast }: Props) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<ConvRow[]>([]);
  const [claimed, setClaimed] = useState<ConvRow[]>([]);
  const [myTickets, setMyTickets] = useState<ConvRow[]>([]);
  const [resolvedTickets, setResolvedTickets] = useState<ConvRow[]>([]);
  const [closedTickets, setClosedTickets] = useState<ConvRow[]>([]);
  const [onDuty, setOnDuty] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'unclaimed' | 'claimed' | 'mine' | 'resolved' | 'closed'
  >('unclaimed');
  const [search, setSearch] = useState('');
  const [selectedConv, setSelectedConv] = useUrlState('conv');
  const closeConv = useCloseOverlay(['conv']);
  const [messages, setMessages] = useState<ChatMessageT[]>([]);
  const [messagesConvId, setMessagesConvId] = useState<string | null>(null);
  const [resolvedConvId, setResolvedConvId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<{
    userId: string;
    userEmail: string;
    userName: string | null;
    userAvatarUrl: string | null;
    userPhone: string | null;
    userCompany: string | null;
    agentName: string | null;
    agentEmail: string | null;
    shopifyStoreId: string | null;
    shopDomain: string | null;
    shopName: string | null;
    shopOwnerName: string | null;
    shopEmail: string | null;
    shopPhone: string | null;
    shopAddress: string | null;
  } | null>(null);
  const [seenMap, setSeenMap] = useState<Record<string, string>>(() => loadSeenMap());
  const [input, setInput] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // UI-only: whether the right-hand Details panel is shown.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [typing, setTyping] = useState<string | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [fields, setFields] = useState<{ subject: string; category: string; priority: string }>({
    subject: '',
    category: '',
    priority: 'normal',
  });
  const wsRef = useRef<ReturnType<typeof connectAgentWs> | null>(null);
  const selectedRef = useRef(selectedConv);
  selectedRef.current = selectedConv;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const markSeen = useCallback((id: string, at: string) => {
    setSeenMap((prev) => {
      if (prev[id] && new Date(prev[id]).getTime() >= new Date(at).getTime()) return prev;
      const next = { ...prev, [id]: at };
      saveSeenMap(next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const [q, c, m, r, cl, d] = await Promise.all([
      apiFetch<{ rows: ConvRow[] }>('/admin/chatbot/conversations?status=OPEN'),
      apiFetch<{ rows: ConvRow[] }>('/admin/chatbot/conversations?status=IN_PROGRESS'),
      apiFetch<{ rows: ConvRow[] }>('/admin/chatbot/conversations?status=IN_PROGRESS&mine=true'),
      apiFetch<{ rows: ConvRow[] }>('/admin/chatbot/conversations?status=RESOLVED'),
      apiFetch<{ rows: ConvRow[] }>('/admin/chatbot/conversations?status=CLOSED'),
      apiFetch<{ on: boolean }>('/admin/chatbot/duty'),
    ]);
    setQueue(q.rows);
    setClaimed(c.rows);
    setMyTickets(m.rows);
    setResolvedTickets(r.rows);
    setClosedTickets(cl.rows);
    setOnDuty(d.on);
  }, []);

  useEffect(() => {
    void load();
    // onConnectionChange flips wsReady false→true on both the first connect and
    // every reconnect, so the join-on-select effect below re-fires and re-sends
    // `join` for whatever conversation is open — the server only tracks a
    // subscription for the socket that's currently connected.
    wsRef.current = connectAgentWs(
      (f: WsServerFrameT) => {
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
      },
      (connected) => {
        setWsReady(connected);
        // A reconnect means presence (and possibly a claim) may have lapsed
        // while disconnected — refresh the queues rather than trust stale state.
        if (connected) void load();
      },
    );
    return () => {
      wsRef.current?.close();
    };
  }, [load, markSeen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: needed to trigger scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    const conv = [...queue, ...claimed, ...myTickets, ...resolvedTickets, ...closedTickets].find(
      (c) => c.id === selectedConv,
    );
    if (!conv) return;
    setStatus(conv.status);
    setFields({
      subject: conv.subject ?? '',
      category: conv.category ?? '',
      priority: conv.priority,
    });
    setSelectedMeta({
      userId: conv.userId,
      userEmail: conv.userEmail,
      userName: conv.userName,
      userAvatarUrl: conv.userAvatarUrl,
      userPhone: conv.userPhone,
      userCompany: conv.userCompany,
      agentName: conv.agentName,
      agentEmail: conv.agentEmail,
      shopifyStoreId: conv.shopifyStoreId,
      shopDomain: conv.shopDomain,
      shopName: conv.shopName,
      shopOwnerName: conv.shopOwnerName,
      shopEmail: conv.shopEmail,
      shopPhone: conv.shopPhone,
      shopAddress: conv.shopAddress,
    });
    setResolvedConvId(selectedConv);
    markSeen(selectedConv, conv.lastMessageAt);
  }, [
    selectedConv,
    queue,
    claimed,
    myTickets,
    resolvedTickets,
    closedTickets,
    resolvedConvId,
    markSeen,
  ]);

  useEffect(() => {
    if (!selectedConv || !wsReady) return;
    wsRef.current?.send({ type: 'join', conversationId: selectedConv } as WsAgentFrameT);
  }, [selectedConv, wsReady]);

  async function claim(id: string) {
    try {
      await apiFetch(`/admin/chatbot/conversations/${id}/claim`, { method: 'POST' });
      toast({ title: 'Answered' });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to answer conversation',
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

  const byRecency = (a: ConvRow, b: ConvRow) =>
    new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  const q = search.trim().toLowerCase();
  const matchesSearch = (c: ConvRow) =>
    !q || c.userEmail.toLowerCase().includes(q) || (c.subject ?? '').toLowerCase().includes(q);
  const sortedQueue = [...queue].sort(byRecency).filter(matchesSearch);
  const sortedClaimed = [...claimed].sort(byRecency).filter(matchesSearch);
  const sortedMine = [...myTickets].sort(byRecency).filter(matchesSearch);
  const sortedResolved = [...resolvedTickets].sort(byRecency).filter(matchesSearch);
  const sortedClosed = [...closedTickets].sort(byRecency).filter(matchesSearch);
  const list =
    activeTab === 'unclaimed'
      ? sortedQueue
      : activeTab === 'claimed'
        ? sortedClaimed
        : activeTab === 'mine'
          ? sortedMine
          : activeTab === 'resolved'
            ? sortedResolved
            : sortedClosed;
  const selectedConversation = [
    ...queue,
    ...claimed,
    ...myTickets,
    ...resolvedTickets,
    ...closedTickets,
  ].find((c) => c.id === selectedConv);

  const tabs = [
    ['unclaimed', 'Unclaimed', queue.length],
    ['claimed', 'Answered', claimed.length],
    ['mine', 'My tickets', myTickets.length],
    ['resolved', 'Resolved', resolvedTickets.length],
    ['closed', 'Closed', closedTickets.length],
  ] as const;
  const emptyText = search
    ? 'No tickets match your search.'
    : activeTab === 'unclaimed'
      ? 'No unclaimed tickets. You’re all caught up.'
      : activeTab === 'claimed'
        ? 'No tickets answered right now.'
        : activeTab === 'mine'
          ? 'You have no tickets assigned yet.'
          : activeTab === 'resolved'
            ? 'No resolved tickets yet.'
            : 'No closed tickets yet.';

  // System lines ("agent joined", reconnect notices) are bookkeeping, not conversation.
  const visibleMessages = messages.filter((m) => m.role !== 'system');

  const headTitle = selectedMeta?.shopDomain
    ? selectedMeta.shopName || selectedMeta.shopDomain
    : (selectedMeta?.userEmail ?? '—');
  const answeredBy = selectedMeta?.agentName || selectedMeta?.agentEmail || null;

  return (
    <div className={`ci${selectedConv ? ' has-conv' : ''}`}>
      <div className="ci-shell">
        {/* Chat list */}
        <div className="ci-list">
          <div className="ci-list-head">
            <h2>Chats</h2>
            <button
              className={`ci-duty${onDuty ? ' on' : ''}`}
              onClick={toggleDuty}
              title={
                onDuty
                  ? 'You can answer new tickets. Click to go offline.'
                  : 'Go online to start answering new tickets.'
              }
            >
              <i />
              {onDuty ? 'Online' : 'Offline'}
            </button>
          </div>
          <div className="ci-search">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="4.8" />
              <path d="M10.6 10.6 14 14" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label="Search by email or subject"
            />
          </div>
          <div className="ci-tabs">
            {tabs.map(([key, label, n]) => (
              <button
                key={key}
                className={`ci-tab${activeTab === key ? ' active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {label}
                <span className="ci-tab-n">{n}</span>
              </button>
            ))}
          </div>
          <div className="ci-rows">
            {list.length === 0 ? (
              <div className="ci-empty">{emptyText}</div>
            ) : (
              list.map((c) => {
                const unread = isUnread(c, seenMap);
                const title = c.shopDomain ? c.shopName || c.shopDomain : c.userEmail;
                return (
                  <div
                    key={c.id}
                    className={`ci-row${selectedConv === c.id ? ' active' : ''}`}
                    onClick={() => setSelectedConv(c.id)}
                  >
                    <div className="ci-avatar" style={{ background: avatarColor(title) }}>
                      <AvatarFace url={c.userAvatarUrl} fallback={initials(title)} />
                      <span className={`ci-dot ${c.status}`} title={c.status} />
                    </div>
                    <div className="ci-row-body">
                      <div className="ci-row-top">
                        <span className={`ci-row-name${unread ? ' unread' : ''}`}>{title}</span>
                        <span className={`ci-row-time${unread ? ' unread' : ''}`}>
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </div>
                      <div className={`ci-row-preview${unread ? ' unread' : ''}`}>
                        <span>{c.subject || 'No subject'}</span>
                        {unread && <i className="ci-unread-dot" title="Unread" />}
                      </div>
                      <div className="ci-row-meta">
                        <i
                          className="ci-prio"
                          title={`Priority: ${c.priority}`}
                          style={{ background: PRIORITY_COLOR[c.priority] ?? 'var(--muted-2)' }}
                        />
                        <span className="ci-chip accent">{c.shopDomain ? 'Shopify' : 'Web'}</span>
                        {c.category && <span className="ci-chip">{c.category}</span>}
                        {activeTab === 'unclaimed' ? (
                          <button
                            className="ci-btn primary xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              claim(c.id);
                            }}
                          >
                            Answer
                          </button>
                        ) : (
                          <span className="ci-chip xs-right" style={{ marginLeft: 'auto' }}>
                            {c.status}
                          </span>
                        )}
                      </div>
                      <div className="ci-row-sub" title={c.createdAt}>
                        Raised {formatRaisedAt(c.createdAt)}
                      </div>
                      {activeTab !== 'unclaimed' && (c.agentName || c.agentEmail) && (
                        <div className="ci-row-sub">Answered by {c.agentName || c.agentEmail}</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Conversation */}
        <div className="ci-chat">
          {selectedConv ? (
            <>
              <div className="ci-chat-head">
                <button
                  className="ci-icon-btn ci-back"
                  onClick={closeConv}
                  aria-label="Back to chats"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10 3 5 8l5 5" />
                  </svg>
                </button>
                <div className="ci-avatar md" style={{ background: avatarColor(headTitle) }}>
                  <AvatarFace url={selectedMeta?.userAvatarUrl} fallback={initials(headTitle)} />
                  <span className={`ci-dot ${status ?? ''}`} />
                </div>
                <div className="ci-head-text">
                  <div className="ci-head-name">
                    <span>{headTitle}</span>
                    {selectedMeta && (
                      <span className="ci-chip accent">
                        {selectedMeta.shopDomain ? 'Shopify' : 'Web'}
                      </span>
                    )}
                  </div>
                  <div className={`ci-head-status ${status ?? ''}`}>
                    {statusLabel(status)}
                    {selectedConversation &&
                      ` · Raised ${formatRaisedAt(selectedConversation.createdAt)}`}
                  </div>
                </div>
                <div className="ci-head-actions">
                  {status === 'OPEN' && (
                    <button className="ci-btn primary" onClick={() => claim(selectedConv)}>
                      Answer Ticket
                    </button>
                  )}
                  {status === 'IN_PROGRESS' && (
                    <>
                      <button className="ci-btn" onClick={() => resolveConv(selectedConv)}>
                        Resolve
                      </button>
                      <button className="ci-btn" onClick={() => endConv(selectedConv)}>
                        Close
                      </button>
                    </>
                  )}
                  <button
                    className={`ci-icon-btn${detailsOpen ? ' on' : ''}`}
                    onClick={() => setDetailsOpen((v) => !v)}
                    title="Ticket details"
                    aria-label="Toggle ticket details"
                    aria-expanded={detailsOpen}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    >
                      <circle cx="8" cy="8" r="6.4" />
                      <path d="M8 7.2v3.6" />
                      <circle cx="8" cy="5" r="0.5" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="ci-msgs">
                {visibleMessages.map((m, idx) => {
                  const prev = visibleMessages[idx - 1];
                  const day = new Date(m.createdAt).toDateString();
                  const dateSep =
                    !prev || new Date(prev.createdAt).toDateString() !== day ? (
                      <div className="ci-date" key={`d-${m.id}`}>
                        {new Date(m.createdAt).toLocaleDateString(undefined, {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </div>
                    ) : null;
                  const time = new Date(m.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const mine = m.role === 'agent';
                  const showLabel = !prev || prev.role !== m.role;
                  return (
                    <Fragment key={m.id}>
                      {dateSep}
                      <div
                        className={`ci-msg${mine ? ' mine' : ''}${showLabel && idx > 0 ? ' gap' : ''}`}
                      >
                        <div
                          className="ci-avatar sm"
                          style={{
                            background: mine
                              ? 'var(--ci-red)'
                              : m.role === 'bot'
                                ? 'var(--muted)'
                                : avatarColor(headTitle),
                            visibility: showLabel ? 'visible' : 'hidden',
                          }}
                        >
                          {m.role === 'user' ? (
                            <AvatarFace
                              url={selectedMeta?.userAvatarUrl}
                              fallback={initials(headTitle).charAt(0)}
                            />
                          ) : mine ? (
                            'A'
                          ) : (
                            'B'
                          )}
                        </div>
                        <div className="ci-bubble-wrap">
                          <div className="ci-bubble">
                            <div>{renderMessageContent(m.content)}</div>
                            {m.attachmentKey &&
                              (!m.attachmentType || m.attachmentType.startsWith('image/') ? (
                                // biome-ignore lint/performance/noImgElement: chatbot attachment preview, not a Next.js app
                                <img
                                  src={`/v1/support/attachment?key=${encodeURIComponent(m.attachmentKey)}`}
                                  alt="attachment"
                                  style={{
                                    maxWidth: '100%',
                                    borderRadius: 8,
                                    marginTop: 6,
                                    cursor: 'zoom-in',
                                    display: 'block',
                                  }}
                                  onClick={() =>
                                    setPreviewUrl(
                                      `/v1/support/attachment?key=${encodeURIComponent(m.attachmentKey as string)}`,
                                    )
                                  }
                                />
                              ) : (
                                <a
                                  className="ci-attach-link"
                                  href={`/v1/support/attachment?key=${encodeURIComponent(m.attachmentKey)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  View attachment
                                </a>
                              ))}
                          </div>
                          <span className="ci-time">{time}</span>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
                {typing && (
                  <div className="ci-typing">
                    {typing === 'user' ? 'User' : typing === 'agent' ? 'You' : 'Bot'} is typing…
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {status === 'IN_PROGRESS' ? (
                <div className="ci-compose">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMsg()}
                    placeholder="Type your message..."
                    aria-label="Type a reply"
                  />
                  <button
                    className="ci-send"
                    onClick={sendMsg}
                    disabled={!input.trim()}
                    aria-label="Send"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 2 7 9" />
                      <path d="M14 2 9.5 14 7 9 2 6.5 14 2z" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="ci-compose-note">
                  {status === 'OPEN'
                    ? 'Answer this ticket to start replying.'
                    : `This conversation is ${(status ?? '').toLowerCase()} — no further replies can be sent.`}
                </div>
              )}
            </>
          ) : (
            <div className="ci-blank">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinejoin="round"
              >
                <path d="M2 3h12v9H5l-3 2V3z" />
              </svg>
              Select a conversation to start chatting.
            </div>
          )}
        </div>

        {/* Details */}
        {selectedConv && selectedMeta && detailsOpen && (
          <aside className="ci-details">
            <div className="ci-details-head">
              <h3>Details</h3>
              <button
                className="ci-icon-btn"
                onClick={() => setDetailsOpen(false)}
                aria-label="Close details"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                >
                  <circle cx="8" cy="8" r="6.4" />
                  <path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" />
                </svg>
              </button>
            </div>
            <div className="ci-profile">
              <div className="ci-avatar lg" style={{ background: avatarColor(headTitle) }}>
                <AvatarFace url={selectedMeta.userAvatarUrl} fallback={initials(headTitle)} />
              </div>
              <div className="ci-profile-name">{headTitle}</div>
              <div className="ci-quick">
                {selectedMeta.shopDomain ? (
                  <>
                    <button
                      className="ci-btn"
                      onClick={() =>
                        navigate(
                          `/shopify-stores?store=${encodeURIComponent(selectedMeta.shopifyStoreId ?? '')}`,
                        )
                      }
                      disabled={!selectedMeta.shopifyStoreId}
                    >
                      Store details
                    </button>
                    <button
                      className="ci-btn primary"
                      onClick={() =>
                        navigate('/jobs', { state: { search: selectedMeta.shopEmail ?? '' } })
                      }
                      disabled={!selectedMeta.shopEmail}
                    >
                      Store jobs
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="ci-btn"
                      onClick={() =>
                        navigate(`/users?user=${encodeURIComponent(selectedMeta.userId)}`)
                      }
                    >
                      User details
                    </button>
                    <button
                      className="ci-btn primary"
                      onClick={() => navigate('/jobs', { state: { search: selectedMeta.userId } })}
                    >
                      User jobs
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="ci-fields">
              {selectedMeta.shopDomain ? (
                <>
                  <div className="ci-field">
                    <span className="lbl">Store domain</span>
                    <div className="val">{selectedMeta.shopDomain}</div>
                  </div>
                  {selectedMeta.shopOwnerName && (
                    <div className="ci-field">
                      <span className="lbl">Owner</span>
                      <div className="val">{selectedMeta.shopOwnerName}</div>
                    </div>
                  )}
                  {selectedMeta.shopPhone && (
                    <div className="ci-field">
                      <span className="lbl">Phone Number</span>
                      <div className="val">{selectedMeta.shopPhone}</div>
                    </div>
                  )}
                  {selectedMeta.shopEmail && (
                    <div className="ci-field">
                      <span className="lbl">Email</span>
                      <div className="val">{selectedMeta.shopEmail}</div>
                    </div>
                  )}
                  {selectedMeta.shopAddress && (
                    <div className="ci-field">
                      <span className="lbl">Address</span>
                      <div className="val">{selectedMeta.shopAddress}</div>
                    </div>
                  )}
                  <a
                    className="ci-link"
                    href={`https://${selectedMeta.shopDomain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Visit store ↗
                  </a>
                </>
              ) : (
                <>
                  {selectedMeta.userName && (
                    <div className="ci-field">
                      <span className="lbl">Name</span>
                      <div className="val">{selectedMeta.userName}</div>
                    </div>
                  )}
                  {selectedMeta.userPhone && (
                    <div className="ci-field">
                      <span className="lbl">Phone Number</span>
                      <div className="val">{selectedMeta.userPhone}</div>
                    </div>
                  )}
                  <div className="ci-field">
                    <span className="lbl">Email</span>
                    <div className="val">{selectedMeta.userEmail}</div>
                  </div>
                  {selectedMeta.userCompany && (
                    <div className="ci-field">
                      <span className="lbl">Company</span>
                      <div className="val">{selectedMeta.userCompany}</div>
                    </div>
                  )}
                </>
              )}
              <div className="ci-field">
                <span className="lbl">Answered by</span>
                <div className="val">
                  {answeredBy
                    ? `${answeredBy}${selectedMeta.agentName && selectedMeta.agentEmail ? ` (${selectedMeta.agentEmail})` : ''}`
                    : 'Unassigned'}
                </div>
              </div>

              <div className="ci-section">TICKET</div>
              <div className="ci-field">
                <label htmlFor="support-ticket-subject">Subject</label>
                <input
                  id="support-ticket-subject"
                  value={fields.subject}
                  onChange={(e) => setFields((f) => ({ ...f, subject: e.target.value }))}
                  onBlur={() => updateFields(selectedConv, { subject: fields.subject })}
                  placeholder="No subject"
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="lbl" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Category
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="lbl" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Priority
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
          </aside>
        )}
      </div>

      {previewUrl && <ImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}
