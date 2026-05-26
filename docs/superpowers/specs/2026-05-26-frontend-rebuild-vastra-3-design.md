# Frontend Rebuild — Vastra 3.0 Design

_Spec date: 2026-05-26_

## Goal

Replace the entire user-facing web frontend (`apps/web/src/app/(app)` + `(auth)` + shared components) with the **Vastra 3.0** design handed off from Claude Design. Match the design's visual output pixel-for-pixel while wiring each page to the **existing** API as we build.

Admin surface (`/admin/*`, if any) and all backend services (`apps/api`, `apps/dispatcher`, `packages/*`) are **out of scope** — untouched.

## Source of Truth

- Design HTML prototype: `vastra3.0/project/vastra.html` (extracted to `/tmp/vastra-design/vastra3-0/project/vastra.html` for reference; the source is a single-file React-in-browser prototype).
- Design assets: `vastra3-0/project/assets/` — logo PNGs + auth background. Sample outfit/segment PNGs are NOT used (real images come from the API).
- The prototype is a prototype, not production code. Recreate the **visual output** in Next.js 15; do not copy the prototype's single-file structure.

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Scope | UI + restructure routes |
| Data wiring | Wire to existing API as we go (reuse current logic from `tryon/page.tsx`) |
| Missing pages | Drop `dashboard`, `jobs`, `credits`; replace `account` → `settings` |
| Studio wizard state | Single page, internal React state (lost on refresh — acceptable) |
| Settings stub tabs | Render design UI with disabled inputs; blank `<div>` placeholders where image assets unavailable |
| Pricing | Static 3-col plan table + Razorpay test-mode stub on top-up CTA |

## Design Language

- **Font:** Poppins (400/500/600/700) via `next/font/google`.
- **Palette** (`C` tokens, verbatim from prototype):
  ```
  pink #F55C7A   amber #F6B553   dark #141414   dark2 #282828
  white #FEFEFE  bg #FBFBFB      card #FFFFFF    border #EEEEEE
  border2 #E8E8E8  text #141414  mid #626262     light #939393  lighter #EEEEEE
  ```
- **Gradients:**
  ```
  grad        = linear-gradient(135deg, #F55C7A, #F6B553)
  gradSubtle  = linear-gradient(135deg, rgba(245,92,122,0.15), rgba(246,181,83,0.15))
  ```
- **Styling method:** inline `style={}` objects translated 1:1 from the prototype, fed by shared `tokens.ts`. No Tailwind, no shadcn — keeps fidelity exact and avoids a translation layer. Existing `cn.ts` may stay for incidental className joins but is not required.
- Global reset + Poppins + custom scrollbar (`6px`, thumb `#e0e0e0`) in `globals.css`.

## Target Route Structure

```
apps/web/src/app/
  layout.tsx                 root: font, body bg #FBFBFB, providers (QueryClient)
  globals.css                reset + scrollbar (strip old av-app/av-main)
  (auth)/
    login/page.tsx           split layout: form left, fashion bg-image panel right
    register/page.tsx        same split, register fields
  (app)/
    layout.tsx               dark Sidebar + scrollable <main>; pages own their own TopBar
    studio/page.tsx          4-step wizard + result reveal (re-skin of tryon logic)
    catalogues/
      page.tsx               grouped-by-date grid + search/filter/sort bar
      [id]/page.tsx          full image grid, per-image fullscreen + download
    assets/
      page.tsx               uploaded garments grid w/ tags + size meta
      [id]/page.tsx          large preview + file details + "used in" catalogues
    pricing/page.tsx         3-col plan compare + Razorpay-stub top-up
    settings/page.tsx        4 tabs: Profile / Billing / Credit History / Invoices
  api/auth/*                 UNCHANGED (refresh proxy route)
```

**Deleted route dirs:** `(app)/dashboard`, `(app)/jobs`, `(app)/credits`, `(app)/tryon`, `(app)/account`.

**Redirects (middleware.ts):** old bookmarks → new homes:
- `/dashboard` → `/studio`
- `/tryon` → `/studio`
- `/jobs` → `/catalogues`
- `/credits` → `/pricing`
- `/account` → `/settings`

## Shared Components (`apps/web/src/components/`)

| File | Purpose |
|------|---------|
| `tokens.ts` | `C` palette, `grad`, `gradSubtle` |
| `icons.tsx` | All inline-SVG icons from prototype (`Icon` base + named exports) |
| `logo.tsx` | `Logo` (dark-bg, wordmark inverted) + `LogoAuth` (light-bg, large) |
| `ui/grad-btn.tsx` | Gradient / outline button (`GradBtn`) |
| `ui/dark-btn.tsx` | Dark CTA button (`DarkBtn`) |
| `ui/input.tsx` | Labelled input: icon slot + password show/hide |
| `ui/google-btn.tsx` | Google OAuth button |
| `ui/divider.tsx` | Labelled horizontal divider |
| `sidebar.tsx` | Dark left rail: nav (Studio/Catalogues/Assets/Pricing/Settings), credits widget, profile block + menu |
| `topbar.tsx` | Page header: `title`, `subtitle`, `right` slot |
| `step-indicator.tsx` | Studio wizard 1–4 progress |

**Deleted components:** `navbar.tsx`, `theme-toggle.tsx`, old `sidebar.tsx`, old `topbar.tsx`, `ui/badge.tsx`, `ui/button.tsx`, `ui/input.tsx`. Delete `context/topbar-context.tsx` (and `context/` dir) if unused after layout rewrite — new sidebar/topbar are self-contained.

## Data Wiring (existing API — base `/v1`)

The current `tryon/page.tsx` already implements the full studio flow against real endpoints with `@tanstack/react-query`. The rebuild **re-skins** that logic into `studio/page.tsx`; it does not reinvent the wiring.

| Page / element | Endpoint(s) |
|----------------|-------------|
| login / register | existing `/api/auth/*` proxy (cookies) |
| sidebar credits widget | `GET /v1/credits` |
| studio step 1 — outfit types | `GET /v1/models/subcategories?gender=` |
| studio step 1 — garment upload | `POST /v1/uploads/presign` → R2 `PUT` (`api.uploadToR2WithProgress`) |
| studio step 2 — models (faces) | `GET /v1/models/faces?gender=` |
| studio step 3 — backgrounds | `GET /v1/models/backgrounds?faceId=&subcategoryId=` |
| studio step 4 — poses | `GET /v1/models/poses?subcategoryId=&faceId=&backgroundId=` |
| studio step 4 — lower/shoe (conditional) | `GET /v1/catalog/lower?gender=`, `GET /v1/catalog/shoe?gender=` |
| studio generate | `POST /v1/jobs/tryon` → `{ catalogueId }` |
| studio result — live progress | SSE `GET /v1/jobs/:id/events`; final `GET /v1/jobs/:id/result` |
| catalogues list | `GET /v1/catalogues` (group by date client-side) |
| view catalogue | `GET /v1/catalogues/:id` |
| assets list | _no dedicated endpoint yet_ — render design with empty array, TODO-tagged |
| view asset | _no endpoint yet_ — design shell + blank slots, TODO-tagged |
| pricing | static `PLANS` constant; top-up CTA → Razorpay test stub |
| settings → Profile | `GET /v1/me`, `PATCH /v1/me` |
| settings → Credit History | `GET /v1/credits` (+ history if available; else summary only) |
| settings → Billing / Invoices | disabled stub inputs, no API |

**Missing-endpoint rule:** if a route does not exist, the page renders the design with empty data and a `// TODO(wire):` comment. No runtime errors, no fake success states.

## Studio Wizard Internals

Single `studio/page.tsx`, internal state mirrors current `tryon` shape:

```tsx
const [step, setStep] = useState(0);          // 0..3 wizard, then 'result'
const [gender, setGender] = useState('');
const [subcategoryId, setSubcategoryId] = useState('');
const [platform, setPlatform] = useState('Amazon');
const [aspect, setAspect] = useState('1:1');
const [resolution, setResolution] = useState('2K');
const [garmentFile, setGarmentFile] = useState<File|null>(null);
const [garmentKey, setGarmentKey] = useState('');
const [faceId, setFaceId] = useState('');
const [backgroundId, setBackgroundId] = useState('');
const [poseIds, setPoseIds] = useState<string[]>([]);
const [lowerCatalogId, setLowerCatalogId] = useState('');
const [shoeCatalogId, setShoeCatalogId] = useState('');
// derived: credits = qty × quality-weight
```

react-query `enabled` gating per step preserved from `tryon`. On submit → `POST /v1/jobs/tryon` → switch to result view → open SSE for progress → reveal generated grid → "View catalogue" routes to `/catalogues/:catalogueId`.

State is lost on refresh (accepted).

## Settings — 4 Tabs

Tab bar: **Profile · Billing · Credit History · Invoices**.

- **Profile** — wired: `GET/PATCH /v1/me`. Personal info + account preferences + change password. "Update Changes" button → ✓ saved state.
- **Billing** — stub: disabled address + payment-method inputs, "Coming soon" badge. No save.
- **Credit History** — wired: summary cards (purchased / used / remaining) + transaction table from `GET /v1/credits`.
- **Invoices** — stub: disabled invoice table, blank divs for missing data.

Logout button lives in this page's TopBar `right` slot → clears auth cookies → redirect `/login`.

## Pricing

Static `PLANS` constant (Starter / Growth / Pro) with the feature-comparison rows from the prototype. Each plan CTA opens a Razorpay **test-mode** checkout (script lazy-loaded; key from `NEXT_PUBLIC_RAZORPAY_KEY`). On `payment.success` → toast + redirect `/settings` (Credit History tab). No backend purchase route built in this effort.

## Assets (image handling)

Copy design PNGs to `apps/web/public/img/`:
- `logo-icon.png`, `logo-icon-large.png`, `logo-wordmark.png`, `logo-wordmark-large.png`, `auth-bg.png`.

Do NOT copy sample outfit/segment PNGs — those slots render blank `<div>` placeholders (design bg `#F9F9F9`), filled by real API images where wired.

## Build Order (sub-steps, each ends with manual browser smoke test)

1. **Foundation** — `tokens.ts`, `icons.tsx`, `logo.tsx`, `ui/*` primitives, `globals.css` reset, copy public images, Poppins font in root layout.
2. **App shell** — `(app)/layout.tsx` + new `sidebar.tsx` (credits widget can stub until step covers wiring).
3. **Auth** — `login`, `register` split-layout pages (reuse existing auth submit logic).
4. **Settings** — Profile tab wired (`/v1/me`), Credit History wired (`/v1/credits`), Billing + Invoices stubbed. Proves the wiring pattern + logout.
5. **Catalogues + View Catalogue** — read-only, easy wiring (`/v1/catalogues`).
6. **Assets + View Asset** — design shell; empty data + TODO tags (no endpoint).
7. **Studio wizard** — re-skin `tryon` logic into `studio/page.tsx`: 4 steps + result + SSE.
8. **Pricing** — static plans + Razorpay stub.
9. **Cleanup** — delete old route dirs + components; add redirect middleware; strip old `globals.css` classes; remove `context/` if unused.

## Out of Scope

- Backend changes (`apps/api`, `apps/dispatcher`, `packages/*`).
- Admin UI.
- Real billing/invoices/assets endpoints.
- Refresh-safe wizard state, deep-linkable steps.
- Real Razorpay production integration (test stub only).

## Risks / Notes

- **`tryon` deletion timing:** keep `tryon/page.tsx` as reference until `studio/page.tsx` is verified working, then delete in cleanup (step 9). Do not delete early.
- **react-query provider:** confirm `providers.tsx` mounts `QueryClientProvider`; new pages depend on it.
- **Credits endpoint shape:** `GET /v1/credits` returns balance; if it lacks a transaction history array, Credit History tab shows summary cards only + empty table (TODO-tagged).
- **Pixel fidelity:** all spacing/sizing/colors come straight from the prototype's inline styles — read them directly, don't approximate.
