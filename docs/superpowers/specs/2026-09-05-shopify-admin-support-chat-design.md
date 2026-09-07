# Shopify admin support chat — design

**Date:** 2026-09-05
**Status:** Approved, ready for implementation plan

## Overview

Merchants using the embedded Shopify admin app (`apps/shopify`) currently have no
way to reach Aivastra support from inside that app. `apps/catalogues-web` already
has a full support-ticket chat (`chat-widget.tsx`) backed by `apps/chatbot` +
`apps/api`'s ticket system (see
`docs/superpowers/specs/2026-09-03-chatbot-detach-agent-ticket-system-design.md`).
This spec adds a second, Shopify-styled front end for that same backend, with no
changes to the ticket schema, the chatbot WS gateway, or any existing invariant.

## Goals

- A merchant inside the embedded Shopify admin can open a support chat and
  exchange text messages with a human agent.
- Tickets created this way appear in the existing admin `ChatInboxPage` queue,
  tagged so agents can tell they came from a Shopify merchant.
- Zero changes to `apps/chatbot`'s WS auth, the `chatbot_conversations` schema,
  or the one-active-ticket-per-user invariant.

## Non-goals (this pass)

- Attachment upload (images/PDF) — text-only for v1, matching the existing
  chat-widget's attachment code path is out of scope until requested.
- Shopper-facing (storefront) live chat — this spec covers the merchant-facing
  embedded admin only.
- Any change to `shopify_stores.owner_user_id` — that column already has a
  distinct meaning (the real platform account, when one exists, linked to a
  store for admin reporting / "my stores" views:
  `apps/api/src/modules/admin/credit-analysis.routes.ts`,
  `apps/api/src/modules/admin/users.routes.ts`,
  `apps/api/src/modules/auth/routes.ts`). This spec does not read or write it.

## Why this shape (auth bridge)

The chatbot's WS gateway only understands one identity: a platform JWT verified
against `JWT_SECRET`, `sub` = `users.id` (`apps/chatbot/src/ws/tickets.ts`,
`routes/conversations.ts`). The Shopify embedded admin authenticates with a
completely different mechanism — an App Bridge session token verified against
`SHOPIFY_API_SECRET`/`SHOPIFY_API_KEY` (`apps/api/src/plugins/shopify-auth.ts`'s
`requireShopifySession`) — and most stores have no linked platform user at all
(`shopify_stores.owner_user_id` is nullable and typically unset under managed
installation).

Two approaches were considered:

- **(Chosen) Synthetic per-store support user.** Add a new, dedicated
  `shopify_stores.support_user_id` column. On first use, `apps/api` lazily
  creates one platform `users` row per store purely to own its tickets, mints
  it a normal access JWT, and hands that to the SPA. The SPA then drives the
  *existing* `apps/chatbot` `/ws-ticket` + WS flow unchanged — chatbot has no
  idea the caller is Shopify-backed. Small, additive, and touches nothing that
  currently works.
- **(Rejected) Store-aware ticket schema.** Add `shopifyStoreId` to
  `chatbot_conversations`, rework the one-active-ticket-per-user unique index,
  teach chatbot's WS auth a second verifier for Shopify session tokens. This is
  a bigger change to code that's already correct and load-bearing (the
  uniqueness invariant is relied on by three existing call sites), for no user
  or agent-visible benefit over the chosen approach. Rejected as YAGNI.

## Data model

New migration, `packages/db/src/schema/shopify.ts`:

```ts
supportUserId: uuid('support_user_id').references(() => users.id, { onDelete: 'set null' }),
```

Nullable, independent of `owner_user_id`. Populated lazily, never by
`shopify-auth.ts`'s provisioning path.

`source` (`packages/db/src/schema/chatbot.ts:59`, passed through as a plain
`string` param — e.g. `apps/chatbot/src/conversation/service.ts:41` — not a
typed literal union anywhere) needs no schema or type change at all: the new
call site simply passes `'shopify_admin'` as the value. Confirmed non-branching
everywhere it's currently read (`apps/admin-web/src/pages/ChatInboxPage.tsx`
only displays `source`, never switches on it).

## API

New route, `apps/api/src/modules/shopify/support.routes.ts`:

```
POST /v1/shopify/support/session
```

- Gated by the existing `requireShopifySession` plugin — identical auth
  requirement to every other `apps/shopify` → `apps/api` call.
- Handler: `getOrCreateSupportUser(tx, storeId)` — inside one transaction,
  `SELECT` the store's `support_user_id`; if null, `INSERT` a new `users` row
  (email `shopify-support+{storeId}@internal.aivastra.com`, `passwordHash:
  null` — the same passwordless shape Google-OAuth accounts already use
  (`apps/api/src/modules/auth/google-upsert.ts`) — `emailVerified: true` so no
  downstream code path chokes on an unverified account) and `UPDATE
  shopify_stores.support_user_id`. Idempotent — a second call is a plain read.
- Response: `{ token: string }` — a normal platform access JWT for that
  synthetic user, signed with the same `signAccessToken` helper
  `apps/api/src/modules/auth/service.ts` already uses for real logins.

No new route is added to `apps/chatbot`. The SPA calls its existing
`/ws-ticket` and WS endpoints with the token from the response above, exactly
as `apps/catalogues-web/src/components/chat-widget.tsx` does today.

**Known, accepted tradeoff:** the minted token is a real platform access token.
It could technically authenticate other user-scoped `apps/api` routes as the
synthetic account. Blast radius is low — the account holds no credits, no
uploads, no catalog data, and exists solely to own support tickets — but this
is a deliberate scope decision, not an oversight, and worth revisiting if a
future need calls for a narrower-scoped token (e.g. an audience claim the
chatbot's verifier checks and other routes reject).

## Frontend (`apps/shopify`)

- `src/pages/SupportPage.tsx` already has a "Live chat" card whose button
  currently does `url: 'https://app.aivastra.com/support', target: '_blank'`
  — breaking out of the embedded admin iframe into catalogues-web's own
  Support modal. That button becomes the trigger for a Polaris `Modal`
  containing the new chat, replacing the external link. No new nav item or
  app-shell change needed — this page is already the intended entry point.
- `src/components/SupportChat.tsx` — the `Modal` body. No dark-mode token
  work needed — Polaris themes itself.
- `src/hooks/useSupportChat.ts` — a trimmed port of `chat-widget.tsx`'s
  WS-connection/message-list logic: no file input, no `AttachmentImage`, no
  attach/send SVG icon work. Message bubbles rendered with Polaris primitives
  (`Text`, `Box`, `Avatar` as needed) rather than the catalogues-web app's
  hand-styled bubbles.
- Session flow: on first open, call `POST /v1/shopify/support/session` with a
  **freshly fetched** App Bridge session token (never a cached one — App
  Bridge tokens are short-lived, matching how `apps/shopify/src/lib/api.ts`
  already fetches one per call), store the returned platform JWT in memory
  only (module-level variable, matching `apps/catalogues-web`'s
  never-in-storage rule for access tokens), then proceed through the existing
  `/ws-ticket` → WS flow.

## Error handling

- `requireShopifySession` failure (expired/invalid session token) → standard
  401, same reauth path every other Shopify-admin call already has. No new
  error handling needed here.
- WS disconnect or platform-JWT expiry mid-session → re-call
  `POST /v1/shopify/support/session` (cheap no-op after first use) for a fresh
  token, then re-mint a WS ticket and reconnect — same shape
  `chat-widget.tsx`'s existing reconnect logic already follows.
- `getOrCreateSupportUser`'s insert racing a concurrent first-open (two tabs)
  is handled by doing the read-then-write inside one transaction; a unique
  constraint on `support_user_id` is not needed since the column itself isn't
  unique-constrained — a benign duplicate synthetic user in a race is
  acceptable (rare, low-cost, cleanup-able) rather than adding retry
  complexity for an edge case with no user-visible impact.

## Testing

- `apps/api/test/integration/shopify-support-session.test.ts`: creates a
  support user on first call, returns the same user id on a second call
  (idempotency), 401 without a valid session token, and confirms the returned
  token successfully mints a chatbot WS ticket end-to-end.
- `pnpm --filter @aivastra/shopify typecheck` / `build` clean.
- Manual verification (no automated UI test, matching this repo's existing
  convention of not unit-testing `chat-widget.tsx` itself): open the embedded
  admin locally, send a message via `SupportChat`, confirm it lands in
  `ChatInboxPage` tagged `shopify_admin`, reply as an agent, confirm the reply
  arrives back in the SPA over WS.

## Deferred (ledgered, not forgotten)

- Attachment upload for the Shopify admin chat.
- Any shopper-facing (storefront) live chat.
- Narrower-scoped tokens for synthetic support users, if a future routes needs
  it.
