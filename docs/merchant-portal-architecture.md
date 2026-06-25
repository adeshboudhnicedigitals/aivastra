# Merchant Portal — Architecture & Use Cases

## Overview

The merchant portal is a self-service dashboard for widget clients (merchants) who have signed up to embed the AI Vastra Virtual Try-On widget on their e-commerce websites. It is entirely separate from the main Aivastra web app and the internal admin panel.

---

## Who Uses This

| Actor | Description |
|---|---|
| **Merchant** | An e-commerce business that has signed up and been approved. They log in to manage their widget integration, monitor try-on usage, and purchase credit plans. |
| **Admin** | Activates/deactivates merchants and adds credits via the admin panel. The merchant portal itself has no admin functionality. |

---

## Route Structure

All merchant routes live under the `(merchant)` route group in `apps/web/src/app/(merchant)/`.

```
(merchant)/
├── layout.tsx                        # Shared sidebar + topbar (client)
├── lib.ts                            # requireMerchant() — shared auth helper
│
└── merchant/
    ├── login/page.tsx                # Public — login form
    ├── signup/page.tsx               # Public — signup form
    │
    ├── dashboard/
    │   ├── page.tsx                  # Server component — fetches merchant data
    │   └── DashboardContent.tsx      # Client component — renders dashboard UI
    │
    ├── api-keys/
    │   ├── page.tsx                  # Server component
    │   └── ApiKeysContent.tsx        # Client component — embed code + account status
    │
    ├── tryon-results/
    │   ├── page.tsx                  # Server component
    │   └── TryOnResultsContent.tsx   # Client component — fetches + renders jobs table
    │
    ├── settings/
    │   ├── page.tsx                  # Server component
    │   └── SettingsContent.tsx       # Client component — widget config form
    │
    ├── profile/
    │   ├── page.tsx                  # Server component
    │   └── ProfileContent.tsx        # Client component — contact/company info form
    │
    ├── documentation/page.tsx        # Server component — static integration guide
    └── pricing/page.tsx              # Server component — static pricing cards
```

---

## Authentication Flow

```
Browser
  │
  ├─ POST /api/merchant/login          (Next.js API route — BFF proxy)
  │     │
  │     ├─ Calls POST /v1/merchant/auth/login  (Fastify API)
  │     └─ On success: sets httpOnly cookie  merchant_access_token
  │
  └─ All protected page requests
        │
        └─ layout.tsx checks pathname — skips sidebar for /login, /signup
              │
              └─ page.tsx (server component) calls requireMerchant()
                    │
                    ├─ Reads merchant_access_token from cookies()
                    ├─ If missing → redirect('/merchant/login')
                    ├─ Calls GET /v1/merchant/me  (Fastify API)
                    ├─ If 401/error → redirect('/merchant/login')
                    └─ Returns { data: MerchantData, token }
```

The `merchant_access_token` is an httpOnly cookie — never accessible from JavaScript. The raw JWT is passed as a prop from server components to client components **only for subsequent client-side API calls** (e.g. fetching the jobs list).

---

## Component Pattern

Every protected page follows the same two-layer pattern:

```
page.tsx  (Server Component)
  │  reads cookie via requireMerchant()
  │  fetches any server-side data
  └─ renders <XxxContent data={...} token={...} />

XxxContent.tsx  (Client Component — 'use client')
  │  receives data as props (no direct cookie access)
  │  may make additional client-side fetches using the token prop
  └─ renders interactive UI (useState, event handlers, etc.)
```

This keeps auth logic server-side while allowing interactive React UI where needed.

---

## Shared Utilities

### `lib.ts` — `requireMerchant()`

```ts
// Used at the top of every protected page.tsx
const { data, token } = await requireMerchant();
```

- Reads `merchant_access_token` from cookies
- Fetches `GET /v1/merchant/me` from the Fastify API
- Redirects to `/merchant/login` on any failure
- Returns typed `MerchantData` + raw JWT token

### `layout.tsx` — Sidebar + Topbar

- Client component wrapping all merchant routes
- Renders nothing but `{children}` for `/merchant/login` and `/merchant/signup`
- Sidebar: white background, 240px wide, fixed position
- Nav sections: Core Services / Management / Account
- Admin dropdown: links to Profile, Settings; handles logout via `POST /api/merchant/logout`

---

## API Endpoints Used

All calls go to the Fastify API (`NEXT_PUBLIC_API_URL`, default `http://localhost:4000`).

| Method | Endpoint | Used by | Purpose |
|---|---|---|---|
| `POST` | `/v1/merchant/auth/login` | Login page (via BFF) | Authenticate merchant |
| `POST` | `/v1/merchant/auth/logout` | Logout handler | Invalidate session |
| `GET` | `/v1/merchant/me` | `requireMerchant()` | Fetch merchant profile + credit balance |
| `GET` | `/v1/merchant/jobs` | Dashboard, Try-On Results | List widget try-on jobs for this merchant |

---

## Pages & Use Cases

### 1. Dashboard (`/merchant/dashboard`)

**Purpose:** Central overview of the merchant's widget account.

**What it shows:**
- Welcome message with the merchant's contact name
- 4 stat cards: Total Try-Ons, Active Jobs, Credits Remaining, Widget Status
- Embed code snippet with a one-click copy button
- Quick links to Documentation and API Keys
- Service Details panel: widget key, status badge, domain, plan tier
- Upgrade to Pro CTA button
- Live Feed: last 5 try-on jobs with status and date

**Data sources:** `requireMerchant()` (server) + `GET /v1/merchant/jobs` (client-side on mount)

---

### 2. API Keys (`/merchant/api-keys`)

**Purpose:** Give the merchant everything they need to embed the widget on their site.

**What it shows:**
- Full embed code snippet (HTML + script tags with the merchant's actual widget key pre-filled)
- One-click copy button
- Account Status panel: widget active/inactive badge, status description, widget key, domain, plan

**Use case:** A developer from the merchant's team opens this page, copies the snippet, and pastes it into their website's HTML.

**Data sources:** `requireMerchant()` (server only — no client-side fetches)

---

### 3. Try-On Results (`/merchant/tryon-results`)

**Purpose:** Let the merchant see a history of all virtual try-on jobs triggered through their widget.

**What it shows:**
- Table with columns: #, Job ID (truncated), Status (colour-coded badge), Duration (seconds), Credits Charged, Created At, Completed At
- Empty state with a helpful message when no jobs exist yet

**Use case:** The merchant monitors how many try-ons have been processed, checks for failures, and verifies that credits are being consumed as expected.

**Data sources:** `requireMerchant()` (server) + `GET /v1/merchant/jobs` (client-side on mount)

---

### 4. Settings (`/merchant/settings`)

**Purpose:** Configure how the widget looks and behaves on the merchant's website.

**Sections:**
| Section | Fields |
|---|---|
| General | Widget name, Enable/Disable toggle, Button position |
| Design | Primary colour, Button colour, Background colour, Border radius, Shadow toggle |
| Upload | Min/max image size (MB), Camera upload toggle |
| Advanced | Allowed domains (whitelist), Custom CSS |

**Note:** Settings are currently local state only (UI scaffold). Persistence requires a backend endpoint for storing widget configuration per merchant.

**Use case:** The merchant customises the widget to match their brand colours and sets allowed domains to prevent unauthorised usage of their widget key.

---

### 5. Profile (`/merchant/profile`)

**Purpose:** Allow the merchant to update their personal and company information.

**What it shows:**
- Avatar with first initial + gradient background
- Editable fields: Full Name, Phone, Company Name, Website URL
- Email is read-only (cannot be changed)

**Use case:** A merchant updates their contact name or phone number after a staff change, or corrects their website URL.

---

### 6. Documentation (`/merchant/documentation`)

**Purpose:** Static integration guide explaining how to embed and use the widget.

**Sections:**
1. Prerequisites
2. Basic HTML Markup
3. Required Widget Scripts
4. JavaScript — triggering the widget
5. Optional CSS Styling
6. Supported Categories
7. Notes & Best Practices

**Use case:** A merchant's developer reads the guide to understand how to wire up the Try-On button on product pages. No login data is used — all content is static.

---

### 7. Credit Pricing Plans (`/merchant/pricing`)

**Purpose:** Display available credit plan tiers for the merchant to choose from.

**Plans:**
| Plan | Price | Credits | Price/Credit |
|---|---|---|---|
| Basic | ₹25,000/mo | 10,000 | ₹2.50 |
| Advanced | ₹50,000/mo | 25,000 | ₹2.00 |
| Pro *(featured)* | ₹75,000/mo | 40,000 | ₹1.88 |
| Ultra | ₹1,50,000/mo | 1,00,000 | ₹1.50 |

All "Choose Plan" buttons link to `sales@aivastra.com` — credit top-ups are currently handled manually by an admin via the admin panel.

**Use case:** A merchant running low on credits views the plans and emails the sales team to upgrade. The Pro plan is visually highlighted as the recommended tier.

---

## Data Flow Summary

```
Cookie (merchant_access_token)
    │
    ▼
requireMerchant()  ──►  GET /v1/merchant/me
    │                        │
    │                        ▼
    │                   MerchantData
    │                   { id, companyName, contactName, email,
    │                     phone, websiteUrl, widgetKey,
    │                     creditBalance, isActive, createdAt }
    │
    ▼
Server page.tsx  ──props──►  Client XxxContent.tsx
                                  │
                                  ▼  (where needed)
                             GET /v1/merchant/jobs
                                  │
                                  ▼
                             JobRow[]
                             { id, status, creditsCharged,
                               createdAt, completedAt }
```

---

## Key Constraints

- **No admin functionality** — merchants cannot see other merchants' data, change their own widget key, or grant themselves credits.
- **Credits are read-only** — balance is shown but can only be topped up by an admin via the admin panel (`POST /v1/admin/widget-clients/:id/credits`).
- **Widget key is immutable** — generated at signup, displayed for copy but not editable.
- **Settings are UI-only** — the settings form does not yet persist to the backend. A `PATCH /v1/merchant/settings` endpoint and corresponding DB table would be needed to make this functional.
- **Auth is cookie-based** — the `merchant_access_token` httpOnly cookie is set by the Next.js BFF (`/api/merchant/login`), never by the browser directly.
