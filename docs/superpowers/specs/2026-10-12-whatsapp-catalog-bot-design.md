# WhatsApp catalog bot — design

**Date:** 2026-10-12
**Status:** draft, revised 2026-10-13 after the first review round (decisions D13–D21 in
section 3), and again the same day when management cut the catalog flow to five steps with
automatic garment recognition (D40–D47). Not approved for implementation; no code written.
Section 18 lists the questions that still need an answer.
**Scope:** a WhatsApp bot that lets a seller generate catalog images (the same try-on generation
the web studio does) entirely from a WhatsApp chat. The design is "channel-ready" so Facebook
Messenger and Instagram DMs can be added later without a rewrite, but only WhatsApp is built in v1.

---

## 1. Summary for management

- A seller sends a garment photo to the Aivastra WhatsApp number. Our own vision model, on our
  GPUs, recognises the garment. The seller picks who the catalog is for (Women, Men, Boys, Girls),
  how many poses they want, and which poses, by tapping image cards inside WhatsApp. Generation
  starts on the last pick, and the images come back in the same chat. Five steps, no other
  questions: face, background, aspect ratio, lower and shoes are filled in from defaults
  (section 8).
- It runs on the **same generation pipeline, credits and accounts** as the web app. Images made
  on WhatsApp show up in the seller's `/catalogs` page on the web, and credits are one shared
  balance.
- **There is one account, and it is the web account.** The bot never creates an account. A seller
  signs up on the web app (where the free trial is granted as today, once the profile has an
  email and a mobile number) and connects their WhatsApp
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
- Guided catalog generation in WhatsApp in five steps (D40), one garment per run, one or more
  images per run, each image one look (pose and background) of a catalogue template.
- Automatic garment recognition on our own GPU, with the garment-type list as the fallback (D41).
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
- Choosing a face, background, aspect ratio, lower or shoes in the chat. The bot uses defaults
  (D43); changing them stays on the web studio.
- "Create your own" (own background and poses), back-view poses and pose presets in the chat
  (D42). The web studio keeps all of them.
- Opening a support ticket from the chat. "Help" shows a contact link.
- Proactive or marketing messages.
- Languages other than English.
- Messenger and Instagram adapters.
- Any AI/LLM free-text understanding. The bot is a deterministic menu. The one model in the path
  classifies the garment photo into an existing garment type (D41); it never reads the seller's
  text.

## 3. Decisions made so far

| # | Question | Decision |
|---|---|---|
| D1 | Who is the bot for? | Sellers with a web account. **Revised 2026-10-13:** WhatsApp-only sign-up is dropped; the bot never creates an account (see D13). |
| D2 | Where does the WhatsApp identity live? | New table, not new columns on `users`. `users` gets no migration. |
| D3 | Duplicate accounts | **Revised 2026-10-13:** cannot arise, because the bot only ever attaches a number to an existing web account. No claim flow, no merge. |
| D4 | Conversation style | Guided menu (like the web studio wizard), not one-shot. |
| D5 | How assets are shown | WhatsApp interactive media carousel (image cards with a Select button), with a numbered contact-sheet image as fallback. |
| D6 | Payments | Credits are bought on the web app. The bot sends a plain link to `/pricing` (normal web login, not an auto-login link). In-chat Razorpay payment link deferred. |
| D7 | Garments and images per run | One garment per run. **Revised 2026-10-13:** a run produces one or more images. **Revised again:** one image per catalogue-template look the seller picks (D44). |
| D8 | Language | English only. Copy lives in one constants file. |
| D9 | Where the code runs | Module inside `apps/api` (approach A, section 5). |
| D10 | Meta integration | Directly on Meta's WhatsApp Cloud API, no BSP (section 4). |
| D11 | Other Meta channels | Channel-ready design: generic identity table and an abstract message layer; only the WhatsApp adapter built. |
| D12 | Free trial | **Revised 2026-10-13:** unchanged from web. It is granted as today, when the web profile has both an email and a 10-digit mobile number (`PATCH /v1/me`); the bot grants nothing. |
| D13 | Account model | One common account for web and WhatsApp. Account creation, credits and payment all live on the web app; the bot's main menu links to them. |
| D14 | Look selection | **Superseded by D42 (2026-10-13).** Was: mirrors the web studio: `[Ready-made looks]` picks an admin-curated catalogue template (each look has its own pose and background), `[Create your own]` picks one background and one or more poses. "Use my last poses" is offered inside "Create your own". |
| D15 | Connecting a number | Both directions (section 7): the bot sends a connect link, and the web app has a "Connect WhatsApp" button. |
| D16 | Garment flows in v1 | Standard try-on only. Saree and fabric-to-garment are deferred. |
| D17 | Credit price | Same cost per image as the web app. |
| D18 | Help | A contact link in v1. Opening a support ticket from the chat is deferred. |
| D19 | Launch audience | No closed pilot. The feature flag is the only gate; testing happens on the test number before launch. |
| D20 | Phone numbers | Development and staging on Meta's test number. Launch on a new dedicated number (being obtained), not a migrated existing one. |
| D21 | Consent and opt-out | The bot carries consent wording and STOP handling. The wording in section 14 was approved on 2026-10-13. |
| D22 | Back-view poses | **Superseded by D42 (2026-10-13): the chat has no back-photo step.** Was: supported in "Create your own": when a chosen pose is a back view, the bot asks for a second photo, of the garment's back. Ready-made templates never ask, matching the studio (section 8). |
| D23 | Amazon white background | The bot does not apply it. It never sends `platform: 'Amazon'` to the create path, so a seller who picks Amazon gets the 1:1 aspect ratio with the background they chose. The rule is also being removed from the web app (D30). |
| D24 | Template looks | **Superseded by D44 (2026-10-13): the seller picks which looks.** Was: a ready-made run generates every look of the template. Unticking individual looks stays on the web; a seller who wants fewer images uses "Create your own". |
| D25 | Meta onboarding owner | Ram Kumar starts the Business Portfolio and business verification. |
| D26 | Template message budget | No monthly cap and no proactive or marketing messages in v1. The only message the bot starts on its own is "Your catalog images are ready", once per run. |
| D27 | Connection status on the web | The studio shows whether a WhatsApp number is connected, with the connect / disconnect action. |
| D29 | Profile mobile number vs WhatsApp number | Kept separate. The profile number is only a hint: the connect step is always required, and the page says whether the WhatsApp number matches the one on the account (section 7). A match never connects a number by itself. |
| D30 | Amazon white-background rule on the web | Removed, logic only: the api's background override for `platform: 'Amazon'` and the studio's "main listing" mode with its main-image picker. The admin "white background" tag and its column stay, so there is no migration. This is its own change, shipped separately from the bot. |
| D31 | Garment types | Every garment type the standard try-on flow serves, including lower-only types (jeans and similar) and types that need a second, third or optional fourth photo. The bot follows the studio's rules for which upload goes into which slot (section 8). Only types flagged `requiresMannequinStep` (the two-step saree flow) stay deferred (D16). **Narrowed by D46 and D47:** the optional fourth photo is not asked for, and a type needs a catalogue template to be offered. |
| D32 | Connect tokens storage | Redis `SET EX` + `GETDEL`, not a Postgres table: atomic single use and expiry, no sweeper, matches the WordPress connect flow. The durable record is the `messaging_accounts` row. Chat tokens live 30 minutes so a seller can register and verify their email first. |
| D28 | Success metric | Main: catalog images generated from WhatsApp per week. Adoption: share of web users who connect a number. Both come from data the design already records (`messaging_runs`, `messaging_accounts`). |
| D40 | Catalog flow (management, 2026-10-13) | Five steps: (1) garment photo, (2) the garment is recognised automatically, (3) "Create catalogue for" Women / Men / Boys / Girls, (4) how many poses, (5) pick the poses; generation starts on the last pick. Gender is asked first and recognition runs after it: garment types are defined per gender (`garment_subcategories.gender_slug` is NOT NULL), so the model chooses only among that gender's types, a much shorter list (section 8a). |
| D41 | Garment recognition | Our own Qwen2.5-VL on our GPU workers, as a classify-only ComfyUI workflow run by the dispatcher (section 8a). The result is shown as "Detected: <type>" with a way to change it. If it is slow, fails, or names no type we have, the bot shows the garment-type list instead. If it causes problems or delay in production (thresholds in section 8a), it moves to a hosted vision API behind the same interface. |
| D42 | What leaves the chat | "Create your own" (own background and poses), back-view poses and "use my last poses". Every image is a catalogue-template look. Replaces D14 and D22 in the chat; the web studio keeps everything. |
| D43 | Defaults instead of questions | Face: the first active face for the gender and garment type in admin sort order (respecting the face's garment-type scoping). Background: carried by each look. Aspect ratio and resolution: fixed at 3:4 and 2K for every bot run (revised 2026-10-14; was the seller's web defaults), falling back to the cheapest enabled tier if an admin disables 2K. Lower and shoes: the garment type's `default_lower_catalog_id` / `default_shoe_catalog_id`, sent only when a chosen look has that slot. The create path rejects a look whose lower or shoe slot is left empty (`apps/api/src/modules/jobs/create.ts`, "lower garment required for this pose" / "shoe catalog item required for this pose"), so when the type has no default, the looks needing it are not shown. Templates: every active template mapped to the garment type (revised 2026-10-14, D44). |
| D44 | Choosing poses | **Revised 2026-10-14** (`2026-10-14-whatsapp-pose-selection-design.md`; supersedes steps 4–5 of D40). There is no "how many poses" step. The seller sees the poses of **every** active template for the garment type (a pose + background pair in two templates shown once) as carousel pages of 10, taps any number up to 20, and taps again to remove one. Every tap answers "N selected · X credits" with [Generate] [Clear]. Because a catalogue belongs to one template mapping, a pick spanning templates is created as one run per template through the existing create path (no api change): all groups are quoted before the first charge, and each call has its own idempotency key. Replaces D24. |
| D45 | Confirmation | **Revised 2026-10-14.** No separate Confirm step. The cost per pose and the balance are shown with the cards, and the running cost with every selection; tapping [Generate] is the seller's agreement to spend. Too few credits is caught at [Generate] and again by the create path. |
| D46 | Extra uploads | A garment type that **requires** another photo (`requiresLowerUpload`, `requiresThirdUpload`) still gets its prompt, right after the type is known; it cannot be defaulted. The optional fourth photo is not asked for. |
| D47 | Garment types with no template | A garment type with no active catalogue template for that gender is not available in the chat; the bot says so and points to the web studio. |
| D33 | Engine purity | Deterministic, not pure: `handle(session, event, ctx, deps)` awaits an injected `EngineDeps` for option lists and side effects but does no I/O of its own and takes randomness from `deps`. Tested with in-memory fakes. |
| D34 | Run tracking | A `messaging_runs` table (one row per create call, keyed by `catalogue_id`, with the account and job ids), not `job_inputs.params.channel`: the create request strips unknown params keys, and params feed the workflow. |
| D48 | Waiting for recognition | Inside the conversation, polling the result key for at most 8 s after the gender tap, behind `GARMENT_RECOGNITION_ENABLED` (literal `'true'`; off = always the list). The request/result contract is `packages/types/src/garment-recognition.ts`. |
| D49 | Looks needing a question | Not offered: a shoe look without a default shoe, a combined look without a default lower or lower photo, a lower-only look in a mixed template unless the type takes a lower photo. |
| D37 | Delivery by polling, not pub/sub | One polling loop over unfinished `messaging_runs` (indexed, a handful of rows) replaces the notifier on the dispatcher's `sse:events:admin` channel plus the sweeper. Cost: up to one poll interval (5 s) of extra latency on a multi-minute generation. |
| D38 | Result images are uploaded to Meta, not linked | Uploading needs no public URL and no answer to whether Meta can fetch our presigned URLs (T3: it can, but delivery does not depend on it). |
| D39 | The 24-hour window margin is 10 minutes | A free-form send is attempted only if the seller's last message is less than 23 h 50 min old, so a send in flight never crosses the 24-hour line. |
| D50 | Senders are processed concurrently, each in order | The consumer chains each sender's messages on an in-process promise (one sender stays in order) and runs different senders in parallel, up to 20 in flight; the per-sender Redis lock still serialises one sender across api replicas. A gender tap's 8 s recognition wait (D48) never blocks other sellers. |

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
  dispatcher ── job COMPLETED ──▶ delivery loop (5 s, api process) over `messaging_runs`
                                 ──▶ send result to the chat
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
- **Delivery loop** (D37) polls unfinished `messaging_runs` every 5 s from the api
  process and sends whatever finished: each result image (uploaded to Meta's media
  endpoint, D38) as it completes, then the follow-up buttons once every job of the run
  is accounted for in `delivered_job_ids`. One polling path replaces the earlier
  notifier + sweeper design — no pub/sub subscription to manage, and a lost event only
  delays delivery by one interval. The loop finds a finished job's chat through
  `messaging_runs`, never through `job_inputs.params`.
- **Garment classifier** (D41, section 8a). The api never talks to a GPU worker, so recognition
  goes through the dispatcher like every other GPU call: the api adds a request to a Redis stream,
  the dispatcher runs a classify-only workflow on a worker and writes the answer to a Redis key the
  bot reads. It creates no `jobs` row and costs no credits.

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
  classify.ts               garment recognition: request, read result, match to a garment type
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
- The free trial is granted exactly as today: `PATCH /v1/me` writes the `FREE_TRIAL` ledger row
  once the profile has both an email and a 10-digit mobile number. The bot grants nothing.
- Two accounts for one seller cannot arise from the bot, so there is no claim flow and no merge.
- `users.phone` is still not the identity. `PATCH /v1/me` does check that it is 10 digits and
  not already on another account, but the column itself has no constraint, the number carries no
  country code, and — the part that matters — **nobody has ever proved they own it**: there is
  no OTP. Trusting it would let anyone attach to an account by typing a number into a profile.

### The profile mobile number and the WhatsApp number

A seller gives a mobile number on the web to receive the free trial, and later messages the bot
from a WhatsApp number. They are usually the same number, but nothing makes them so.

| | Profile mobile (`users.phone`) | WhatsApp number (`messaging_accounts.external_id`) |
|---|---|---|
| Source | Typed by the seller | The number WhatsApp delivered the message from |
| Verified | No | Yes, by WhatsApp |
| Format | 10 digits, no country code | E.164 |

| Option | Developers | Users |
|---|---|---|
| A. Fully independent | Nothing extra. | Always does the connect step; no reassurance that it is the expected number. |
| B. Auto-connect when the numbers match | A lookup; no connect page for matches. | No connect step for most sellers. But the profile number is unverified, so a typo or a deliberately wrong number lets a stranger's WhatsApp spend that account's credits. |
| **C. Connect step always; profile number as a hint (chosen, D29)** | Compare and show the result on the confirm page. | Connect step stays; the seller is told whether the number matches their account. |

How the hint works:

- The comparison is the WhatsApp number's last 10 digits against `users.phone`. This assumes
  Indian numbers, which is all the profile field can hold today.
- **Chat-started:** the confirm page says "This is the mobile number on your account", or
  "This is different from the mobile number on your account (ending 1234)". Either way the
  seller can confirm.
- **Web-started:** the comparison can only happen when the `CONNECT` code arrives, so a
  difference is mentioned in the bot's "Connected" message rather than blocking it.
- A mismatch never blocks a connect and never rewrites `users.phone`. Overwriting it would run
  into the one-number-per-account check and would change what the free-trial rule looked at.
- Not built in v1, but recorded: a connected WhatsApp number is the first *verified* number we
  hold for a seller, so it is the natural input if the free-trial rule is ever tightened.

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
3. The page shows "Connect WhatsApp +91… to this account?" with the consent wording (section 14) and
   whether the number matches the mobile number on the account (D29). On
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

Management's flow (D40) is five steps. Steps 2 and 3 are swapped in the chat: the gender comes
first and recognition runs after it, because garment types only exist per gender and the model
picks more reliably from that gender's short list.

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
  1 ASK_GARMENT_PHOTO   wait for an image (reject video/document; type and size check)
                        ─▶ download from Meta ─▶ MinIO ─▶ ownership recorded
  2 ASK_GENDER          list message "Create catalogue for": Women / Men / Boys / Girls
                        (a list, because reply buttons stop at 3)
                        ─▶ garment recognition requested with that gender's types (section 8a)
  3 (garment type)      no question when recognition answers within the budget with one of
                        that gender's public slugs: "Detected: Kurti" opens step 4.
                        Otherwise ASK_GARMENT_TYPE: the list of that gender's types.
                        ─▶ no active template for the type: "not available on WhatsApp yet,
                           use the web studio" + link (D47), back to the menu
    ASK_EXTRA_PHOTOS?   only for types that require one: the lower photo, the third photo (D46)
   4 PICK_LOOKS            prompt with the cost per pose and the balance ([Change garment]),
                         then carousel pages of every active template's poses (10 per page, [More]);
                         a tap selects a pose, a second tap removes it; every tap answers
                         "N selected · X credits" [Generate] [Clear] (max 20 poses)
                         ─▶ "Change garment" returns to ASK_GARMENT_TYPE
                         ─▶ [Generate] with a total the balance cannot cover: NO_CREDITS
                            (the selection is kept)
        │  insufficient credits at create time ─▶ NO_CREDITS: link to /pricing
        ▼
    GENERATING          one create call per template ➜ one job per image. "Working on N images, C credits,
                        about X min". Other messages: "Still generating, k of N done."
        ▼  (notifier or sweeper sees each job finish)
    DELIVERED           each image is sent as it finishes; after the last one:
                        [More poses, same garment] [New catalog] [Menu]
    FAILED (per image)  "1 of N failed, credits for it refunded" (the dispatcher already refunds)
                        [Retry failed] [Menu]
```

What fills the steps the chat no longer asks (D43):

| Input | Where it comes from |
|---|---|
| Face | First active face for the gender and garment type, in admin sort order, using the same garment-type scoping as `GET /v1/models/faces` (`model_face_subcategories`). Admins choose the bot's face by ordering. |
| Background | Each look carries its own. |
| Template | The top-sorted active template mapped to the garment type (`catalogue_template_subcategories`), with its `catalogueTemplateMappingId`. |
| Aspect ratio | Always 3:4 (revised 2026-10-14; was `users.default_aspect_ratio`). |
| Resolution | Always 2K; if an admin disables 2K, the cheapest enabled tier, so runs never fail on a disabled tier. |
| Lower | The type's `default_lower_catalog_id`, sent only when a picked look has a lower slot. Not used for lower-only types or `requiresLowerUpload` types, whose lower is the seller's photo, as in the studio. |
| Shoes | The type's `default_shoe_catalog_id`, the same way. |

The create path rejects a look whose lower or shoe slot is empty. So when the type has no default
for a slot, the looks with that slot are left out of steps 4 and 5; if that leaves none, the type
is treated as having no template (D47).

How this maps onto the existing create path (`CreateTryOnJobInputs`, `packages/types/src/jobs.ts`):

- Every run sends `looks: [{ poseId, backgroundId }, …]` for the picked looks plus the template's
  `catalogueTemplateMappingId`. The api already accepts any subset of the mapping's looks (the
  `allowedLookKeys` check in `apps/api/src/modules/jobs/create.ts`), so picking 4 of 8 needs no api
  change. The schema caps `looks` at 12; the chat caps the count at 9.
- `backgroundId` + `poseIds` (the "create your own" form) is never sent from the chat (D42).
- **No back photo.** The studio's template mode never collects one, and
  `/v1/models/catalogue-templates` does not return a look's garment view
  (`docs/superpowers/plans/2026-09-29-studio-back-pose-garment-view.md` records this as a
  deliberate exclusion). If an admin ever maps a back-view workflow into a template, the create
  path rejects the whole run, for web and bot alike, before any credits are taken.
- **Lower-only garment types** (D31). When every picked look has a lower slot and no upper slot,
  the seller's photo is the lower garment. The studio's rule (`lowerOnly` in `studio/page.tsx`) is
  mirrored: the same key is sent as both `upperGarmentKey` (the schema requires it; the api drops
  it for these poses) and `lowerGarmentKey`, and no default lower is sent.
- **Extra uploads** are declared by the garment type (`garment_subcategories`), so the bot asks for
  them as soon as the type is known, using the admin-set label in the prompt ("Now send a photo of
  the <thirdUploadLabel>"):
  - `requiresLowerUpload`: a required lower photo, instead of the default lower.
  - `requiresThirdUpload`: a required third photo (`thirdGarmentKey`).
  - `allowsFourthUpload`: not asked (D46). The dispatcher already prunes that part of the workflow
    when it is empty.
- These slot rules are derived from pose and garment-type flags the api already returns. They are
  implemented once in the engine and unit-tested against the same cases the studio handles, so
  the two cannot drift silently.
- The bot calls `createJob(app, userId, body)` directly — it takes no request object — wrapped in
  the same `withIdempotency` helper the route uses, keyed on the Meta message ID of the tap that
  completed the pick. A duplicate webhook delivery therefore cannot create a second run.
- `platform` is never sent as `'Amazon'` (D23).
- **Cost.** The count list shows the per-image cost from the same plan resolution the web uses
  (`resolveTryonPlan` over the template's looks). The run is charged at a fresh quote for the
  exact looks picked, never a number computed in the bot (D17); if that is more than the balance,
  the seller gets NO_CREDITS instead of a run (D45).

Rules that apply in every state:

- **`menu`, `restart`, `help`** typed at any time always work.
- **A photo sent at any step outside the wizard** (the menu, after delivery) starts a new catalog
  with that photo; step 1 is skipped. This is how most sellers will start.
- **"More poses, same garment"** returns to step 4 with the photo, gender and garment type kept.
- **Tapping a selected pose again** removes it from the selection.
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
  to step 4.

### 8a. Garment recognition (D41)

**What runs where.** The only vision model we have is Qwen2.5-VL-7B-Instruct, today used *inside*
the `allinonetryonv5_1_` try-on workflow on GPU3 (`docs/progress.md`, 2026-08-29, Finding 8). It
cannot be called before a job exists, so recognition gets its own small path. The api never talks
to a GPU worker (CLAUDE.md), so the dispatcher runs it:

```
gender tap ─▶ XADD classify:requests {requestId, garmentKey, options: [{slug, label}]}
                         │
          dispatcher classify consumer (own lane, like the video consumer)
                         │ selects an IDLE worker allowed the 'classify' pool
                         │ clones + patches the classify workflow (image, prompt with options)
                         │ POST /prompt, poll /history, read the text output
                         ▼
          SET classify:result:{requestId} {slug | null, ms}  EX 1h
                         │
bot ─▶ waits for the key, up to the time budget ─▶ slug ─▶ garment-type row
```

- **The options come from the dev API's cached list.** `getCatalogOptions(app, { gender,
  publicOnly: true })` (`apps/api/src/lib/catalog-options-cache.ts`) already returns that gender's
  active garment types with `id`, public `slug` (`public_api_slug`), `label` and the extra-upload
  flags, from Redis, invalidated whenever an admin edits an asset. The bot sends `[{slug, label}]`
  from it; no new query and no new cache.
- **Why the public slug.** `public_api_slug` is unique across the whole table, not per gender
  (partial unique index; `apps/api/src/lib/slugify.ts`), lowercase and hyphenated. So the model's
  answer maps to exactly one garment-type row with no further matching, and the format is easy for
  the model to copy exactly. The internal `slug` is unique only within a gender and is
  Studio-facing; the uuid means nothing to the model.
- **The catch.** Only garment types with a public slug can be recognised. The admin backfill
  (`POST /admin/dev-api/catalog/backfill-slugs`) gave one to every active type that existed when
  it ran; a type created since has none until an admin sets it, and is reachable only through the
  garment-type list. T20 checks this.
- **The answer.** Trimmed and lower-cased; it must equal one of the slugs sent. `none`, an empty
  answer, or anything else is "not recognised". A recognised type with no template gets the D47
  message, not the list, because the answer is still correct.
- **This is a trial.** If recognition is not good enough in practice, the bot goes back to asking
  for the garment type from the list (step 3's fallback becomes the only path). Nothing else in
  the flow changes, so this is a switch in `classify.ts`, not a redesign.
- **No job, no credits.** It creates no `jobs` row, no ledger entry and no `job_events`.
  Recognition is free to the seller.
- **The workflow** is a `workflow_templates` row with `workflowType = 'classify'`, authored in the
  `aivastra-gpu` repo under that repo's ComfyUI rules (design below).
- **Workers.** A new worker pool value, `classify`, in `WORKER_POOL`
  (`packages/types/src/job-taxonomy.ts`). Admins enable it per worker in the Workers screen.
  A worker with an empty allowed list already accepts every pool, so it would accept this one too.
  Finding 8's warning applies: keeping Qwen loaded holds about 6 GB of VRAM on that worker, and a
  cold load takes about 37 s. Which workers get the pool is an ops decision in `aivastra-gpu`.
- **Time budget.** Recognition starts at the gender tap, so the seller does wait for it: about
  1 s of model time when Qwen is loaded, plus the image upload and `/history` polling. The bot
  waits at most **8 seconds** from the tap. After that, or if no worker was idle, or the workflow
  failed, the seller gets the garment-type list. A late answer is ignored; nothing is retried. A
  worker that has to load Qwen first (about 37 s) always misses the budget, which is why the
  classify workers must keep it loaded.
- **A wrong answer costs one tap.** "Wrong garment? Change" on the count list goes back to the
  type list. That correction is counted (below), because a wrong type would otherwise generate
  with the wrong workflow.

**Workflow design.** Four nodes, reusing the Qwen node already proven in `allinonetryonv5_1_`
(node 26, `AILab_QwenVL`):

```
LoadImage ─▶ ImageScaleToTotalPixels ─▶ AILab_QwenVL ─▶ PreviewAny
```

| Node | Settings | Why |
|---|---|---|
| `LoadImage` | patched with the file the dispatcher uploads via `uploadImageToComfy` | Same input path as try-on |
| `ImageScaleToTotalPixels` | about 1 MP (try-on uses 2) | Fewer image tokens, faster answer; size settled in T18 |
| `AILab_QwenVL` | `model_name` and `quantization` identical to the try-on node (Qwen2.5-VL-7B-Instruct, 4-bit); `max_tokens` 16; `keep_model_loaded` true; fixed seed; `custom_prompt` patched per request | Identical settings should let one loaded copy serve both workflows (checked in T18); the answer is one slug |
| `PreviewAny` | — | An output node, so the answer appears in `/history` as `outputs[<id>].text`; exact shape recorded in T18 |

The dispatcher finds the Qwen node and the output node by `class_type`, not by new node-ID
columns: no migration, and re-authoring the workflow cannot break the mapping. Saving a
`classify` workflow is rejected unless it has exactly one of each.

The prompt (the option lines are filled in per request):

```
You are a strict garment classification system. Look only at the garment in the image.
Choose exactly ONE option below and reply with its key only, nothing else.
If none fits, reply NONE.

full-shirt — Full shirt
kurti — Kurti
…

Reply with one key only.
```

Rules from the existing prompt that sellers' photos already need (for example "a lehenga choli
is never a saree") are carried over during T18.

**When to move to a hosted API.** Recorded per request, as Prometheus metrics from the dispatcher
and the bot:

| Metric | Meaning |
|---|---|
| `garment_classify_duration_seconds` | Request to result, as seen by the dispatcher |
| `garment_classify_outcome_total{outcome}` | `matched`, `unmatched`, `timeout`, `no_worker`, `failed` |
| `garment_classify_corrected_total` | Seller tapped "Change" after a matched answer |

Move to a hosted vision API (Claude Haiku 4.5 or Gemini Flash) if, over any week in production,
`timeout` + `no_worker` + `failed` exceed 10% of requests, the p95 duration exceeds 8 s, or
corrections exceed 15% of matched answers, or if keeping Qwen loaded measurably slows try-on jobs
on the classify workers. The bot only knows `requestGarmentClassification` and
`readGarmentClassification` (`classify.ts`); a hosted implementation writes the same result key
from the api, and the dispatcher lane is removed. Seller photos would then go to a third party,
which needs a line in the privacy policy before switching.

## 9. Presenting assets for selection

WhatsApp's interactive options (from third-party documentation; Meta's official reference could
not be retrieved during design, so these limits must be verified before implementation):

- **Reply buttons:** up to 3, text only. Used for the menu and after delivery.
- **List message:** up to 10 text rows, no images. Used for gender (four options, one more than
  reply buttons allow) and the garment-type fallback.
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

The carousel is used for one step only: picking poses (step 4). One card per eligible look of every
active template for the type, showing the look's pose image. Paging: a carousel shows up to 10
cards; a reply-button message with [More] follows it while more cards remain, together with
[Generate] and [Clear] (reply buttons stop at three).

A card tap selects or removes one item, so picking several poses is one tap per pose, each answered
"N selected · X credits". The seller finishes with [Generate]. Whether this feels acceptable on a
real device is checked in T1.

## 10. Credits and payments

- One shared balance: `user_credits` / `credit_ledger`, deducted by the existing atomic
  `createJob` path. The bot shows the cost per image and the balance with the pose cards (step 4), before
  anything is deducted, and the total in the "Working on N images" message (D45).
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

- A run is several jobs, one per image. The delivery loop (D37) polls unfinished
  `messaging_runs` rows and sends whatever finished: each result image uploaded to Meta's
  media endpoint (D38), marking the job in the run's `delivered_job_ids` so every send
  happens once. Images arrive one by one as they finish.
- The follow-up buttons are sent once, after the last job of the run has finished or failed
  (the run's `finished_at` is set then). The jobs of one run share a catalogue, which is how
  the loop knows the run is complete.
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
  last_inbound_at  timestamptz NULL  -- 24-hour window check before any free-form send
  linked_via       text  ('chat_link' | 'web_code')
  created_at / updated_at
  UNIQUE (channel, external_id)

Connect tokens and codes are not a table. They live in Redis (plan 1, D32):
  msg:connect:chat:{sha256(token)}  → { channel, externalId }   TTL 30 min, redeemed with GETDEL
  msg:connect:web:{sha256(code)}    → { userId }                TTL 10 min, redeemed with GETDEL
Same pattern as the WordPress connect flow (modules/merchant/wordpress-shared.ts).

messaging_runs (D34)                            -- one row per create call, keyed by catalogue_id
  catalogue_id         uuid pk                  -- the catalogue every job of the call shares
  messaging_account_id uuid → messaging_accounts.id (ON DELETE CASCADE)
  user_id              uuid → users.id (ON DELETE CASCADE)
  job_ids              uuid[]                   -- every job the call created
  created_at           timestamptz
  finished_at          timestamptz NULL         -- set by plan 3 once the run's follow-up is sent
Per-job delivery tracking is plan 3's: the delivery loop finds a finished
job's chat through this table, never through `job_inputs.params` (the create
request strips unknown params keys, and params feed the workflow).
```

Redis keys (no migration):
- `msg:session:{channel}:{external_id}` — conversation session, TTL 24 h.
- `msg:seen:{channel}:{message_id}` — inbound dedupe, `SET NX`, TTL a few days.
- Stream `messaging:inbound` — durable inbound events.
- Stream `classify:requests` — garment recognition requests (section 8a).
- `classify:result:{requestId}` — the recognised label, TTL 1 h.

One code-only enum value: `WORKER_POOL.CLASSIFY = 'classify'` (`workers.allowed_job_types` is a
plain `text[]`, so no migration), and a new `workflowType` value for the classify workflow.

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
| Send to Meta fails (5xx, rate limit) | Retry with backoff. Undelivered results are picked up by the next delivery-loop poll because the job stays out of `delivered_job_ids`. |
| Result ready after the 24-hour window closed | Approved utility template with a button; image sent after the tap. |
| Job fails terminally | Dispatcher refunds that job; bot reports "k of N failed" with Retry for the failed ones. |
| Message from a number that is not connected | Connect prompt with a fresh link. Nothing else is processed, and a garment photo sent at this point is not downloaded. |
| Connect token expired or already used | Web page / bot says so and offers a fresh one. |
| `CONNECT <code>` from a number already connected to another account | Refused: "This number is connected to another account. Disconnect it in Settings first." |
| A template's look was deactivated after the seller picked it | [Generate] re-reads the pool, drops it and says "Those poses changed. Please choose again."; nothing is charged. If the create call rejects it, the selection is cleared with the same message. |
| Garment recognition slow, failed, no idle worker, or no matching type | Garment-type list instead (section 8a). The seller loses one tap, never the run. |
| Recognised type has no template for that gender | "Not available on WhatsApp yet" with a link to the web studio (D47). |
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

### Consent and opt-out wording (approved 2026-10-13)

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
  "photo from main menu" shortcut, recognised vs fallback garment type, "Change" after a wrong
  answer, the count limits, duplicate look taps, generation on the last pick, defaults for face,
  lower and shoes, the required extra photos.
- Matching a recognised label to a gender's garment types.
- WhatsApp rendering of each abstract message type, checked against fixture payloads.
- Webhook signature verification.

**Integration tests** (existing harness: fresh Postgres database and MinIO bucket per file)
- Webhook route ➜ inbound consumer ➜ `createJob`, with the Meta client stubbed at the HTTP boundary.
- A message from an unconnected number creates no user, no job and no upload.
- Connect, both directions: token/code is single-use and expires; a number already connected to
  another account is refused.
- A run of k picked looks creates k jobs and deducts the same credits the web would.
- The dispatcher classify lane, with ComfyUI stubbed: writes the result key, records the outcome,
  and never touches `jobs` or credits.
- The delivery loop marks each job in `delivered_job_ids` exactly once, sends the follow-up
  buttons once per run (setting `finished_at`), and sends the paid ready template at most
  once per run (`ready_notice_sent_at`).
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
| `GARMENT_RECOGNITION_ENABLED` | Garment recognition wait (D48), literal `'true'` only; off = always the garment-type list |

Added to `.env.production.example`, the staging env check, and `apps/api/src/env.ts`.

## 17. Future work (explicitly deferred)

- Saree / saree-mannequin / fabric-to-garment flows in the bot.
- Batch: several garments in one run (maps onto the existing `/jobs/batch`).
- In-chat Razorpay payment links (section 10).
- Signing up from WhatsApp (dropped for v1; it would bring back email-less accounts, a claim flow
  and the duplicate-account problem).
- Choosing face, background, aspect ratio, lower or shoes in the chat; "Create your own",
  back-view poses and pose presets in the chat (D42, D43).
- Moving garment recognition to a hosted vision API, if the thresholds in section 8a are hit.
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
| Q3 Meta onboarding owner | Ram Kumar. | D25 |
| Q5 Template budget | No monthly cap; no proactive messages. | D26 |
| Q11 Success metric | Generations from WhatsApp per week; connected share as the adoption number. | D28 |
| Q8 Consent wording | The draft in section 14 is approved. | D21 |
| Q12 Amazon rule on the web | Remove the logic; keep the admin tag. | D30 |
| Q13 Shorter flow | Management's five steps: photo, automatic garment recognition, gender, pose count, poses. | D40, D42–D47 |
| Q14 Which model recognises the garment | Our own GPU first; a hosted API only if it causes problems or delay. | D41 |

### Still open — for management (business / product)

None. One follow-up from Q8 remains a check rather than a decision: the existing `/privacy` and
`/terms` pages have not been read for whether they already cover WhatsApp messaging and phone
numbers. If they do not, they need a line added before launch. No legal review was requested.

### Technical (to verify before or during implementation)

- **T1. Closed 2026-10-13 (spike on the test number).** Non-template carousel confirmed:
  `type: "interactive"`, 2–10 cards, quick-reply buttons; every card MUST carry a card-level
  `type` — `"type": "cta_url"` with quick_reply buttons is accepted (without it Meta returns
  HTTP 400 `missing: 'type'`). Tap-per-look works: each carousel tap arrives as its own
  message of `type: "button"` with the reply id in `button.payload` (not
  `interactive.quick_reply`), so two taps in a row select two looks.
- **T2.** Confirm Meta's current pricing model and whether utility templates sent inside an open
  service window are free.
- **T3. Closed 2026-10-13 (spike).** YES: a production presigned link
  (`app.aivastra.com/minio/...`, 1h expiry) loaded in a carousel card. Carousels use links;
  result images are still uploaded to Meta's media endpoint and sent by id (D38).
- **T4.** Closed. `/connect/whatsapp` sits outside `(app)` like `/connect/wordpress`; the middleware sends logged-out sellers to login with `next`, and registration carries it across email verification as `pending_next` (same tab only). WhatsApp settings live in Settings → Profile Details; the studio has a status chip (D27).
- **T5.** Closed. The audit of code paths that assume `users.email` is set is no longer needed,
  because the bot creates no accounts.
- **T6. Closed 2026-10-13 (D-decisions in plan 3).** Message-ID dedupe TTL 3 days
  (`msg:seen:whatsapp:<messageId>`, `SET NX`); per-sender rate limit 30 messages per minute
  (over the limit the message is dropped with a log line).
- **T7.** Confirm the `payment_link.paid` webhook payload shape before the in-chat payment work
  (deferred, but recorded so it is not rediscovered).
- **T8. Closed 2026-10-13 (D37).** Delivery runs in the api process: one polling loop
  (`startWhatsappDelivery`, 5 s) over unfinished `messaging_runs` — no dispatcher move, no
  pub/sub notifier.
- **T9.** Closed, then reversed: the chat has no back-photo step (D42).
- **T10.** Closed for the bot: it does not apply the Amazon white-background rule (D23). Removal
  from the web app is D30.
- **T11.** Closed, then reversed: the seller picks which looks (D44).
- **T12.** Closed. `createJob(app, userId, body)` takes no request object (section 8).
- **T13.** Closed. Lower-only garment types are supported, following the studio's slot rules
  (D31, section 8).
- **T14. Meta's charge is ours, not the seller's.** A template message is billed by Meta to
  Aivastra's WABA payment method. It is not taken from the seller's credits. With no cap (D26) the
  exposure is one message per run that finishes after the window closed; add a metric for it so
  the monthly figure is visible.
- **T15.** Closed. Template mode has no back-photo step in the studio by design, and the bot
  matches it (D42, section 8).
- **T16.** Closed. The third and fourth upload slots are driven by garment-type flags and apply
  to standard types, so the bot asks for them (D31, section 8). Which garment types currently
  have those flags set is admin data, not code, and was not looked up.
- **T17. Is a missing required third photo rejected by the api?** The studio blocks Generate
  until a `requiresThirdUpload` type has its third photo. In `resolveTryonPlan` the only third-
  upload check found fires when a third photo *is* sent but the workflow has no node for it.
  Confirm whether a request with no third photo is rejected elsewhere; if it is not, the bot's
  own step is the only guard and should be tested as such.
- **T18. Classify workflow spike.** Before building the lane: author the classify-only workflow
  (Qwen2.5-VL node + text output) in `aivastra-gpu`, run it by hand on a worker with 20 real
  seller photos, and record per photo the label returned, the time warm and cold, and how the text
  appears in `/history` (which node, which field). The lane is built against that recorded
  output shape, and the accuracy figure decides whether the 8-second budget and the "Change" row
  are enough or the list should be shown more often.
- **T19. Are slug and label enough for the model?** Labels are admin-written for sellers, and the
  slugs were generated from them, sometimes with a gender or id suffix. Check during T18 whether
  the model picks reliably; if not, first try a one-line admin-maintained description per garment
  type rather than prompt-tuning in code, and if that fails, drop recognition and keep the list.
- **T20. Templates and public slugs per garment type.** List, per gender, which active garment
  types have an active catalogue template and which have a `public_api_slug` (a production read).
  Types without a template are not offered in the chat (D47); types without a public slug cannot
  be recognised and need the list. If either leaves common types out, admins fix the data before
  launch.
