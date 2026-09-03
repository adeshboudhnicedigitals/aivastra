# Chatbot: detach the LLM agent, turn HITL into a ticket system

Date: 2026-09-03
Status: approved (pending final spec review)

## Problem

`apps/chatbot` currently runs a two-step LangChain "agent" (router tool-call
pass + generation pass, `agent/bot.ts`) that answers user messages
automatically, escalating to a human on low confidence, explicit user
request, or an unhandled question. Support already exists for a human
hand-off (`PENDING_HUMAN`/`HUMAN` statuses, agent queue, `ChatInboxPage`).

We want to remove the LLM from the answering path entirely and lean fully
into the human-in-the-loop (HITL) side, reshaping it into a support-ticket
system: every user message becomes/continues a ticket that a human agent
picks up, with a subject, category, priority, and optional image
attachments — and unify the three separate places a user can currently
reach support (chat bubble, Contact Us page, navbar Support modal) into
that one ticket, instead of three disconnected mechanisms.

## Goals

- No LLM/RAG call sits between a user message and a human agent. The bot
  turn, router/gen prompts, and auto-escalation heuristics are removed from
  the live path.
- One active ticket per user (unchanged constraint from today's one active
  conversation per user) — no ticket-list UI, no concurrent tickets.
- Chat bubble, Contact Us page, and navbar Support modal all create/append
  to that same one ticket. A user who fills out Contact Us and later opens
  the chat bubble sees the same thread.
- Tickets carry `subject`, `category`, `priority`, `source`, and messages
  can carry a single image attachment, mirroring what `SupportModal`
  already does today for one-shot support requests.
- Agent inbox (`ChatInboxPage`) becomes a ticket queue: claim, work,
  resolve/close, sorted by priority and age.

## Non-goals

- Multiple concurrent tickets per user (explicitly declined — stays
  single-active-ticket, same as today).
- Explicit "reopen" flow distinct from today's implicit behavior (new
  message on a `CLOSED` ticket already starts a fresh one).
- Deleting the RAG knowledge base (`chatbot_qna`, `chatbot_embeddings`,
  ingest pipeline, `ChatbotQnaPage`) — it stays in place, unused, for
  possible future agent-assist reuse.
- SLA as a stored/enforced field — "aging" is computed from
  `lastMessageAt`/`createdAt` for queue sort/highlight, not a tracked SLA
  deadline.
- Production data/schema work — this ships through the normal
  push → CI/CD → `db:migrate:prod` pipeline, never ad hoc.

## Constraint: hide, don't delete

Per explicit instruction during this design: code that becomes unused
(the LLM agent module, the availability-gated email-fallback branch) is
**unwired, not deleted**. Files and their contents stay on disk; only the call
sites/route registrations that invoke them are removed or left dead. The
one exception is unit tests that assert now-nonexistent behavior (e.g. a
bot-turn/fallback test) — those get deleted because the behavior itself is
gone, not hidden.

## Architecture

Core shift: the chatbot service stops running LLM turns. Every message,
from any entry point, creates or updates one ticket per user
(`chatbot_conversations` — the table keeps its name; think of a row as a
ticket). There is no `BOT` status, no router/gen LLM call, no fallback
counting, no auto-escalate reasoning.

Flow: user message (WS or REST) → get-or-create the user's active ticket
→ new ticket starts at `OPEN` (skips straight to the human queue, no bot
detour) → message persisted + published over the ticket's Redis channel →
agent claims it from the queue → `IN_PROGRESS` → agent replies live over
WS → agent resolves/closes.

Three intake surfaces, one ticket:

- **Chat bubble** (`chat-widget.tsx`) — live WebSocket, transport
  unchanged.
- **Contact Us page** (`apps/catalogues-web/src/app/(app)/contact-us`) —
  posts once; becomes or continues the ticket.
- **Navbar Support modal** (`SupportModal.tsx`/`SupportButton`, the
  headphone icon in `topbar.tsx` — a separate component from the chat
  bubble today) — posts once, with an optional image attachment; becomes
  or continues the ticket.

The chat bubble keeps talking to `apps/chatbot` directly over WS, as
today. Contact Us and the Support modal keep posting to `apps/api`
(`/v1/contact`, `/v1/support`) rather than moving to `apps/chatbot` — this
was revised during planning once file-mapping showed `apps/api`'s admin
chatbot routes (`chatbot.routes.ts`: claim/takeover/end) already write
directly into `chatbot_conversations`/`chatbot_messages` and publish to
the same Redis channels the chatbot service uses. There is no "only
`apps/chatbot` touches ticket state" boundary in the actual codebase to
preserve, so `/v1/contact` and `/v1/support` are repurposed to write
directly into the ticket tables and publish over Redis, mirroring
`adminChatbotRoutes`' `publishConv`/`publishQueue`/`systemMessage`
helpers, instead of adding a new REST surface and a `StorageProvider` to
`apps/chatbot` that would duplicate what `apps/api` already has.

## Data model

### `chatbot_conversations` (the ticket table)

Changed/added columns:

- `status`: drops `BOT`. New set:
  - `OPEN` — queued, no agent assigned yet (replaces `PENDING_HUMAN` as
    the entry state; there is no `BOT` state to transition from anymore).
  - `IN_PROGRESS` — agent assigned and actively chatting (was `HUMAN`).
  - `RESOLVED` — agent marked the issue done; ticket stays visible/
    readable. A new message from the user flips it back to `OPEN` and
    clears the assignment — this gives a "resolved" concept without a
    full reopen flow (which was explicitly out of scope).
  - `CLOSED` — final/archived. Reached via explicit agent close or the
    existing sweeper after inactivity, same as today.
- `source`: text, one of `chat_widget` | `contact_us` | `support_modal`,
  set once at ticket creation.
- `category`: text, nullable, app-layer enum `billing` | `bug` | `order` |
  `account` | `other`. Agent-editable.
- `priority`: text, default `normal`, one of `low` | `normal` | `high` |
  `urgent`. Agent-editable; drives queue sort.
- `subject`: text, nullable. Auto-derived from the first message
  (truncated, ~80 chars) at creation; agent-editable.
- `escalationReason` column: dropped. There is no bot to produce
  `low_confidence`/`agent_join` reasons anymore — a ticket's reason for
  existing is simply "the user opened one."

### `chatbot_messages`

- add `attachmentKey`: text, nullable.
- add `attachmentType`: text, nullable (mime type).

One attachment per message, matching the single-file pattern
`SupportModal` already uses today.

### Migration

Existing rows map `BOT` → `OPEN`, `PENDING_HUMAN` → `OPEN`, `HUMAN` →
`IN_PROGRESS` in the same migration that alters the `status` column and
adds the new columns. This only ever runs against dev/staging data through
the normal `db:migrate` step — never ad hoc, never against prod.

### `contact_requests`

No new writes — `/v1/contact` and `/v1/support` are rewritten in place
(see Backend changes below) to write into the ticket tables instead of
`contact_requests`. The table and its existing rows stay untouched; the
admin contact-requests inbox page stays but is relabeled as
legacy/history — no destructive drop of existing support history.

## Backend changes

### `apps/chatbot`

- `agent/bot.ts`, `agent/tools.ts`, `agent/models.ts`, `agent/search.ts` —
  files stay as-is; nothing imports them anymore. `makeGenModel`/
  `makeToolModel` come off `ChatbotDeps` (or stay present but unused — no
  material cost either way).
- `conversation/orchestrator.ts` — `handleUserMessage` drops the
  `runBotTurn` branch entirely: append message → get-or-create ticket (new
  ticket starts `OPEN`) → if newly created, publish `queue_update` → done.
  No fallback counter, no bot-turn timer/metric.
- `conversation/escalation.ts` — the agent-availability check and
  `emailFallback` (which wrote to `contact_requests`) stay as unwired
  code. New tickets always go straight to `OPEN` regardless of on-duty
  status; agents see them whenever they come online. The existing
  acknowledgment email (`sendReportReceivedEmail`) can still fire on
  ticket creation so the user isn't left wondering — small, cheap addition,
  independent of agent availability.
- `ws/gateway.ts` — the user-side `message` frame gains an optional
  `attachmentKey`; `appendMessage` passes it through into the new message
  columns.

### `apps/api`

- `/v1/support/presign` (`modules/support/routes.ts`) — unchanged; still
  returns a presigned PUT via `keys.supportAttachment`.
- `/v1/support` (`modules/support/routes.ts`) — body stays
  `{ message, attachmentKey? }`. Instead of inserting into
  `contact_requests`, it now does what `adminChatbotRoutes`' helpers do:
  get-or-create the user's active ticket (same query
  `getOrCreateActiveConversation` in `apps/chatbot` runs, reimplemented
  here against the shared `@aivastra/db` schema — new ticket starts
  `OPEN`, `source: 'support_modal'`), insert the message with its
  `attachmentKey`/`attachmentType`, bump `lastMessageAt`, publish
  `{ type: 'message', message }` on `chatbot:conv:{id}` and, if newly
  created, `{ type: 'queue_update' }` on `chatbot:queue`.
- `/v1/contact` (`modules/jobs/routes.ts`) — same treatment, `source:
  'contact_us'`, no attachment.
- Both routes need the same per-user rate-limit guard the WS `message`
  frame already applies (10 messages / 30s), so a form can't bypass it.
- The old `contact_requests` insert in each route is removed (not just
  unwired) since the route itself is being rewritten in place, not
  replaced by a new one — the "hide, don't delete" constraint applies to
  code that becomes *unreferenced*, not to a route body being rewritten
  to do the equivalent job differently. `contact_requests` the table and
  its historical rows are untouched either way.

## Frontend changes

### `apps/catalogues-web`

- `contact-us/page.tsx` — keeps posting to `/v1/contact` (URL unchanged);
  only the response/success copy changes to reflect "an agent will
  respond in your chat" instead of a generic "message sent" confirmation,
  since the backend now opens/continues a real ticket instead of a
  fire-and-forget row.
- `SupportModal.tsx` — keeps its existing `/v1/support/presign` +
  `/v1/support` calls (URLs unchanged); only the post-submit copy changes
  the same way.
- `chat-widget.tsx` — gains attachment support: file picker, presign +
  upload before sending a `message` WS frame with `attachmentKey`; render
  image attachments inline. Reuses `SupportModal`'s existing upload
  pattern.
- Net effect: regardless of which of the three surfaces a user starts
  from, they land in the same ticket, visible live in the chat bubble.

### `apps/admin-web` (`ChatInboxPage.tsx`)

- Three-column layout (`Queue` / `Bot Live` / `My Conversations`) becomes
  two: `Queue` (was `PENDING_HUMAN`, now `OPEN`) and `My Tickets` (was
  `HUMAN`/`myConvs`, now `IN_PROGRESS`). The `Bot Live` panel is removed —
  nothing is ever bot-live anymore.
- Ticket rows show `subject`, a `category` badge, a `priority` badge
  (color-coded), and computed age from `lastMessageAt`/`createdAt` (no
  stored SLA field — just used for sort/highlight).
- Queue is sortable/filterable by priority then age.
- Conversation pane renders attachment messages as image thumbnails (click
  for full size); agent can edit `category`/`priority`/`subject` inline.
  The "End" button becomes two actions: "Resolve" (→ `RESOLVED`) and
  "Close" (→ `CLOSED`).
- `ChatbotQnaPage.tsx` and its nav entry are untouched.

## Error handling and edge cases

- A form (Contact Us/Support modal) posts while the ticket is already
  `IN_PROGRESS` or `RESOLVED`: still appends to the same active ticket.
  `RESOLVED` flips back to `OPEN` and unassigns on any new message.
- Ticket is `CLOSED`: `getOrCreateActiveConversation` already excludes
  `CLOSED` from "active," so the next message opens a fresh ticket —
  unchanged from today's behavior.
- Attachment upload fails mid-flow (presign succeeds, PUT fails): message
  still sends text-only if `attachmentKey` was never set client-side —
  same failure mode `SupportModal` already handles today.
- An agent sends a message to a ticket not assigned to them: the existing
  assigned-agent check in `ws/gateway.ts` stays, now checked against
  `IN_PROGRESS` instead of `HUMAN`.
- No agents on duty: the ticket just sits `OPEN` — there is no
  availability-gated email-fallback anymore (that branch is unwired, not
  deleted, per the "hide, don't delete" constraint). This is a known,
  accepted gap: an abandoned `OPEN` ticket with no agents on duty has no
  automatic escalation. Worth a follow-up (stale-ticket alert) but out of
  scope here.

## Testing

- `apps/chatbot` integration tests: new tickets go straight to `OPEN` (no
  `BOT` transition to assert); new tests for `POST /tickets/message` and
  `POST /tickets/presign`; attachment fields round-trip through
  `listMessages`.
- Existing orchestrator/escalation unit tests that assert bot-turn or
  fallback-count behavior are deleted outright — the behavior itself is
  gone, so keeping the test would assert something false. This is the one
  deliberate exception to "hide, don't delete."
- `ChatInboxPage` has no existing test suite; verify manually via the dev
  server (claim, resolve, close, attachment rendering).
- Migration: run locally against `pnpm docker:up`, confirm `db:migrate`
  applies cleanly, confirm dev-seeded conversations map to the correct new
  status.

## Open items for the implementation plan

- Whether `makeGenModel`/`makeToolModel` are removed from `ChatbotDeps` or
  left present-but-unused (low-stakes, pick either during implementation).
- Exact `category` enum values beyond the five listed here, if more
  granularity is wanted later.
