# WhatsApp conversation trace (admin debug page)

2026-10-27. A debug view of what the WhatsApp bot received and sent, per seller,
kept in Redis for 4 days.

## Why

Reports like "I don't get the full list after the recognition timeout" can't be
checked after the fact: the session is overwritten on every step and the
messages sent are not stored anywhere. Admins need the inbound events, the
outbound messages with their options, and any send failures in one timeline.

## Scope

In: record inbound events and outbound messages per seller number; an admin tab
to browse them. Out: engine state per message, photo previews (only the stored
photo key is shown), search, export, any long-term storage.

## Storage (Redis only)

- `wa:trace:{externalId}` — list of JSON entries, oldest first. Each write does
  `RPUSH`, `LTRIM` to the last 300 entries, and `EXPIRE` 4 days (refreshed on
  every write).
- `wa:trace:index` — sorted set, member `externalId`, score last-activity ms.
  Entries scored older than 4 days are removed (`ZREMRANGEBYSCORE`) when the
  index is read, so senders whose list has expired drop out.

Entry shape (`TraceEntry`):

- common: `t` (ms epoch), `dir` (`in` | `out`)
- `in`: `kind` (`text` | `reply` | `image` | `unsupported`), `text?`, and for a
  tap `action` / `value` (decoded with the existing reply-id codec; the nonce is
  not stored), `garmentKey?` for an image
- `out`: `kind` (`text` | `buttons` | `list` | other renderer kinds as they
  exist in `OutboundMessage`), `text`, `buttons?` (`{id,title}[]`),
  `list?` (`{buttonLabel, rows:{id,title,description?}[]}`), `status`
  (`sent` | `failed` | `skipped`), `error?` (short string)

Recording is best effort: any Redis error is caught and logged at `warn`, never
thrown, so a trace failure cannot block or fail a send or an inbound.

## Hook points

- `messaging/trace.ts` (new): `traceInbound`, `traceOutbound`, `listSenders`,
  `readTimeline`. Owns key names, TTL, cap and entry shapes.
- `messaging/inbound.ts` `processInbound`: record the inbound event once the
  message is parsed (including the unknown-number and rate-limited paths, since
  those are what an admin debugging "no reply" needs).
- `messaging/send.ts` `sendMessages`: record each `OutboundMessage` after its
  send attempt with `sent`, `failed` (error recorded, then the original error is
  rethrown as today) or `skipped` (outside the 24h window, today's early return).
  All outbound paths, including run-finished delivery, already go through it.

## API

Both under `jobs.read` (same as the Requests tab), in a new
`admin/whatsapp-conversations.routes.ts`:

- `GET /admin/whatsapp/conversations` → `{ items: { externalId, lastAt, count, preview }[] }`
  most recent first. `count` = `LLEN`, `preview` = text of the last entry.
- `GET /admin/whatsapp/conversations/:externalId` → `{ entries: TraceEntry[] }`
  oldest first.

Zod schemas for the responses live in `packages/types` (`whatsapp-trace.ts`).
Full phone numbers are returned: admins debug a specific seller. The data
expires after 4 days and is gated by `jobs.read`.

## Admin UI

New `Conversations` tab in `apps/admin-web/src/pages/WhatsAppPage.tsx`
(`useUrlState('tab')` pattern, per `docs/admin-url-routing-standard.md`; the
selected sender is a URL param). Component `pages/whatsapp/ConversationsTab.tsx`:

- left: sender list (number, relative last activity, count);
- right: chat thread — seller bubbles on one side, bot bubbles on the other;
  buttons and list rows render as chips showing title and id; `failed` is red
  with the error, `skipped` is muted with a note;
- refetches every 5 s while the tab is visible, plus a manual refresh button.
- uses `C`/admin tokens, no raw hex; no dropdowns needed.

## Tests

- trace unit/integration (docker Redis): entries ordered, capped at 300, TTL set
  and refreshed, index trimmed, a Redis failure does not throw.
- `sendMessages`: records `sent`; records `failed` and still throws; records
  `skipped` on the outside-window code.
- routes: list and timeline shapes, 403 without `jobs.read`.

## Risks

- Phone numbers and seller text sit in Redis for 4 days. Mitigation: TTL,
  permission gate, no photo bytes.
- One extra Redis round trip (pipeline of 3 commands) per message sent or
  received; negligible next to the WhatsApp API call.
