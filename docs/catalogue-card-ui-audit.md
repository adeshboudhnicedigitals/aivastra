# UI Audit — Image Cards (Catalogues, Catalogue Detail, "Your Products")

**Date:** 2026-06-23
**Scope:** The image/product card components and their grids on:
- `apps/web/src/app/(app)/catalogues/page.tsx` — catalogue list cards
- `apps/web/src/app/(app)/catalogues/[id]/page.tsx` — per-image cards (`ImageCard`)
- `apps/web/src/app/(app)/assets/page.tsx` — "Your Products" garment cards
- Supporting: `apps/web/src/components/tokens.ts`, `apps/web/src/app/globals.css`, the two `loading.tsx` skeletons

> **On the competitor comparison:** I can't verify the live UI of the specific tools you named ("Getyana"/"Beburst") from this codebase, so I have **not** asserted anything specific about them. Where I say "competitors / category norm," I mean the well-established conventions of premium **AI-fashion / virtual-try-on catalog tools and e-commerce product-listing grids** (uniform aspect-ratio cover crops, unified card surfaces, status badges, responsive grids, hover quick-actions). Treat §5 as "industry conventions for this product category," not a claim about those two names.

---

## 1. How the cards are built today (factual baseline)

| Property | Catalogues list | Catalogue detail | Your Products (assets) |
|---|---|---|---|
| Card size | `width:370, height:376` (`:1367`) | `width:100%, height:316` (`:181`) | `width:370, height:376` (`:153`) |
| Grid track | `repeat(auto-fill, 370px)` (`:1354`) | `repeat(auto-fill, 369.33px)` (`:679`) | `repeat(auto-fill, 370px)` (`:145`) |
| Grid gap | `8` (`:1355`) | `16` (`:681`) | `16` (`:147`) |
| Image fit | `object-fit: contain` (`:101`) | `object-fit: contain` (`:235`) | `object-fit: contain` (`:210`) |
| Image bg | `C.lighter` = `#eeeeee` (`:1379`) | `#f5f5f5` / `#111` (`:170`) | `C.lighter` (`:165`) |
| Corner radius | image `8`; download pill `12` | image `8`; buttons `8` | image `8` |
| Resting elevation | none (shadow only on hover) | none | none |
| Hover | imperative `style.boxShadow` + `querySelector('[data-scale]')` (`:1395`) | none | imperative + `querySelector('div')` (`:182`) |
| Card meta row | `height:16`: icon + count + `#id8` (`:1486`) | `height:28`: `#id8` + actions (`:359`) | `height:16`: icon + count + filename (`:229`) |
| Image `alt` | `""` (`:100`) | `#id8` when done, else overlay | `""` + `aria-hidden` (`:206`) |

Palette (`globals.css`): page bg `--c-bg:#fbfbfb` (`:16`), card placeholder `--c-lighter:#eeeeee` (`:23`), borders `#eeeeee/#e8e8e8`, text `#141414`, mid `#626262`, light `#939393`. Dark-mode tokens exist (`:29-44`).

---

## 2. Top findings (ranked by impact)

### F1 — 🔴 The grid is not responsive (desktop-only fixed widths)
Cards are a hardcoded `370px` and the grid uses `repeat(auto-fill, 370px)` with **no `minmax()`** (`catalogues:1354`, `assets:145`, `detail:679`). Consequences:
- Below ~430px viewport the 370px card **overflows horizontally** (the web `<body>` has no `min-width`, so the app is reachable on mobile). The only media query in `globals.css` targets the auth panel (`:133`) — there are **zero** breakpoints for these grids.
- On tablet/in-between widths, `auto-fill` of a *fixed* track leaves a large dead right-gutter instead of growing the cards.

**Category norm:** fluid cards via `repeat(auto-fill, minmax(220–280px, 1fr))` so columns reflow *and* cards stretch to fill the row, from phone to wide desktop.

### F2 — 🔴 `object-fit: contain` makes a product gallery look like a file viewer
Every card image uses `contain` on a grey letterbox (`:101`, `:210`, `:235`). The generated images are portrait (2:3 / 3:4) but the cards are ~square (370×~352), so each portrait image floats with **grey bars on both sides**. The grid reads as "thumbnails in boxes," not a clean lookbook.

**Category norm:** product cards use a **fixed portrait aspect ratio** (typically `3:4` or `4:5`) with `object-fit: cover` so imagery fills edge-to-edge and every tile is identically shaped. This single change does the most to close the visual gap with premium competitors. (Offer a "fit/fill" toggle if some users need to see the whole frame.)

### F3 — 🟠 No card surface / resting elevation → flat, low-contrast gallery
There is no actual "card": only the image area has a radius; the metadata sits on bare page background. At rest there's **no border or shadow** (shadow is applied only on hover, `:1397`). The placeholder grey (`#eeeeee`) sits on page grey (`#fbfbfb`) — almost no separation. The result looks flat and unbranded.

**Category norm:** a unified card surface — subtle 1px border *or* a soft resting shadow, `12–16px` radius, consistent internal padding, hover elevation as an *enhancement* not the only state.

### F4 — 🟠 Dark mode is broken on these pages (hardcoded hex, not tokens)
Despite a full dark palette (`globals.css:29-44`) and the CLAUDE.md rule *"Never use raw hex … always use tokens,"* these pages hardcode light colors throughout:
- Catalogues toolbar: `background:'rgba(255,255,255,0.97)'` (`:580`), `boxShadow:'0 1px 0 #EEEEEE'` (`:581`), filter buttons `#FEFEFE`/`#EEEEEE`/`#F9F9F9`, dropdowns `#FEFEFE` — dozens of literals.
- Detail page: `#EEEEEE`, `#F9F9F9`, `#141414`, `#626262` (e.g. `:615-621`, `:643`).
- Accents as literals: `rgba(245,92,122,…)` instead of `--c-pink` (`:817`, `:1466`); gradient `linear-gradient(90deg,#F55C7A,#F6B553)` (`:426`, `:310`) instead of the `grad` token (which is `135deg` — so even the **angle** is inconsistent).

In dark mode the toolbar, filters, dropdowns, and search render light-on-dark → unusable. This also violates the project's own token invariant.

### F5 — 🟠 Loading skeleton doesn't match the cards (layout shift)
`catalogues/loading.tsx` renders `CardGridSkeleton count={9} w={300} h={300}` (`:12`) but real cards are `370×376` → a visible **CLS jump** when data arrives. (`assets/loading.tsx` correctly uses `370×376`, `:11` — so the catalogues one is just wrong.) Additionally, the catalogues page *also* has an inline centered-spinner loading branch (`:1295`) that competes with the route skeleton — two different loading treatments for one page.

### F6 — 🟠 Accessibility gaps on the card grid
- **Selection checkbox is a `<div onClick>`** (`catalogues:1416`) — not focusable, no `role="checkbox"`/`aria-checked`, not keyboard-operable.
- **Hover affordances are mouse-only.** Hover scale/shadow are set imperatively via `onMouseOver/onMouseOut` + `querySelector` (`:1395-1412`, `assets:182-194`); there's no `:focus-visible` equivalent for keyboard users (assets adds `onFocus` for shadow but not the scale; catalogues has none).
- **Primary content has empty alt.** The generated product image is the content, yet `alt=""`/`aria-hidden` (`:100`, `:206`). Screen-reader users get nothing meaningful.
- **Inconsistent dialog semantics.** Detail lightbox has `role="dialog" aria-modal` (`:701`); assets lightbox has `role="dialog"` **without** `aria-modal` (`:263`); neither traps focus or restores it on close.
- **Contrast:** `--c-light:#939393` on `#fbfbfb` ≈ 2.9:1 — **fails WCAG AA** for the secondary text it's used in (empty states, labels).

### F7 — 🟡 Imperative DOM manipulation for hover (fragility + perf)
`querySelector('[data-scale]')` / `querySelector('div')` to mutate `transform`/`boxShadow` (`catalogues:1398`, `assets:182`) bypasses React, is string-fragile (a markup change silently breaks the effect), and combines badly with F2: scaling a `contain` image inside `overflow:hidden` crops the grey bars unevenly. Move to CSS `:hover`/`:focus-visible` (or a styled component class).

### F8 — 🟡 Inconsistent geometry across the three surfaces
Three different card heights (`376` / `316` / `376`), two gaps (`8` vs `16`), and a magic `369.33px` track on detail (`:679` — clearly `container/3`, not a token). Same conceptual object ("an image card") looks different on every page. Centralize one `<ProductCard>` component + tokens for size/gap/radius.

### F9 — 🟡 Card metadata is developer-facing and cramped
The meta row is `height:16` (`:1486`, `:229`) and shows only an icon, a count, and `#id.slice(0,8)` — a raw UUID prefix — as the "title." There's no human title, date, platform, or status chip on the card face.

**Category norm:** a readable title, a **status badge** (Ready / Generating / Failed), item count, and date/platform — so the card communicates state at a glance instead of relying on the cover's spinner.

### F10 — 🟡 Emoji placeholder for missing product image
Assets uses a `👗` emoji at `fontSize:40, opacity:0.4` (`:224`) as the empty thumbnail. Emoji render differently per OS and read as unpolished for a B2B tool. Use a branded line-icon/illustration placeholder.

### F11 — 🟢 Minor: lazy-loading & intrinsic dimensions
Card `<img>`s (intentionally plain `<img>` for presigned R2 URLs) omit `loading="lazy"` and width/height attributes, so large grids load all images eagerly and contribute to CLS. (The internal `/results` admin page *does* use `loading="lazy"` — the user-facing cards should too.)

---

## 3. What's already good (keep it)

- **In-progress card states are genuinely nice** — blurred garment as the card background while generating (`detail:209-223`), an animated `ProgressRing` with stage labels (`:66`, `:328`), and a "Nth in Queue" state with a shimmer bar (`:266-315`). This is more polished than most competitors' "spinner in a box."
- **Selection UX** — shift-range select, Ctrl/Cmd-A, Esc to clear, indeterminate select-all, hover-reveal checkbox (`:336-407`).
- **Bulk ZIP download** with concurrency pooling, progress, and partial-failure toasts (`:416-555`).
- **Live updates** via `useJobStream` patching the query cache (`:205`, `detail:489`) — cards update in place without refetch.
- A real **design-token system + dark palette** exists (`tokens.ts`, `globals.css`) — the problem (F4) is that the card pages bypass it, not that it's missing.

---

## 4. Category-convention gap (what premium AI-fashion / e-commerce galleries do)

| Dimension | Premium category norm | This app today |
|---|---|---|
| Image crop | Fixed portrait ratio, `cover`, edge-to-edge | Square-ish card, `contain`, grey letterbox (F2) |
| Grid | Fluid `minmax(…, 1fr)`, responsive to phone | Fixed 370px, desktop-only (F1) |
| Card surface | Border/shadow, 12–16px radius, padding | No surface; flat tile, radius 8 (F3) |
| Status | Badge on card face | Spinner/text only; UUID as label (F9) |
| Hover | CSS quick-actions (zoom/download/select) revealed | Imperative scale+shadow, mouse-only (F6/F7) |
| Dark mode | Token-driven, fully themed | Broken (hardcoded hex) (F4) |
| Loading | Skeleton matching final layout | Mismatched skeleton → CLS (F5) |
| A11y | Real controls, focus states, alt text | div-checkbox, empty alt, no focus (F6) |

---

## 5. Recommended target card spec (concrete)

A single shared `<ProductCard>` used by all three pages:

```
- Container: surface = C.card, border 1px C.border, radius 14, overflow hidden,
  resting shadow 0 1px 2px rgba(0,0,0,.04); hover shadow 0 8px 28px rgba(0,0,0,.12)
  (CSS :hover, not JS). Selected: 2px C.pink ring + faint pink tint.
- Media: aspect-ratio 3/4, object-fit: cover, object-position: top center,
  background C.field; <img loading="lazy"> with width/height.
- Overlay quick-actions (top-right, reveal on :hover/:focus-within): zoom, download, select.
- Footer (padding 12–14): title line + status badge (Ready/Generating/Failed) +
  count + date. Use tokens only — no raw hex.
- Grid: repeat(auto-fill, minmax(240px, 1fr)); gap 16 (consistent across pages);
  add a 1–2 col layout under ~640px.
```

### Remediation order (impact ÷ effort)
1. **F4 dark-mode / token cleanup** + **F5 skeleton size** — small, mechanical, removes obvious breakage.
2. **F1 responsive grid** (`minmax(...,1fr)`) — a few lines per grid, fixes mobile overflow.
3. **F2 cover + fixed aspect-ratio** — the biggest *visual* upgrade toward the competitor look.
4. **F3/F8 unify into one `<ProductCard>`** with a resting surface — kills the geometry drift and the flatness.
5. **F6/F7 a11y + CSS hover** — real checkbox, focus-visible, alt text, dialog focus trap.
6. **F9/F10/F11** polish — status badges, branded placeholder, lazy-loading.

---

## 6. File/line index for every claim

- Fixed card size & grid: `catalogues/page.tsx:1354,1367`; `assets/page.tsx:145,153`; `[id]/page.tsx:679`
- `object-fit: contain`: `catalogues:101`; `assets:210`; `[id]:235`
- Hover imperative DOM: `catalogues:1395-1412`; `assets:179-194`
- div-checkbox: `catalogues:1416-1421`
- Hardcoded hex / dark-mode: `catalogues:580-581,617,639,735,1284`; `[id]:615-621,643,426`
- Skeleton mismatch: `catalogues/loading.tsx:12` vs `assets/loading.tsx:11`
- Empty alt / aria: `catalogues:100`; `assets:206`; dialog `assets:263` vs `[id]:701`
- Emoji placeholder: `assets:224`
- Metadata row: `catalogues:1486-1502`; `assets:229-254`; `[id]:359-370`
- Good in-progress states: `[id]:66-105,206-315,328`
- Palette/tokens: `globals.css:9-44`; `tokens.ts:1-21`
