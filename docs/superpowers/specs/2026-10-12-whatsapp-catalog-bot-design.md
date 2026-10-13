# WhatsApp catalog bot — design

**Date:** 2026-10-12
**Status:** draft, revised 2026-10-13 after the first review round (decisions D13–D21 in
section 3). Not approved for implementation; no code written. Section 18 lists the questions that
still need an answer.
**Scope:** a WhatsApp bot that lets a seller generate catalog images (the same try-on generation
the web studio does) entirely from a WhatsApp chat. The design is "channel-ready" so Facebook
Messenger and Instagram DMs can be added later without a rewrite, but only WhatsApp is built in v1.

---

## 1. Summary for management

- A seller messages the Aivastra WhatsApp number, sends a garment photo, picks a model face, then
  either a **ready-made set of looks** (an admin-curated catalogue template) or **their own
  background and poses**, by tapping image cards inside WhatsApp. They confirm the credit cost and
  receive the generated catalog images back in the same chat.
- It runs on the **same generation pipeline, credits and accounts** as the web app. Images made
  on WhatsApp show up in the seller's `/catalogs` page on the web, and credits are one shared
  balance.
- **There is one account, and it is the web account.** The bot never creates an account. A seller
  signs up on the web app (where the free trial is granted, as today) and connects their WhatsApp
  number to it. Connecting can be started from the chat or from the web app.
- **Credits and payments stay on the web app.** The bot's main menu shows the balance and a link
  to `/pricing`. No payment code changes. Paying inside the chat (Razorpay payment link) is a
  later improvement.
- **We need a Meta Business account and business verification.** We have none today, so this is
  the critical path. Verification can take days. Development starts immediately on Meta's free
  test number; a new dedicated production number is being obtained for launch.
- Running cost: replies inside 24 hours of the seller's last message are free; messages we start
  after that window (e.g. "your image is ready" when generation took long and the window closed)
  are charged per message by Meta.

## 2. Goals and non-goals (v1)

**Goals**
- Guided, menu-driven catalog generation in WhatsApp, one garment per run, one or more images per
  run (a catalogue template's looks, or the seller's own background and poses).
- Shared account, credits and results with the web app.
- Connecting a web account to a WhatsApp number, started from either side.
- English only.
- A structure that lets Messenger and Instagram be added later as one adapter each.

**Non-goals for v1** (all deferred, not rejected)
- Batch (many garments in one run).
- Signing up from WhatsApp. Accounts are created on the web app only.
- Paying inside the chat.
- Saree, saree-mannequin and fabric-to-garment flows.
- Accessories, regeneration and refund requests (these stay web-only).
- Named saved pose presets (`user_pose_presets`). Only "use my last poses" is offered in the chat;
  naming and managing presets stays on the web.
- Opening a support ticket from the chat. "Help" shows a contact link.
- Proactive or marketing messages.
- Languages other than English.
- Messenger and Instagram adapters.
- Any AI/LLM free-text understanding. The bot is a deterministic menu.

## 3. Decisions made so far

| # | Question | Decision |
|---|---|---|
| D1 | Who is the bot for? | Sellers with a web account. **Revised 2026-10-13:** WhatsApp-only sign-up is dropped; the bot never creates an account (see D13). |
| D2 | Where does the WhatsApp identity live? | New table, not new columns on `users`. `users` gets no migration. |
| D3 | Duplicate accounts | **Revised 2026-10-13:** cannot arise, because the bot only ever attaches a number to an existing web account. No claim flow, no merge. |
| D4 | Conversation style | Guided menu (like the web studio wizard), not one-shot. |
| D5 | How assets are shown | WhatsApp interactive media carousel (image cards with a Select button), with a numbered contact-sheet image as fallback. |
| D6 | Payments | Credits are bought on the web app. The bot sends a plain link to `/pricing` (normal web login, not an auto-login link). In-chat Razorpay payment link deferred. |
| D7 | Garments and images per run | One garment per run. **Revised 2026-10-13:** a run produces one or more images — every look of a catalogue template, or one background with one or more poses (see D14). |
| D8 | Language | English only. Copy lives in one constants file. |
| D9 | Where the code runs | Module inside `apps/api` (approach A, section 5). |
| D10 | Meta integration | Directly on Meta's WhatsApp Cloud API, no BSP (section 4). |
| D11 | Other Meta channels | Channel-ready design: generic identity table and an abstract message layer; only the WhatsApp adapter built. |
| D12 | Free trial | **Revised 2026-10-13:** unchanged from web. It is granted at web sign-up as today; the bot grants nothing. |
| D13 | Account model | One common account for web and WhatsApp. Account creation, credits and payment all live on the web app; the bot's main menu links to them. |
| D14 | Look selection | Mirrors the web studio: `[Ready-made looks]` picks an admin-curated catalogue template (each look has its own pose and background), `[Create your own]` picks one background and one or more poses. "Use my last poses" is offered inside "Create your own". |
| D15 | Connecting a number | Both directions (section 7): the bot sends a connect link, and the web app has a "Connect WhatsApp" button. |
| D16 | Garment flows in v1 | Standard try-on only. Saree and fabric-to-garment are deferred. |
| D17 | Credit price | Same cost per image as the web app. |
| D18 | Help | A contact link in v1. Opening a support ticket from the chat is deferred. |
| D19 | Launch audience | No closed pilot. The feature flag is the only gate; testing happens on the test number before launch. |
| D20 | Phone numbers | Development and staging on Meta's test number. Launch on a new dedicated number (being obtained), not a migrated existing one. |
| D21 | Consent and opt-out | The bot carries consent wording and STOP handling. Draft wording is in section 14; it needs approval (Q8). |
| D22 | Back-view poses | Supported. When a chosen pose or template look is a back view, the bot asks for a second photo, of the garment's back. |
| D23 | Amazon white background | The bot does not apply it. It never sends `platform: 'Amazon'` to the create path, so a seller who picks Amazon gets the 1:1 aspect ratio with the background they chose. Removing the rule from the web studio and the api as well was raised on 2026-10-13 and is a separate change, not part of this spec (Q12). |
| D24 | Template looks | A ready-made run generates every look of the template. Unticking individual looks stays on the web; a seller who wants fewer images uses "Create your own". |
| D25 | Meta onboarding owner | Taken on by the reviewer who answered on 2026-10-13 (name to be filled in): starts the Business Portfolio and business verification. |
| D26 | Template message budget | No monthly cap and no proactive or marketing messages in v1. The only message the bot starts on its own is "Your catalog images are ready", once per run. |
| D27 | Connection status on the web | The studio shows whether a WhatsApp number is connected, with the connect / disconnect action. |
| D28 | Success metric | Main: catalog images generated from WhatsApp per week. Adoption: share of web users who connect a number. Both come from data the design already records (`job_inputs.params.channel`, `messaging_accounts`). |

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
    connect tokens;      session + event ➜         Cloud API JSON; send; media
    never creates users) new session + messages)   download; signature check)
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
  identity.ts               find user for (channel, external_id); connect tokens (both directions)
  connect.routes.ts         authed web endpoints: confirm a chat-started connect, start a
                            web-started one, list / disconnect connected numbers
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

### One account, created on the web

The bot never creates a `users` row. Every seller the bot talks to already has a web account, and
`messaging_accounts` only records "this WhatsApp number belongs to that user". Consequences:

- `users` gets no migration and no new kind of row. Every account still has whatever the web
  sign-up gave it (email or username, password or Google), so nothing that assumes an email
  exists needs auditing for this feature.
- The free trial is granted at web sign-up exactly as today. The bot grants nothing.
- Two accounts for one seller cannot arise from the bot, so there is no claim flow and no merge.
- `users.phone` is still not the identity: it is unverified free text with no format enforcement,
  and trusting it would let anyone attach to an account by typing a number into a profile.

### Identity options considered

| Option | Developers | Users |
|---|---|---|
| A. `phone_e164 UNIQUE` + `phone_verified_at` on `users` | Collides with the dirty `phone` column; needs data cleanup first; bloats `users` with channel state. | No visible difference. |
| **B. New table (chosen, generalised as `messaging_accounts`)** | Purely additive migration, same pattern as `oauth_accounts` and `google_drive_connections`; easy to remove. | No visible difference. The number is verified because WhatsApp delivers the message from it. |
| C. `oauth_accounts` row with `provider='whatsapp'` | No new identity table, but nowhere to store opt-in and 24-hour window state, so a second table is needed anyway. | No visible difference. |

### Connecting a number

Both directions are built (D15). They share one token table and end in the same
`messaging_accounts` row.

| | Developers | Users |
|---|---|---|
| Chat-started only | Token table and a confirm page; registration has to return to the confirm step. | Works for sellers who arrive in the chat first. Nothing in the web app tells existing users the bot exists. |
| Web-started only | Short code and a settings button. | Only discoverable from inside the web app; a seller who messages the number first is stuck. |
| **Both (chosen)** | Both pieces, one shared table. | Works from wherever the seller starts. |

**Chat-started** — a message arrives from a number with no `messaging_accounts` row:

1. The bot replies "Connect your Aivastra account to start" with a link to
   `/connect/whatsapp?t=<token>`. The token is bound to the phone number, not to any user.
2. The seller opens it and logs in normally. A seller with no account registers first (including
   the normal email verification) and is returned to the same page afterwards.
3. The page shows "Connect WhatsApp +91… to this account?" with the consent wording (Q8). On
   confirm, the `messaging_accounts` row is created and the bot sends "Connected" plus the main
   menu.

**Web-started** — Settings has a "Connect WhatsApp" button:

1. The web app asks the api for a short code bound to the logged-in user and opens WhatsApp
   (`wa.me/<our number>?text=CONNECT%20<code>`) with the message prefilled.
2. The seller taps send. The inbound consumer sees `CONNECT <code>` from a number, matches the
   code to the user, creates the `messaging_accounts` row and replies "Connected" plus the main
   menu.

Rules for both:

- Tokens and codes are random, stored only as a SHA-256 hash, single use, and expire in about
  10 minutes.
- One number connects to one account (`UNIQUE (channel, external_id)`). A number that is already
  connected must be disconnected before it can be attached to a different account.
- Settings lists connected numbers with a "Disconnect" action. `STOP` in the chat sets
  `opted_out_at` but leaves the connection in place.

### What a connect link is not

Neither the connect link nor the "Buy credits" link logs anyone in. Both lead to pages that
require the normal web login, so a forwarded link does not give access to an account.

- **Risk, chat-started:** if the seller forwards the connect link before using it, the recipient
  could attach *their own* account to the seller's number. The confirm page shows the number
  being connected, the token is single use and short-lived, and the seller can disconnect.
- **Risk, web-started:** someone persuaded to send another person's code attaches their number to
  that person's account, and would then spend that person's credits. Low harm, same mitigations.

## 8. Conversation state machine

The session is stored in Redis (`msg:session:{channel}:{external_id}`, TTL 24 hours, matching
Meta's window). It holds the current state and the choices made so far. Postgres is not used for
sessions; the durable record of what ran is the existing `jobs` / `job_inputs` / `job_events`.

```
   message from a number with no messaging_accounts row
                 ▼
          CONNECT_PROMPT   "Connect your Aivastra account" + link ─▶ web login/register ─▶ confirm
                 │          (or: inbound "CONNECT <code>" from a web-started connect)
                 ▼  connected
        MAIN_MENU  [New catalog] [Credits] [Help]  ◀──── known number
            │            │           └─▶ HELP: contact link
            │            └─▶ CREDITS: balance + link to /pricing (normal web login)
            ▼
  1 ASK_GENDER          reply buttons
  2 ASK_GARMENT_TYPE    list message (garment types for that gender; v1 = standard try-on types)
  3 ASK_PLATFORM        [Use default: <user's default platform / aspect ratio>] [Change] ─▶ list
  4 ASK_GARMENT_PHOTO   wait for an image (reject video/document; type and size check)
                        ─▶ download from Meta ─▶ MinIO ─▶ ownership recorded
  5 PICK_FACE           image cards (+ "More" button when more than one page)
  6 PICK_LOOK_MODE      [Ready-made looks] [Create your own]
                        (skipped, straight to 7b, when no catalogue template is available for
                         this gender and garment type)
        │
        ├─ 7a PICK_TEMPLATE     image cards: template thumbnail, label, "N looks".
        │                       All of the template's looks are generated; each look carries its
        │                       own pose and background, so there is no background or pose step.
        │
        └─ 7b PICK_BACKGROUND   image cards
              PICK_POSES        [Use my last poses] when a last-used set exists for this gender
                                and garment type; otherwise image cards, tap to add
                                ("Added, 2 selected"), then [Done]
        ▼
  8 ASK_BACK_PHOTO?     only if any selected pose or look is a back view: "Now send a photo of
                        the back of the garment". Same download ➜ MinIO ➜ ownership path as step 4.
    PICK_LOWER?         only if any selected pose supports a lower; image cards + [Skip]
  9 PICK_SHOES?         only if any selected pose supports shoes; image cards + [Skip]
 10 CONFIRM             summary + "N images, uses C credits, balance M"  [Generate] [Start over]
        │  insufficient credits ─▶ NO_CREDITS: link to /pricing ─▶ (credits granted) ─▶ CONFIRM
        ▼
 11 GENERATING          one create call ➜ one job per image. "Working on N images, about X min".
                        Other messages: "Still generating, k of N done."
        ▼  (notifier or sweeper sees each job finish)
 12 DELIVERED           each image is sent as it finishes; after the last one:
                        [More looks, same garment] [New catalog] [Menu]
    FAILED (per image)  "1 of N failed, credits for it refunded" (the dispatcher already refunds)
                        [Retry failed] [Menu]
```

How this maps onto the existing create path (`CreateTryOnJobInputs`, `packages/types/src/jobs.ts`):

- **Ready-made looks** sends `looks: [{ poseId, backgroundId }, …]` plus the template's
  `catalogueTemplateMappingId`. The schema caps `looks` at 12.
- **Create your own** sends `backgroundId` + `poseIds`.
- The two forms are mutually exclusive in the schema, which is why step 6 is a hard fork.
- The lower and shoe steps use the same rule as the web studio: shown when *any* selected pose
  supports that slot.
- A back-view pose needs `upperGarmentBackKey`; without it the create path rejects the whole
  request ("back-view upper garment required for this pose"). So the back photo is asked for
  before CONFIRM, never discovered as an error after it.
- The bot calls `createJob(app, userId, body)` directly — it takes no request object — wrapped in
  the same `withIdempotency` helper the route uses, keyed on the Meta message ID of the
  `[Generate]` tap, and then calls `updateLastUsedPosePreset` as the route does. A duplicate
  webhook delivery therefore cannot create a second run.
- `platform` is never sent as `'Amazon'`, so the api's white-background override does not run
  (D23).
- The cost shown at CONFIRM comes from the same plan resolution the web uses, never from a number
  computed in the bot.

Rules that apply in every state:

- **`menu`, `restart`, `help`** typed at any time always work.
- **A photo sent from the main menu** starts a new catalog with the photo already filled in;
  steps 1–3 are asked, step 4 is skipped. This is how most sellers will naturally start.
- **"More looks, same garment"** returns to step 6 and keeps the uploaded garment and face.
- **Session expiry or api restart mid-wizard:** "Your last session expired, let's start again",
  back to the main menu. Jobs already generating are unaffected, because delivery is driven by
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
lower/shoe steps only appear when a selected pose supports them.

Catalogue templates are shown the same way: one card per template, using the template's own
thumbnail (`catalogue_templates.thumbnail_key`) and label. A template with no thumbnail falls back
to the first look's pose image.

Picking several poses ("Create your own") is the one place a carousel fits awkwardly, because a
card tap selects one item. Each tap adds a pose and the bot answers "Added, N selected" with a
`[Done]` button. Whether that feels acceptable on a real device is checked in T1; "Use my last
poses" and the ready-made templates are the low-friction paths.

## 10. Credits and payments

- One shared balance: `user_credits` / `credit_ledger`, deducted by the existing atomic
  `createJob` path. The bot shows the image count, cost and balance at CONFIRM before deducting.
  The cost per image is the same as on the web (D17).
- **v1 purchase path:** the bot sends a plain link to `/pricing`; the seller logs in to the web
  app as usual and buys with the existing web checkout. This touches **no** payment code
  (existing Razorpay order, `/verify`, webhook and invoice handling are reused unchanged), and
  receipts and invoices go out exactly as they do for any web purchase.
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
  2. Unpaid links expire after about 30 minutes; a new request issues a fresh link and expires
     the old `payments` row.

| | Developers | Users |
|---|---|---|
| **Web purchase via plain link (v1)** | No payment changes and no auto-login mechanism. | Tap link, log in if the browser has no session, buy, return to chat. |
| In-chat payment link (later) | New column, new webhook event, `payment.captured` skip, WhatsApp receipts. | Tap link, pay, back in chat, bot resumes automatically. |

Both options open a browser for the actual payment, so the difference in friction is smaller than
it first looks.

## 11. Result delivery and the 24-hour window

- A run is several jobs, one per image. When the dispatcher marks a WhatsApp job `COMPLETED`, the
  notifier sends that result image (from MinIO via a URL Meta can fetch, or uploaded to Meta's
  media endpoint) and sets `jobs.channel_delivered_at`. Images arrive one by one as they finish.
- The follow-up buttons are sent once, after the last job of the run has finished or failed. The
  jobs of one run share a catalogue, which is how the notifier knows the run is complete.
- The delivery sweeper (interval about 1 minute) finds finished WhatsApp jobs with
  `channel_delivered_at IS NULL` and delivers them, so a lost pub/sub event only delays delivery.
- **If the 24-hour window has closed** (`messaging_accounts.last_inbound_at` older than 24 hours),
  free-form messages are not allowed. The bot sends the approved utility template "Your catalog
  images are ready" with a button — **one per run, not one per image** — and the seller's tap
  reopens the window so the images are sent then. These template messages are charged by Meta,
  and in v1 they are the only message the bot ever starts on its own (D26).
- **Failed jobs:** the dispatcher already refunds on terminal failure, per job. The bot reports
  "k of N failed, credits for them refunded" with Retry for the failed ones only.

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
  linked_via       text  ('chat_link' | 'web_code')
  created_at / updated_at
  UNIQUE (channel, external_id)

messaging_connect_tokens                   -- one-time connect tokens, both directions
  id               uuid pk
  channel          text
  origin           text  ('chat' | 'web')
  external_id      text NULL   -- set when origin='chat': the number asking to connect
  user_id          uuid NULL → users.id   -- set when origin='web': the logged-in user
  token_hash       text  (sha256 of the link token or the short code)
  expires_at       timestamptz (~10 min)
  used_at          timestamptz NULL
  created_at

jobs.channel_delivered_at   timestamptz NULL   -- set once the result is sent to the chat
job_inputs.params.channel = 'whatsapp'         -- JSONB, no migration
```

Redis keys (no migration):
- `msg:session:{channel}:{external_id}` — conversation session, TTL 24 h.
- `msg:seen:{channel}:{message_id}` — inbound dedupe, `SET NX`, TTL a few days.
- Stream `messaging:inbound` — durable inbound events.

Nothing here touches `users`, `user_credits` or `credit_ledger`: the bot creates no accounts and
grants no credits. A connect token never authenticates anyone; it only carries which number (or
which user) asked to connect.

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
| Job fails terminally | Dispatcher refunds that job; bot reports "k of N failed" with Retry for the failed ones. |
| Message from a number that is not connected | Connect prompt with a fresh link. Nothing else is processed, and a garment photo sent at this point is not downloaded. |
| Connect token expired or already used | Web page / bot says so and offers a fresh one. |
| `CONNECT <code>` from a number already connected to another account | Refused: "This number is connected to another account. Disconnect it in Settings first." |
| A template's look was deactivated after the seller picked it | The create call rejects; bot re-shows the templates with "That set changed, please pick again". |
| User blocks the bot / number invalid | Set `opted_out_at`, stop sending. |
| Redis session lost | "Session expired, let's start again." Jobs already queued are unaffected. |
| Feature flag off | Webhook returns 200 and does nothing. |

## 14. Security and privacy

- Webhook requests verified with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app
  secret), constant-time compare. Webhook verification handshake uses `WHATSAPP_VERIFY_TOKEN`.
- Access token, app secret and verify token are secrets: never logged (the pino redaction list is
  extended to cover them), reported only as set/unset and length.
- Connect tokens and codes: hashed at rest, single use, ~10-minute expiry. They never log anyone
  in; both the connect page and `/pricing` require the normal web login (risks in section 7).
- The web connect endpoints are authenticated like any other user route and rate limited, so
  codes cannot be generated or guessed in bulk.
- Rate limiting per sender on the inbound consumer to stop a single number from flooding job
  creation or Meta sends.
- Garment photos from WhatsApp follow the same retention and sweep rules as web uploads.
- Phone numbers are personal data: they are stored only in `messaging_accounts`, and an account
  erasure must delete that row. Consent is shown on the connect confirmation page and STOP is
  honoured in the chat (D21).

### Consent and opt-out wording (draft, not approved — Q8)

All of this text lives in `engine/copy.ts` and the connect page, so changing it later is a copy
edit, not a code change.

**Connect confirmation page** (above the Confirm button; the same text is shown before the
web-started flow opens WhatsApp):

> **Connect WhatsApp +91 XXXXX XXXXX to your Aivastra account?**
>
> By connecting, you agree that:
> - Aivastra will send messages to this WhatsApp number about the catalog images you create
>   here, such as questions while you set up a catalog and the finished images.
> - The photos you send in this chat are used to generate your catalog images and are stored in
>   your Aivastra account, the same way as photos you upload on the website.
> - Your WhatsApp number is stored so we can recognise you in the chat. We do not use it for
>   marketing.
> - Images created in the chat use credits from your Aivastra account.
>
> Your data is handled under our [Privacy Policy](/privacy) and [Terms](/terms). You can stop
> messages at any time by replying STOP in the chat, or disconnect this number in Settings.

**First bot message after connecting:**

> Connected. You can now create catalog images here. Reply STOP at any time to stop messages
> from Aivastra, or MENU to see your options.

**Reply to STOP:**

> You won't receive any more messages from Aivastra on WhatsApp. Your account and images are
> unchanged. Send START if you want to use the bot again.

Behaviour behind the wording:

- `STOP` sets `opted_out_at`. From then on the bot sends nothing to that number, including
  results of runs already generating; those remain available in `/catalogs` on the web.
- `START`, or any new message after a STOP, clears `opted_out_at`. The seller messaging us again
  is what makes replying acceptable.
- Disconnecting in Settings deletes the `messaging_accounts` row, and with it the stored number.
- `opted_in_at` records when the seller pressed Confirm (or sent the `CONNECT` code), so there is
  a timestamp for the consent.

## 15. Testing and rollout

**Unit tests (Vitest, no network)**
- The engine as a pure function: every transition, global commands, stale-button rejection, the
  "photo from main menu" shortcut, the ready-made / create-your-own fork, multi-pose selection,
  conditional lower/shoe steps.
- WhatsApp rendering of each abstract message type, checked against fixture payloads.
- Webhook signature verification.

**Integration tests** (existing harness: fresh Postgres database and MinIO bucket per file)
- Webhook route ➜ inbound consumer ➜ `createJob`, with the Meta client stubbed at the HTTP boundary.
- A message from an unconnected number creates no user, no job and no upload.
- Connect, both directions: token/code is single-use and expires; a number already connected to
  another account is refused.
- A template run and a create-your-own run each create one job per image and deduct the same
  credits the web would.
- Notifier and sweeper set `channel_delivered_at` exactly once per job, and send the follow-up
  buttons once per run.
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
- Signing up from WhatsApp (dropped for v1; it would bring back email-less accounts, a claim flow
  and the duplicate-account problem).
- Named saved pose presets in the chat.
- "Help" opening a support ticket in `apps/chatbot`.
- Proactive messages (low-credit reminders, re-engagement).
- Accessories, regeneration and refund requests from the chat.
- Hindi and regional languages.
- Messenger and Instagram adapters.
- Moving the module into its own service if volume requires it.

## 18. Open questions

Question numbers are kept from the first draft so earlier notes still line up.

### Answered on 2026-10-13 (now decisions in section 3)

| Q | Answer | Decision |
|---|---|---|
| Q1 Garment flows | Standard try-on only, with catalogue templates and create-your-own. | D14, D16 |
| Q2 Duplicate accounts | WhatsApp sign-up dropped; the seller connects a web account. The case cannot arise. | D1, D3, D13 |
| Q4 Production number | A new dedicated number, being obtained. | D20 |
| Q6 Credit price | Same as web. | D17 |
| Q7 Free-trial guard | Same trial as web. Moot for the bot, which grants nothing. | D12 |
| Q9 Help | Contact link in v1; ticket handoff is not a v1 priority. | D18 |
| Q10 Launch audience | No closed pilot. | D19 |
| Q3 Meta onboarding owner | Owner confirmed (name to be filled in). | D25 |
| Q5 Template budget | No monthly cap; no proactive messages. | D26 |
| Q11 Success metric | Generations from WhatsApp per week; connected share as the adoption number. | D28 |

### Still open — for management (business / product)

- **Q8. Consent and opt-out wording.** A draft is in section 14. Two things are open: approval of
  the text, and whether legal review is wanted (e.g. India's DPDP Act). The existing
  `/privacy` and `/terms` pages have not been checked for whether they already cover WhatsApp
  messaging and phone numbers; if they do not, they need a line added.
- **Q12. Removing the Amazon white-background rule from the web app.** Today the api swaps the
  background for the admin-tagged white one when the studio sends `platform: 'Amazon'`
  ("main listing" mode), and the studio asks which pose is the main image. Dropping it everywhere
  would remove that api override, the studio's main-image picker and the admin "white background"
  tag. Confirm that is wanted, and it gets its own change; the bot does not depend on it.

### Technical (to verify before or during implementation)

- **T1.** Confirm the interactive media carousel limits (cards, text length, button rules, 24-hour
  requirement) against Meta's official Cloud API documentation, and test-send one from the
  developer test number. Include the tap-to-add multi-pose selection (section 9) in that device
  test.
- **T2.** Confirm Meta's current pricing model and whether utility templates sent inside an open
  service window are free.
- **T3.** Confirm Meta can fetch result and thumbnail images from our MinIO public URL
  (`app.aivastra.com/minio/…`) or presigned URLs, or whether we must upload media to Meta first.
- **T4.** Decide where the connect confirmation page (`/connect/whatsapp`) and the Settings
  "Connect WhatsApp" section live in `apps/catalogues-web`, and make sure a seller who has to
  register (and verify their email) lands back on the confirmation page with the token intact.
- **T5.** Closed. The audit of code paths that assume `users.email` is set is no longer needed,
  because the bot creates no accounts.
- **T6.** Choose the WhatsApp message-ID dedupe TTL and the per-sender rate limit values.
- **T7.** Confirm the `payment_link.paid` webhook payload shape before the in-chat payment work
  (deferred, but recorded so it is not rediscovered).
- **T8.** Decide whether the delivery sweeper runs in the api process (alongside the other loops)
  or whether delivery should move to the dispatcher, which already owns job completion.
- **T9.** Closed. The bot asks for a back photo (D22).
- **T10.** Closed for the bot: it does not apply the Amazon white-background rule (D23). Removal
  from the web app is Q12.
- **T11.** Closed. A ready-made run generates the whole template (D24).
- **T12.** Closed. `createJob(app, userId, body)` takes no request object (section 8).
- **T13. Lower-only garment types.** For garment types with no upper garment (jeans and similar),
  the create path wants the seller's photo as a lower upload (`lowerGarmentKey`, or
  `lowerGarmentBackKey` for a back view), not as the upper garment. Read how the studio decides
  this (`lowerOnly` in `studio/page.tsx`) and mirror it in the bot, or leave lower-only types out
  of v1.
- **T14. Meta's charge is ours, not the seller's.** A template message is billed by Meta to
  Aivastra's WABA payment method. It is not taken from the seller's credits. With no cap (D26) the
  exposure is one message per run that finishes after the window closed; add a metric for it so
  the monthly figure is visible.
