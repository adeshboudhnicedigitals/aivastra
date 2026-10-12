# WhatsApp catalog bot — design

**Date:** 2026-10-12
**Status:** draft for management review (2026-10-13). Not approved for implementation; no code
written. Section 18 lists the questions that still need an answer.
**Scope:** a WhatsApp bot that lets a seller generate catalog images (the same try-on generation
the web studio does) entirely from a WhatsApp chat. The design is "channel-ready" so Facebook
Messenger and Instagram DMs can be added later without a rewrite, but only WhatsApp is built in v1.

---

## 1. Summary for management

- A seller messages the Aivastra WhatsApp number, sends a garment photo, picks a model face,
  background and pose by tapping image cards inside WhatsApp, confirms the credit cost, and
  receives the generated catalog image back in the same chat.
- It runs on the **same generation pipeline, credits and accounts** as the web app. Images made
  on WhatsApp show up in the seller's `/catalogs` page on the web, and credits are one shared
  balance.
- New sellers can start on WhatsApp with no email or password. Their phone number is their
  identity, and they get the same free trial credits as a web sign-up. They can add an
  email/password later to use the web app.
- Existing web users connect their WhatsApp number to their account through a one-time login
  link, so their history and credits are shared.
- **Buying credits happens on the web app in v1**, reached through a one-time login link the bot
  sends. No payment code changes. Paying inside the chat (Razorpay payment link) is a later
  improvement.
- **We need a Meta Business account and business verification.** We have none today, so this is
  the critical path. Verification can take days. Development can start immediately on Meta's free
  test number in parallel.
- Running cost: replies inside 24 hours of the seller's last message are free; messages we start
  after that window (e.g. "your image is ready" when generation took long and the window closed)
  are charged per message by Meta.

## 2. Goals and non-goals (v1)

**Goals**
- Guided, menu-driven catalog generation in WhatsApp, one garment per run.
- Shared account, credits and results with the web app.
- WhatsApp-first sign-up with the standard free trial.
- Linking an existing web account to a WhatsApp number.
- English only.
- A structure that lets Messenger and Instagram be added later as one adapter each.

**Non-goals for v1** (all deferred, not rejected)
- Batch (many garments in one run).
- Paying inside the chat.
- Saree, saree-mannequin and fabric-to-garment flows (see open question Q1).
- Accessories, regeneration and refund requests (these stay web-only).
- Languages other than English.
- Messenger and Instagram adapters.
- Merging two separate pre-existing accounts (see open question Q2).
- Any AI/LLM free-text understanding. The bot is a deterministic menu.

## 3. Decisions made so far

| # | Question | Decision |
|---|---|---|
| D1 | Who is the bot for? | Both: existing web users (link their number) and new WhatsApp-only sellers (account created from the phone number). |
| D2 | Where does the WhatsApp identity live? | New table, not new columns on `users`. `users` gets no migration. |
| D3 | Duplicate accounts | Avoided at the first message by asking "New to Aivastra, or do you already have an account?". WhatsApp-first users "claim" by adding email/password to the same row. Merging two existing accounts is not in v1. |
| D4 | Conversation style | Guided menu (like the web studio wizard), not one-shot. |
| D5 | How assets are shown | WhatsApp interactive media carousel (image cards with a Select button), with a numbered contact-sheet image as fallback. |
| D6 | Payments | v1: buy on the web app via a one-time login link. In-chat Razorpay payment link deferred. |
| D7 | Garments per run | One garment per run. "New pose, same garment" button covers multiple shots of one SKU. |
| D8 | Language | English only. Copy lives in one constants file. |
| D9 | Where the code runs | Module inside `apps/api` (approach A, section 5). |
| D10 | Meta integration | Directly on Meta's WhatsApp Cloud API, no BSP (section 4). |
| D11 | Other Meta channels | Channel-ready design: generic identity table and an abstract message layer; only the WhatsApp adapter built. |
| D12 | Free trial | WhatsApp sign-ups get the same `FREE_TRIAL` grant as web, at account creation. |

## 4. Meta platform setup

Every WhatsApp business bot runs on Meta's WhatsApp Business Platform. The choice is between
going direct (Cloud API) and going through a Business Solution Provider (BSP) such as Gupshup,
Interakt, AiSensy or Twilio.

| | Developers | Users / business |
|---|---|---|
| **Direct Cloud API (chosen)** | We own the integration. New message types (e.g. carousels) arrive on Cloud API first. Onboarding paperwork is ours, done once. | Meta's per-message price with no markup. |
| BSP | The BSP handles onboarding, but its API wraps Meta's and new message types arrive late or not at all. | Per-message markup plus a monthly fee. |

### What is needed (we have nothing yet)

The steps below are from our understanding of Meta's process and should be checked against
Meta's current documentation while doing them.

1. **Meta Business Portfolio** at business.facebook.com, with **business verification**
   (company documents such as GST or incorporation certificate, and a website whose details
   match the business, e.g. aivastra.com). Without verification, messaging limits stay low and
   the display name cannot be approved. **This is the long pole: start it first.**
2. **Meta Developer app** at developers.facebook.com, type "Business", with the WhatsApp product
   added. This immediately provides a free **test number** that can message up to 5 registered
   recipient numbers. All development and staging work runs on it.
3. **WhatsApp Business Account (WABA)** with a **production phone number** that is not currently
   registered on the WhatsApp or WhatsApp Business app (otherwise it has to be migrated off), and
   **display-name approval** ("Aivastra").
4. **System user and a permanent access token** with `whatsapp_business_messaging` and
   `whatsapp_business_management` permissions. The temporary token shown in the developer console
   expires after about a day and must not be used in production.
5. **Webhook** pointing at `https://app.aivastra.com/v1/whatsapp/webhook` with a verify token,
   subscribed to the `messages` field. The app secret is used to verify each request's
   `X-Hub-Signature-256` header.
6. **Payment method on the WABA**, for business-initiated (template) messages.
7. **Message templates** submitted for approval: at least a utility template "Your catalog image
   is ready" with a button, used when the 24-hour window has closed (section 11).

The same Business Portfolio and developer app are reused later for Messenger and Instagram, but
those channels additionally need Meta **App Review** for their messaging permissions (a screencast
submission).

Per `CLAUDE.md`, each of these dashboard settings is recorded in `docs/progress.md` as it is
done, since none of it lives in the repo.

## 5. Architecture

### Approaches considered

| | Developers | Users |
|---|---|---|
| **A. Module inside `apps/api` (chosen)** | Least new surface: no new service, Compose entry or CI target. Calls the existing `createJob` in-process, so credit deduction and validation are identical to web. Downside: Meta webhook traffic and outbound Meta calls share the api process, and a bot bug ships with an api deploy. | Fastest to launch. Same latency as web. |
| B. New `apps/whatsapp-bot` service calling the api over HTTP | Clean isolation, own deploys. But needs a service-to-service auth path to act as a user, a new Compose service, CI detection, separate env files, and job creation over HTTP. | Same experience, more moving parts that can fail. |
| C. Extend `apps/chatbot` | It has conversation plumbing but is a human support-ticket system. Mixing catalog generation into it tangles two products; still needs HTTP to the api. | No benefit. |

The module is written so it can be lifted into its own service (B) later if volume warrants it:
everything lives under one folder, behind a feature flag, and talks to the rest of the api only
through a few existing functions.

### Components

```
Meta Cloud API ──webhook──▶ POST /v1/whatsapp/webhook   (verify signature, ack 200 immediately)
                              │
                              ▼
                 Redis stream  messaging:inbound    (durable; dedupe on Meta message id)
                              │
                 inbound consumer (api background loop, like startSyncConsumer)
                              │
             ┌────────────────┼──────────────────────┐
             ▼                ▼                      ▼
        identity.ts      engine/ (state machine)   channels/whatsapp/
   (messaging_accounts,  pure function:            (render abstract messages to
    login-link tokens,   session + event ➜         Cloud API JSON; send; media
    account creation)    new session + messages)   download; signature check)
                              │
                              ▼
                 createJob(...)  — existing path: validate ➜ credit deduct ➜ jobs row ➜ XADD
                              │
  dispatcher ── Redis pub/sub sse:events:admin ──▶ result notifier ──▶ send result to the chat
                                                 + delivery sweeper (catches missed events)
```

Why each piece exists:

- **Webhook to Redis stream, then ack.** Meta retries slow or failed webhooks and may deliver the
  same message twice. Writing the raw event to a stream and acknowledging immediately means a
  crash mid-processing never loses a seller's photo, and the message-id dedupe means a retry is
  processed once.
- **Inbound consumer** runs as an api background loop, started in `apps/api/src/main.ts` after
  `app.listen(...)` like the other loops, with an exported tick function so tests can drive it.
- **Engine is a pure function** `(session, inboundEvent) → (newSession, outboundMessages[])`. It
  knows nothing about WhatsApp. This is what makes it testable without Meta and reusable for
  other channels.
- **Garment photo:** downloaded from Meta's media endpoint, uploaded to MinIO using the existing
  upload key builders, and its ownership recorded the same way `/v1/uploads/presign` does
  (`upload:owner:{key}`), so `createJob` accepts it unchanged and the hourly upload sweeper cleans
  up abandoned ones.
- **Result notifier** listens to the dispatcher's existing `sse:events:admin` pub/sub channel
  (`apps/dispatcher/src/job/state.ts`) and acts on jobs whose `job_inputs.params.channel` is
  `whatsapp`. Pub/sub is lossy (an api restart drops events), so a **delivery sweeper** loop
  periodically looks for finished WhatsApp jobs whose result has not been delivered.

### Folder layout

```
apps/api/src/modules/messaging/
  routes.ts                 webhook routes (one per channel) + feature flag gate
  inbound-consumer.ts       stream consumer loop
  identity.ts               find/create user for (channel, external_id); login tokens
  engine/
    states.ts               state definitions and transitions (pure)
    messages.ts             abstract outbound message types
    copy.ts                 all English bot text
  channels/
    whatsapp/
      client.ts             Cloud API send / media download
      render.ts             abstract message ➜ Cloud API payload
      signature.ts          X-Hub-Signature-256 verification
  notifier.ts               job finished ➜ deliver result
  delivery-sweeper.ts       catch-up loop for missed deliveries
```

## 6. Channel-ready structure

The engine emits abstract messages; each channel adapter renders them:

| Abstract message | WhatsApp rendering |
|---|---|
| `text` | text message |
| `buttons` (≤3) | interactive reply buttons |
| `list` (≤10 rows) | interactive list message |
| `imageCards` (2–10) | interactive media carousel (fallback: contact-sheet image + list) |
| `image` (+ optional buttons) | image message |
| `document` | document message |

For comparison, Messenger and Instagram would render `imageCards` as their "generic template"
(image cards with buttons). Their user identity is a page-scoped ID (PSID / IGSID) instead of a
phone number, and both have a similar 24-hour messaging window. These adapters are **not** built
in v1.

## 7. Identity and accounts

### Why `users` does not change

- `users.email` is already nullable at the column level, and so is `password_hash`. Username-only
  accounts exist, and login already guards with `if (user.email && !user.emailVerified)`
  (`apps/api/src/modules/auth/routes.ts`). A WhatsApp-first user is a row with `email = NULL`.
- `users.phone` cannot be the identity: it is unverified free text with no format enforcement, so
  it may not even accept a `UNIQUE` index, and trusting it would let anyone claim an account by
  typing a number into a profile.
- The comment on `users.email` that says no new row should land without an email is updated to
  name messaging-created accounts as the exception.
- Code paths that assume an email exists (receipt email in `payments/routes.ts` already returns
  early when it is null; invoices in `issue-invoice.ts`; refund decision emails; low-credit
  alerts) are audited during implementation. Each one skips or uses a WhatsApp fallback.

### Identity options considered

| Option | Developers | Users |
|---|---|---|
| A. `phone_e164 UNIQUE` + `phone_verified_at` on `users` | Collides with the dirty `phone` column; needs data cleanup first; bloats `users` with channel state. | No visible difference. |
| **B. New table (chosen, generalised as `messaging_accounts`)** | Purely additive migration, same pattern as `oauth_accounts` and `google_drive_connections`; easy to remove. | No visible difference. The number is verified because WhatsApp delivers the message from it. |
| C. `oauth_accounts` row with `provider='whatsapp'` | No new identity table, but nowhere to store opt-in and 24-hour window state, so a second table is needed anyway. | No visible difference. |

### Flows

**First message from an unknown number** — the bot asks: `[New to Aivastra]` `[I have an account]`.

- **New:** create a `users` row (email NULL, `display_name` from the WhatsApp profile name), a
  `user_credits` row, the `FREE_TRIAL` grant (same `credit_plans` `free` lookup and campaign
  bonus logic as web — moved into one shared helper used by web, Google and messaging), and a
  `messaging_accounts` row. Then main menu.
- **I have an account:** the bot sends a one-time link. The seller opens it, logs in to the web
  app normally, and the page confirms "Connect WhatsApp +91… to this account?". On confirm, the
  `messaging_accounts` row is created against the existing user and the bot says "Connected".
  No second account is ever created in this path, so everything they generate appears in
  `/catalogs`.

**Claim (WhatsApp-first user wants the web app):** the bot sends a one-time login link. The web
app lets the logged-in user set an email (verified by the normal email flow) and a password on
the same `users` row. One row throughout.

**The leftover case** — a seller says "New" but actually already had a web account — results in
two separate accounts. In v1 this goes to support. Merging is technically feasible (result images
are stored by job ID, `outputs/{jobId}/…`, so moving jobs is a database update, not a file copy;
credits move as a debit/credit ledger pair; about 14 schema files reference `users.id` and each
needs a move/keep rule; the old row is marked inactive, never deleted) but it is deferred. See Q2.

### One-time login links

Used for "I have an account", "claim", and "buy credits".

- Random token, only its SHA-256 hash stored; single use; expires in about 10 minutes.
- Sent only to the verified WhatsApp number of that account.
- **Risk:** the link works like a password while it is valid. If the seller forwards it before
  using it, the recipient gets into the account. Short expiry and single use limit this but do not
  remove it.

## 8. Conversation state machine

The session is stored in Redis (`msg:session:{channel}:{external_id}`, TTL 24 hours, matching
Meta's window). It holds the current state and the choices made so far. Postgres is not used for
sessions; the durable record of what ran is the existing `jobs` / `job_inputs` / `job_events`.

```
                 ┌──────────── first message from unknown number ────────────┐
                 ▼                                                            │
          ONBOARD_ASK  [New to Aivastra] [I have an account]                  │
            │                         │                                       │
   create user (email NULL)    LINK_PENDING: send one-time link ──▶ web login │
   + FREE_TRIAL                  └─ web confirms ──▶ bot notified ────────────┤
   + messaging_accounts row                                                   ▼
            ▼                                                                 │
        MAIN_MENU  [New catalog] [Credits] [Help]  ◀──── known number ────────┘
            │            └─▶ CREDITS: balance + [Buy credits] ─▶ one-time link to /pricing
            ▼
  1 ASK_GENDER          reply buttons
  2 ASK_GARMENT_TYPE    list message (garment types for that gender; v1 = standard try-on types)
  3 ASK_PLATFORM        [Use default: <user's default platform / aspect ratio>] [Change] ─▶ list
  4 ASK_GARMENT_PHOTO   wait for an image (reject video/document; type and size check)
                        ─▶ download from Meta ─▶ MinIO ─▶ ownership recorded
  5 PICK_FACE           image cards (+ "More" button when more than one page)
  6 PICK_BACKGROUND     image cards
  7 PICK_POSE           image cards, filtered by garment type and gender
  8 PICK_LOWER?         only if the pose's template has lowerNodeId; image cards + [Skip]
  9 PICK_SHOES?         only if the pose's template has shoeNodeId; image cards + [Skip]
 10 CONFIRM             summary + "Uses N credits, balance M"  [Generate] [Start over]
        │  insufficient credits ─▶ NO_CREDITS: [Buy credits] ─▶ (credits granted) ─▶ CONFIRM
        ▼
 11 GENERATING          createJob(); "Working on it, about X min". Other messages: "Still generating."
        ▼  (notifier or sweeper sees the job finish)
 12 DELIVERED           result image  [New pose, same garment] [New catalog] [Menu]
    FAILED              "Generation failed, credits refunded" (the dispatcher already refunds)
                        [Retry] [Menu]
```

Rules that apply in every state:

- **`menu`, `restart`, `help`** typed at any time always work.
- **A photo sent from the main menu** starts a new catalog with the photo already filled in;
  steps 1–3 are asked, step 4 is skipped. This is how most sellers will naturally start.
- **"New pose, same garment"** returns to step 7 and keeps the uploaded garment, so several shots
  of one SKU need no batch feature.
- **Session expiry or api restart mid-wizard:** "Your last session expired, let's start again",
  back to the main menu. A job already generating is unaffected, because delivery is driven by
  the job, not the session.
- **Stale buttons:** every button and card payload carries the step and a per-session nonce.
  Tapping an option from an older message replies "That option is from an earlier step" and does
  not change state.
- **Unexpected input** (text where a tap is expected, an image at the wrong step) gets a short
  re-prompt for the current step.
- **Credits granted while waiting:** when a purchase completes for a user who has a messaging
  account, a small post-grant hook tells the bot, which sends "N credits added" and returns them
  to CONFIRM.

## 9. Presenting assets for selection

WhatsApp's interactive options (from third-party documentation; Meta's official reference could
not be retrieved during design, so these limits must be verified before implementation):

- **Reply buttons:** up to 3, text only. Used for small choices (gender, confirm).
- **List message:** up to 10 text rows, no images. Used for garment type and platform.
- **Interactive media carousel:** 2–10 horizontally swipeable cards, each with an image, up to
  160 characters of text, and buttons. Sendable without a template, but only inside the 24-hour
  window (always true while the seller is actively chatting). All cards must have the same button
  layout.
- **WhatsApp Flows:** native multi-screen forms; image-based option picking could not be
  confirmed.

| Option | Developers | Users |
|---|---|---|
| **A. Media carousel (chosen)** | Paging for more than 10 items; images must be at a URL Meta can fetch (MinIO public URL or a presigned GET). | Swipe and tap, stays inside WhatsApp. Best experience. |
| **B. Numbered contact sheet (fallback)** | Server stitches thumbnails into one numbered grid with `sharp`, cached per asset set, rebuilt when admins change assets. | Works on every client, but small thumbnails and picking by number. |
| C. WhatsApp Flows | Most work (Flow JSON, encrypted data endpoint, Meta review); image picking unconfirmed. | Polished but slower to open. |
| D. Link to a web picker page | Reuses studio pickers. | Leaves WhatsApp, which defeats the purpose. |

Paging: a carousel shows up to 10 cards; a separate reply-button message "More" follows it when
there are more. The lists are naturally small: poses are filtered by garment type and gender, and
lower/shoe steps only appear when the pose's template supports them.

## 10. Credits and payments

- One shared balance: `user_credits` / `credit_ledger`, deducted by the existing atomic
  `createJob` path. The bot shows the cost and balance at CONFIRM before deducting.
- **v1 purchase path:** the bot sends a one-time login link to `/pricing`; the seller buys with
  the existing web checkout. This touches **no** payment code (existing Razorpay order, `/verify`,
  webhook and invoice handling are reused unchanged). Receipts go by email only if the account
  has one.
- **Later: in-chat Razorpay payment link.** Gaps found in the current code
  (`apps/api/src/modules/payments/routes.ts`) that this would need to close:
  1. The webhook handles only `payment.captured` and looks the payment up by `order_id`. A
     payment link creates its own order, so we cannot store the order ID up front, and the
     existing branch would log "order not found". Fix: put `payments.id` in the link's
     `reference_id`, add a nullable `payments.razorpay_payment_link_id`, handle the
     `payment_link.paid` event through the same idempotent `UPDATE … WHERE status='created'` +
     `grantPurchaseCredits` path, and make the `payment.captured` branch skip payment-link payments
     quietly. (The exact `payment_link.paid` payload shape must be confirmed against Razorpay's
     docs.)
  2. Receipts/invoices are email-only. For WhatsApp-only users, send the invoice PDF as a
     WhatsApp document instead.
  3. Unpaid links expire after about 30 minutes; a new request issues a fresh link and expires
     the old `payments` row.

| | Developers | Users |
|---|---|---|
| **Web purchase via login link (v1)** | No payment changes; only the login-link mechanism, which is needed anyway. | Tap link, logged in to `/pricing`, buy, return to chat. One extra step; no receipt without an email. |
| In-chat payment link (later) | New column, new webhook event, `payment.captured` skip, WhatsApp receipts. | Tap link, pay, back in chat, bot resumes automatically. |

Both options open a browser for the actual payment, so the difference in friction is smaller than
it first looks.

## 11. Result delivery and the 24-hour window

- When the dispatcher marks a WhatsApp job `COMPLETED`, the notifier sends the result image
  (from MinIO via a URL Meta can fetch, or uploaded to Meta's media endpoint) with the follow-up
  buttons, then sets `jobs.channel_delivered_at`.
- The delivery sweeper (interval about 1 minute) finds finished WhatsApp jobs with
  `channel_delivered_at IS NULL` and delivers them, so a lost pub/sub event only delays delivery.
- **If the 24-hour window has closed** (`messaging_accounts.last_inbound_at` older than 24 hours),
  free-form messages are not allowed. The bot sends the approved utility template "Your catalog
  image is ready" with a button; the seller's tap reopens the window and the image is sent then.
  These template messages are charged by Meta.
- **Failed jobs:** the dispatcher already refunds on terminal failure; the bot reports "failed,
  credits refunded" with Retry.

## 12. Data model (all additive)

```
messaging_accounts                         -- one row per (channel, sender)
  id               uuid pk
  channel          text  ('whatsapp'; later 'messenger' | 'instagram')
  external_id      text  (E.164 phone for WhatsApp; PSID / IGSID later)
  user_id          uuid → users.id (ON DELETE CASCADE)
  opted_in_at      timestamptz
  opted_out_at     timestamptz NULL  -- set when the user blocks the bot / sends STOP
  last_inbound_at  timestamptz       -- 24-hour window check before any free-form send
  linked_via       text  ('created' | 'login_link')
  created_at / updated_at
  UNIQUE (channel, external_id)

messaging_login_tokens                     -- one-time web login links
  id, user_id, messaging_account_id,
  token_hash (sha256), purpose ('link_account' | 'login'),
  expires_at (~10 min), used_at NULL, created_at

jobs.channel_delivered_at   timestamptz NULL   -- set once the result is sent to the chat
job_inputs.params.channel = 'whatsapp'         -- JSONB, no migration
```

Redis keys (no migration):
- `msg:session:{channel}:{external_id}` — conversation session, TTL 24 h.
- `msg:seen:{channel}:{message_id}` — inbound dedupe, `SET NX`, TTL a few days.
- Stream `messaging:inbound` — durable inbound events.

The new `FREE_TRIAL` ledger write uses the existing reason and the existing conflict handling, so
a claimed account cannot receive the trial twice. Two genuinely separate accounts (one WhatsApp,
one web) would each receive one.

## 13. Failure handling

| Failure | Behaviour |
|---|---|
| Bad webhook signature | Return 200 (so Meta does not retry), log, drop. Same pattern as the Razorpay webhook. |
| Duplicate webhook delivery | Message-ID dedupe; processed once. |
| Garment photo download from Meta fails | Retry twice, then "Couldn't receive that photo, please send it again"; state stays at ASK_GARMENT_PHOTO. |
| Unsupported upload (video, document, too large) | Explain what is accepted; stay at ASK_GARMENT_PHOTO. |
| `createJob` rejects (insufficient credits, inactive asset) | NO_CREDITS, or re-ask that step with "That option is no longer available". |
| Send to Meta fails (5xx, rate limit) | Retry with backoff. Undelivered results are picked up by the sweeper because `channel_delivered_at` stays NULL. |
| Result ready after the 24-hour window closed | Approved utility template with a button; image sent after the tap. |
| Job fails terminally | Dispatcher refunds; bot reports it with Retry. |
| User blocks the bot / number invalid | Set `opted_out_at`, stop sending. |
| Redis session lost | "Session expired, let's start again." Jobs already queued are unaffected. |
| Feature flag off | Webhook returns 200 and does nothing. |

## 14. Security and privacy

- Webhook requests verified with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app
  secret), constant-time compare. Webhook verification handshake uses `WHATSAPP_VERIFY_TOKEN`.
- Access token, app secret and verify token are secrets: never logged (the pino redaction list is
  extended to cover them), reported only as set/unset and length.
- One-time login links: hashed at rest, single use, ~10-minute expiry, sent only to the verified
  number (risk noted in section 7).
- Rate limiting per sender on the inbound consumer to stop a single number from flooding job
  creation or Meta sends.
- Garment photos from WhatsApp follow the same retention and sweep rules as web uploads.
- Phone numbers are personal data: they are stored only in `messaging_accounts`, and an account
  erasure must delete that row. Consent wording at the first message (and STOP handling) needs a
  decision — see Q8.

## 15. Testing and rollout

**Unit tests (Vitest, no network)**
- The engine as a pure function: every transition, global commands, stale-button rejection, the
  "photo from main menu" shortcut, conditional lower/shoe steps.
- WhatsApp rendering of each abstract message type, checked against fixture payloads.
- Webhook signature verification.

**Integration tests** (existing harness: fresh Postgres database and MinIO bucket per file)
- Webhook route ➜ inbound consumer ➜ `createJob`, with the Meta client stubbed at the HTTP boundary.
- New account gets `FREE_TRIAL` exactly once.
- Login token is single-use and expires.
- Notifier and sweeper set `channel_delivered_at` exactly once.
- Insufficient credits leads to NO_CREDITS without a job being created.

**Manual end-to-end on staging** using Meta's test number and a team phone registered as a test
recipient. Carousel rendering on a real device cannot be faked in tests.

**Rollout**
- Feature flag `MESSAGING_WHATSAPP_ENABLED`, accepting only the literal `'true'` (the repo's rule
  against `z.coerce.boolean()`), compared with `=== true` in code.
- Migrations are additive and ship through push ➜ CI/CD ➜ `db:migrate:prod`, never by hand.
- Staging uses the Meta test number; production uses the verified number.

## 16. Configuration

New env vars (api), separate values for staging and production:

| Var | Purpose |
|---|---|
| `MESSAGING_WHATSAPP_ENABLED` | Feature flag, literal `'true'` only |
| `WHATSAPP_PHONE_NUMBER_ID` | Sending number |
| `WHATSAPP_WABA_ID` | WhatsApp Business Account |
| `WHATSAPP_ACCESS_TOKEN` | System-user permanent token (secret) |
| `WHATSAPP_APP_SECRET` | Webhook signature verification (secret) |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification handshake (secret) |

Added to `.env.production.example`, the staging env check, and `apps/api/src/env.ts`.

## 17. Future work (explicitly deferred)

- Saree / saree-mannequin / fabric-to-garment flows in the bot.
- Batch: several garments in one run (maps onto the existing `/jobs/batch`).
- In-chat Razorpay payment links (section 10).
- Account merge for the "said New but already had an account" case.
- Accessories, regeneration and refund requests from the chat.
- Hindi and regional languages.
- Messenger and Instagram adapters.
- Moving the module into its own service if volume requires it.

## 18. Open questions

### For management (business / product)

- **Q1. Garment flows in v1.** Standard try-on only (recommended), or also saree (a natural
  WhatsApp audience, but a second wizard branch), or all flows?
- **Q2. Duplicate accounts.** Is "support resolves it" acceptable for v1 when a seller says "New"
  but already had a web account, or is self-serve merge required at launch?
- **Q3. Who owns the Meta onboarding** (Business Portfolio, verification documents, choosing and
  provisioning the production phone number)? Which legal entity and documents will be used?
- **Q4. Production phone number.** A new dedicated number, or migrating an existing business
  number off the WhatsApp Business app (it then can no longer be used in the app)?
- **Q5. Budget for Meta template messages.** Results delivered after the 24-hour window, and any
  proactive messages (low-credit reminders, re-engagement), are charged per message. Is there a
  monthly cap, and should the bot send any proactive/marketing messages at all in v1?
- **Q6. Credit price on WhatsApp.** Same credit cost per generation as web, or different?
- **Q7. Free trial abuse tolerance.** Same `FREE_TRIAL` as web was decided. Is an extra guard
  wanted (e.g. limit trials per device or per country code), given phone numbers can be bought?
- **Q8. Consent and opt-out wording.** What does the first message say about data use, terms and
  privacy policy, and is a "reply STOP" opt-out required by our policy/legal advice (e.g. India's
  DPDP Act)?
- **Q9. Support handoff.** Should "Help" in the bot open a ticket in the existing human support
  system (`apps/chatbot`), or just show a contact link?
- **Q10. Launch audience.** Open to everyone at launch, or a closed pilot (allow-list of numbers)
  first?
- **Q11. Success metric.** What does success look like after launch — number of WhatsApp sign-ups,
  generations per week, paid conversions, share of existing users who link?

### Technical (to verify before or during implementation)

- **T1.** Confirm the interactive media carousel limits (cards, text length, button rules, 24-hour
  requirement) against Meta's official Cloud API documentation, and test-send one from the
  developer test number.
- **T2.** Confirm Meta's current pricing model and whether utility templates sent inside an open
  service window are free.
- **T3.** Confirm Meta can fetch result and thumbnail images from our MinIO public URL
  (`app.aivastra.com/minio/…`) or presigned URLs, or whether we must upload media to Meta first.
- **T4.** Decide where the "Connect WhatsApp to this account?" confirmation page and the
  "add email/password" claim page live in `apps/catalogues-web` (new route under `(app)`).
- **T5.** Audit every code path that assumes `users.email` is set (payments, invoices, refund
  emails, low-credit alerts, admin user lists) and decide skip or WhatsApp fallback for each.
- **T6.** Choose the WhatsApp message-ID dedupe TTL and the per-sender rate limit values.
- **T7.** Confirm the `payment_link.paid` webhook payload shape before the in-chat payment work
  (deferred, but recorded so it is not rediscovered).
- **T8.** Decide whether the delivery sweeper runs in the api process (alongside the other loops)
  or whether delivery should move to the dispatcher, which already owns job completion.
