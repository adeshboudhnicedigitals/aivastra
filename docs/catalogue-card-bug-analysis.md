# Catalogue Card UI — Bug Analysis & Remediation Guide

**Date:** 2026-06-23
**Source audit:** `docs/catalogue-card-ui-audit.md`
**Scope:** All image/product card components and their grids across three pages:
- `apps/web/src/app/(app)/catalogues/page.tsx` — catalogue list
- `apps/web/src/app/(app)/catalogues/[id]/page.tsx` — catalogue detail (`ImageCard`)
- `apps/web/src/app/(app)/assets/page.tsx` — "Your Products" garment cards

For each finding this document covers: root cause, business impact, technical impact, affected areas, risk introduced, recommended fix, how the fix resolves the issue, and downstream consequences on related systems, performance, security, data integrity, and maintenance.

---

## F1 — Fixed-width grid (not responsive, breaks on mobile)

### Root Cause
All three grid pages hardcode a fixed pixel track:

```
repeat(auto-fill, 370px)          /* catalogues/page.tsx, assets/page.tsx */
repeat(auto-fill, 369.33px)       /* [id]/page.tsx — container ÷ 3, hardcoded */
```

CSS `auto-fill` with a fixed track only controls *how many columns fit* — it never stretches a column to fill leftover space. The `369.33px` on the detail page is `container_width / 3` computed once at some viewport and hardcoded, making it wrong on every other screen width. No media queries exist in `globals.css` for these grids (the only query targets the auth panel).

### Business Impact
The app is reachable on mobile — there is no `min-width` on `<body>`. Any user opening it on a tablet or phone sees a single 370px card overflowing the viewport, requiring horizontal scrolling to navigate. For a B2B tool pitched to fashion brands who review catalogues on the go, this is a credibility issue that can kill a sales demo or a first impression.

### Technical Impact
- **Viewport 371–740px** (most tablets in portrait): `auto-fill` of 370px fits exactly one column, leaving a dead gutter equal to the remaining width. Cards look undersized and isolated.
- **Viewport <370px**: the card clips outside the scroll container entirely — no CSS prevents the overflow.
- **The `369.33px` track** on the detail page produces a 4th ghost column on wide displays because `floor(width / 369.33)` can leave enough space for a fractional column that `auto-fill` cannot fill, creating an empty slot.
- **Gap inconsistency**: the list page uses `gap: 8` while the detail and assets pages use `gap: 16`. Same visual object, different spacing on every page.

### Affected Areas
- `catalogues/page.tsx` — grid container (around line 1354)
- `catalogues/[id]/page.tsx` — grid container (around line 679)
- `assets/page.tsx` — grid container (around line 145)
- `catalogues/loading.tsx` — skeleton grid must match

### Risks Introduced by the Fix
Minimal. `minmax(240px, 1fr)` has >97% browser support. The only care needed: any component that reads card DOM dimensions (e.g. `getBoundingClientRect`) to position overlays will get different values at different viewport widths. Currently no component does this — all overlays use `position: absolute; inset: 0` which is viewport-independent. Verify after implementation.

### Recommended Fix
```css
/* All three grid containers */
display: grid;
grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
gap: 16px;   /* unify — currently 8 on list, 16 on detail/assets */
```

Card internals must use `width: 100%` rather than any hardcoded pixel width. All existing overlays already use `inset: 0` or percentage widths, so they adapt automatically.

### How the Fix Resolves the Issue
`minmax(240px, 1fr)` tells the browser: "each column is at least 240px, but grow to share available space equally." On a 1440px display you get roughly 5 columns of ~272px. On a 768px tablet you get 3 columns. On a 375px phone you get 1 full-width column with zero overflow. Columns always fill the row — no dead gutters.

### Downstream Consequences
- **Loading skeleton** (`catalogues/loading.tsx`): the `w` prop on `CardGridSkeleton` must also be removed and replaced with a `100%` width skeleton, otherwise the skeleton will be narrower than the loaded card causing CLS.
- **Ties to F2**: once cards are fluid-width, the image container must use `aspect-ratio` rather than a fixed `height`, or cards will collapse to zero height. F1 and F2 must be fixed together.
- **Performance**: fewer fixed-size paint layers — the browser can use a single stacking context for the grid rather than individually compositing fixed-pixel tiles.

---

## F2 — `object-fit: contain` produces grey letterbox (should be `cover`)

### Root Cause
All card `<img>` elements use `object-fit: contain`. Generated try-on images are portrait (typically 3:4 or 4:5 from the ComfyUI pipeline). Card containers are roughly square (370×352 usable area). `contain` scales the portrait image to fit inside the square box, leaving grey bars on both sides. Neither the container nor the image has an `aspect-ratio` set, so the box dimensions drive the crop rather than the content.

### Business Impact
This is the single highest-impact visual gap in the product. Fashion and e-commerce galleries universally use edge-to-edge `cover` crops to create a clean lookbook aesthetic. The letterbox makes the app look like a file browser rather than a premium AI catalogue tool. Users evaluating the product against category competitors will notice this immediately — it is the most visible signal of "unfinished."

### Technical Impact
- `contain` on the blurred garment background (the in-progress state in the detail page) also produces grey bars around the blurred image, making the loading state look broken rather than intentionally styled.
- The imperative hover scale (`transform: scale(1.05)`) on a `contain` image inside `overflow: hidden` clips the grey bars unevenly — visually jarring.
- The card `height` is hardcoded (376px on list, 316px on detail). When F1 is fixed and cards become fluid-width, a fixed height will produce distorted aspect ratios at narrow columns. `aspect-ratio` must replace fixed height to fix both bugs together.

### Affected Areas
- `catalogues/page.tsx` — cover `<img>` (around line 101)
- `catalogues/[id]/page.tsx` — result `<img>` in `ImageCard` (around line 235)
- `assets/page.tsx` — garment thumbnail `<img>` (around line 210)

### Risks Introduced by the Fix
**Cropping risk**: switching to `cover` means part of the image is clipped. For generated try-on images this is acceptable — the subject (garment on model) is always centred. For garment uploads (flat-lay product photos in the assets page), the garment may be off-centre and `cover` could clip it. Mitigation: use `object-position: top center` for try-on results (models are always anchored at the top), and consider offering a "fit / fill" toggle on the assets page where users may need to see the entire flat lay.

**No security or data integrity risk.**

### Recommended Fix
```css
/* Card image container — replaces fixed height */
aspect-ratio: 3/4;
overflow: hidden;
position: relative;

/* <img> inside the container */
width: 100%;
height: 100%;
object-fit: cover;
object-position: top center;   /* anchors to model's head, not garment mid */
loading: lazy;                  /* ties to F11 */
```

Remove fixed `height` from all card containers. Let `aspect-ratio: 3/4` drive the height. This also automatically makes card height responsive to column width (the F1 fix).

### How the Fix Resolves the Issue
`cover` fills the frame edge-to-edge. Every card is identically shaped regardless of column width. The grid reads as a proper lookbook — uniform portrait tiles — rather than mismatched letterboxed boxes.

### Downstream Consequences
- **Loading skeleton**: must add `aspect-ratio: 3/4` and remove fixed `h` prop, or skeleton heights will not match cards.
- **In-progress blur background**: the garment background image in the detail card also uses `object-fit: contain`. Switch to `cover` there too so the blur fills the entire card rather than showing grey bars.
- **Generation panel preview**: the `garmentPreviewUrl` blurred background in `GenerationPanel` uses the same pattern. Apply `cover` there for visual consistency.
- **Performance**: `cover` with `aspect-ratio` avoids layout reflow caused by browser computing image dimensions post-load. Combined with F11 (`width`/`height` attributes), this eliminates image-level CLS entirely.

---

## F3 — No resting card surface (flat, low-contrast gallery)

### Root Cause
There is no wrapping "card" element. The image area (`borderRadius: 8`) and the metadata row beneath it sit directly on the page background (`#fbfbfb`). A box shadow is applied only on hover via imperative JavaScript in `onMouseOver`. The placeholder grey (`#eeeeee`) sitting on page grey (`#fbfbfb`) has a luminance difference of approximately 6% — nearly invisible, especially on glossy displays.

### Business Impact
The gallery reads as a flat list of images rather than a product catalogue. Premium competitors use a distinct card surface (border or resting shadow, 12–16px radius) to create visual separation and imply clickability at rest. Without a resting surface, the hover state is the *only* signal that cards are interactive — users on touch devices (no hover), keyboard users, and low-bandwidth users who don't move a mouse will not discover actions. This directly affects conversion on any trial or demo.

### Technical Impact
- No card wrapper means there is no stable element to attach CSS `:hover` to, which forces the imperative DOM approach (F7).
- Without visual separation, the page fails in dark mode even with correct token colours — the card cannot be distinguished from the background.
- The absence of a card wrapper makes F8 (geometry inconsistency) harder to fix because each page lays out image + metadata independently with ad-hoc margins.

### Affected Areas
All three card grids. Directly entangled with F7 (imperative hover) and F8 (geometry drift) — all three are resolved by the same `<ProductCard>` component.

### Risks Introduced by the Fix
Adding a card wrapper `<div>` with border and radius changes the outer geometry of each card slightly (1px border on each side = 2px narrower interior). Any component that calculates grid column width by reading card DOM dimensions (none currently do this) would need updating. The selection ring (currently an `outline` on the image element) needs to move to the card wrapper element.

### Recommended Fix
```jsx
// Shared card wrapper styles
{
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  overflow: 'hidden',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',    // resting
  transition: 'box-shadow 0.15s ease',
}

// Hover — CSS class, not JS (ties to F7)
// .card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.12); }

// Selected state
// .card[data-selected="true"] { box-shadow: 0 0 0 2px C.pink; }
```

### How the Fix Resolves the Issue
The card is visually distinct from the page background at rest — users immediately understand it is a clickable unit. The hover elevation enhances an already-visible surface rather than being the only visible state. Touch users see the card boundary. Dark mode works automatically via `C.card` and `C.border` tokens which switch to dark values.

### Downstream Consequences
- **Selection ring**: the `outline: 2px solid C.pink` on the image must move to the card wrapper. This is a 2-line change.
- **Radius**: increasing from `8` to `14` on the card wrapper with `overflow: hidden` means child elements (image, action buttons near the corner) get clipped by the new radius. Verify that corner-positioned action buttons have enough inset padding.
- **Dark mode**: `C.card` in dark mode is a dark surface; `C.border` is a subtle dark border. The combination of F3 + F4 (token cleanup) is required for correct dark-mode appearance.

---

## F4 — Dark mode broken (hardcoded hex instead of tokens)

### Root Cause
The project has a complete dark palette in `globals.css` (lines 29–44) exposed as CSS custom properties (`--c-bg`, `--c-card`, `--c-text`, etc.), and a typed `C` token map in `apps/web/src/components/tokens.ts` that maps to those variables. The card pages were built with hardcoded hex strings in inline `style` props throughout — `#FEFEFE`, `#EEEEEE`, `rgba(255,255,255,0.97)`, `#141414`, `#626262`, `#F9F9F9`. Inline `style` props in React do not respond to CSS custom property changes triggered by `prefers-color-scheme: dark`. When the OS switches to dark mode, the CSS variables update but the inline styles are static values that ignore them entirely.

### Business Impact
Any user on macOS, iOS, or Windows in system dark mode sees the toolbar, filter buttons, dropdown menus, and search field rendered as white boxes on a dark page — fully unusable. This is not an aesthetic issue; it is a functional regression. Dark mode is enabled by default on a significant portion of devices (Apple estimates >80% of iPhone users use dark mode). For a B2B SaaS tool, this can cause a support escalation or churn on first use.

### Technical Impact
Specific broken elements by file:

**`catalogues/page.tsx`:**
- Toolbar: `background: 'rgba(255,255,255,0.97)'`, `boxShadow: '0 1px 0 #EEEEEE'` → white bar on dark background
- Filter buttons: `background: '#FEFEFE'` (default), `background: '#EEEEEE'` (active) → white buttons on dark background
- Search input: `background: '#F9F9F9'`, `border: '1px solid #EEEEEE'` → white input
- Dropdown menus: `background: '#FEFEFE'` → white dropdown
- Pagination: hardcoded `#141414`/`#FEFEFE` that inverts incorrectly in dark mode
- Download progress bar: `rgba(245,92,122,…)` instead of `C.pink`
- Gradient on bulk download button: `linear-gradient(90deg, #F55C7A, #F6B553)` — differs from the token's `135deg` angle, creating an inconsistent gradient direction

**`catalogues/[id]/page.tsx`:**
- Action bar: `background: '#EEEEEE'` for status badges
- Card overlay texts: `#141414`, `#626262` hardcoded
- Progress ring background: hardcoded stroke colour
- Gradient on download/action buttons: `linear-gradient(90deg,#F55C7A,#F6B553)`

**`assets/page.tsx`:**
- Search and sort controls: hardcoded light backgrounds

### Affected Areas
`catalogues/page.tsx` (toolbar, filters, sort dropdown, search, pagination, download bar, card action strip), `assets/page.tsx` (search, sort), `catalogues/[id]/page.tsx` (action bar, status indicators, card overlays). Dozens of individual occurrences across all three files.

### Risks Introduced by the Fix
Pure mechanical substitution — no logic changes. Risk is low but surface area is large. A missed instance will be immediately obvious in dark mode browser testing.

The gradient angle inconsistency (`90deg` vs token `135deg`) is a design decision, not just a bug. Align to a single standard: either always use the `grad` CSS custom property (which is `135deg`) for all gradient surfaces, or define a separate `gradH` token for horizontal-layout buttons that use `90deg`. Leaving two angles in production creates inconsistent brand identity.

### Recommended Fix
Global token replacement mapping:

| Hardcoded value | Replace with |
|---|---|
| `'#FEFEFE'`, `'#ffffff'` | `C.bg` or `C.card` depending on context |
| `'rgba(255,255,255,0.97)'` | `C.bg` |
| `'#F9F9F9'` | `C.field` |
| `'#141414'` | `C.text` |
| `'#626262'` | `C.mid` |
| `'#939393'` | `C.light` |
| `'#EEEEEE'`, `'#e8e8e8'` | `C.border` or `C.lighter` |
| `'rgba(245,92,122,…)'` | `C.pink` with CSS `opacity` |
| `linear-gradient(90deg,#F55C7A,#F6B553)` | `grad` token or define `gradH` constant |
| `boxShadow: '0 1px 0 #EEEEEE'` | `boxShadow: \`0 1px 0 ${C.border}\`` |

### How the Fix Resolves the Issue
CSS custom properties (`var(--c-bg)`) re-evaluate whenever the `prefers-color-scheme` media query fires. By routing all colour values through tokens, every element that uses `C.bg` automatically gets `#fbfbfb` in light mode and `#1a1a1a` (or whatever the dark token is) in dark mode, with no additional code.

### Downstream Consequences
- **Token system invariant**: CLAUDE.md already mandates "never use raw hex — always use tokens." This fix brings the three pages into compliance. Future additions written by any developer will see working dark mode immediately if they follow the pattern.
- **Gradient consistency**: standardising the gradient angle (`135deg` via `grad` token) means the brand gradient looks identical on buttons, cards, and marketing copy — important for white-label scenarios.
- **No performance impact**: CSS custom properties are resolved by the browser's style engine at paint time, adding negligible overhead versus hardcoded values.
- **No data integrity or security impact.**

---

## F5 — Loading skeleton size mismatch (CLS on load) ✅ Fixed

### Root Cause
`catalogues/loading.tsx` was written with `CardGridSkeleton count={9} w={300} h={300}`. Real catalogue cards are `370×376`. The skeleton was likely copy-pasted before card dimensions were finalised and was never updated. The assets page skeleton correctly uses `370×376` — only the catalogues skeleton was wrong.

Additionally, the catalogues page has an inline centered-spinner loading branch that renders while `isLoading` is true. This competes with the route-level skeleton (Next.js `loading.tsx`), creating two different loading treatments for the same page — the route skeleton appears on hard navigation, the inline spinner appears on client-side data refetch.

### Business Impact
Every authenticated page load shows a brief layout shift (CLS) as the 300×300 skeletons are replaced by 370×376 cards. Google's Core Web Vitals penalises CLS scores below 0.1. For a product that uses share links or relies on organic search landing pages, degraded CWV scores directly affect ranking and perceived quality. Additionally, the mismatched skeleton breaks the visual promise of a skeleton screen — the point of skeleton loading is to prevent jarring layout change, which it fails to do here.

### Fix Applied
Changed `CardGridSkeleton count={9} w={300} h={300}` → `CardGridSkeleton count={9} w={370} h={376}` in `catalogues/loading.tsx`. Skeletons now match actual card dimensions exactly, eliminating CLS on initial navigation.

### Remaining Issue (not yet fixed)
The inline `isLoading` spinner branch inside the page component should be removed and replaced by relying solely on the route-level `loading.tsx` skeleton. Having two loading states means the skeleton appears on hard navigation but a bare spinner appears on React Query refetches, creating an inconsistent experience.

### Downstream Consequences
- **When F1 and F2 are fixed** (fluid grid + `aspect-ratio`): the skeleton's fixed `w`/`h` props will again cause CLS because the skeleton has a fixed size but cards will be fluid. The skeleton component itself should be updated to use `aspect-ratio: 3/4` and `width: 100%` instead of fixed pixel dimensions. This is a second-pass fix once F1/F2 are implemented.
- **No security, data integrity, or performance regression.**

---

## F6 — Accessibility gaps across card grids

### Root Cause
The selection checkbox, hover states, and dialog semantics were all implemented with mouse-first JavaScript patterns rather than native HTML semantics and ARIA. This is a common pattern in rapidly-prototyped UI that never received an accessibility pass.

### Business Impact
Enterprise buyers (fashion brands, agencies, retail groups) operating in regulated markets (EU Accessibility Directive, US Section 508, ADA) are increasingly required to meet WCAG 2.1 AA. An inaccessible product can be blocked by procurement, flagged in security/compliance audits, or create legal exposure. More immediately: keyboard-only power users (common in B2B) cannot use bulk selection, bulk download, or the lightbox — these are core product workflows.

### Technical Impact — Per Gap

#### Gap 1: `<div onClick>` selection checkbox
**Location:** `catalogues/page.tsx` around line 1416

A `<div>` with an `onClick` handler:
- Is not in the tab order (not keyboard reachable)
- Has no `role="checkbox"` so screen readers announce nothing
- Has no `aria-checked` state so selection state is invisible to assistive technology
- Is not activatable via `Space` or `Enter` keys

**Fix:** Replace with a visually-hidden `<input type="checkbox">` or a `<button role="checkbox" aria-checked={isSelected}>`. The existing shift-range and Ctrl+A logic is attached to the parent grid's `onKeyDown` handler and click handler — it remains unchanged. Only the checkbox element itself needs replacing.

#### Gap 2: Empty `alt` on product images
**Location:** `catalogues/page.tsx` line 100, `assets/page.tsx` line 206

Generated product images are the primary content of these pages. `alt=""` marks them as decorative, which they are not. Screen reader users get no information about what the card contains.

**Fix:** Use descriptive alt text:
```jsx
alt={`Generated look ${idx + 1} — ${cat.genderSlug ?? 'product'}`}   // catalogue list
alt={`Try-on result for job ${job.id.slice(0, 8)}`}                    // detail card
alt={`Uploaded garment — ${asset.r2Key?.split('/').pop() ?? ''}`}      // assets
```

#### Gap 3: Missing `aria-modal` on assets lightbox
**Location:** `assets/page.tsx` around line 263

The detail page lightbox correctly uses `role="dialog" aria-modal="true"`. The assets lightbox uses only `role="dialog"` without `aria-modal`. Without `aria-modal`, screen readers continue reading background content as if the dialog is not modal — users cannot tell they are inside an overlay.

**Fix:** Add `aria-modal="true"` to the assets lightbox wrapper.

#### Gap 4: No focus trap in either lightbox
**Location:** Both lightbox implementations

When a lightbox opens, focus moves to the dialog container but `Tab` continues to cycle through background page elements. Users can inadvertently interact with obscured content. When the lightbox closes, focus is not restored to the element that triggered the open.

**Fix:** Implement a focus trap effect:
```js
useEffect(() => {
  if (!open) return;
  const focusable = dialogRef.current?.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable?.[0];
  const last = focusable?.[focusable.length - 1];
  const trap = (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
      e.preventDefault();
      (e.shiftKey ? last : first)?.focus();
    }
  };
  document.addEventListener('keydown', trap);
  first?.focus();
  return () => document.removeEventListener('keydown', trap);
}, [open]);
```
On close, restore focus: `triggerRef.current?.focus()`.

#### Gap 5: `--c-light` contrast failure
**Location:** `globals.css`

`--c-light: #939393` on `--c-bg: #fbfbfb` = 2.9:1 contrast ratio. WCAG AA requires 4.5:1 for text smaller than 18pt (which all secondary text here is). This affects empty state labels, secondary metadata, and any text using `C.light`.

**Fix:** Darken `--c-light` to `#767676` (achieves 4.54:1 on `#fbfbfb`). Recalculate for dark mode too — `#767676` on the dark background may need a separate adjustment.

### Risks Introduced by the Fix
- **Checkbox replacement**: replacing a `<div>` with a `<button>` or `<input>` can slightly affect layout if the element has display differences. Use CSS to normalise (`appearance: none; position: absolute; opacity: 0` for a hidden input overlay). No logic changes.
- **Alt text**: purely additive. No performance or functional impact.
- **`aria-modal`**: purely additive attribute. No visual or functional change.
- **Focus trap**: the most complex fix. Must handle dynamic content (new images appearing in lightbox while open), `Escape` key to close (already handled), and the edge case where no focusable elements exist inside the dialog.
- **Contrast change**: `#767676` is visibly darker than `#939393`. All secondary text across the entire app (not just card pages) will darken slightly. Review every use of `C.light` to confirm none depend on the lighter shade for intentional fading effects.

### Downstream Consequences
- **Procurement**: achieving WCAG 2.1 AA compliance (or making meaningful progress toward it) opens the product to enterprise clients with accessibility requirements.
- **Bundle size**: a custom focus trap adds ~0.5KB of code. If `focus-trap-react` is used instead, it adds ~3KB gzipped.
- **Testing**: existing E2E tests that click the checkbox `<div>` by CSS selector will need updating to target the new element. Unit tests for selection logic are unaffected (logic doesn't change).

---

## F7 — Imperative `querySelector` hover (fragile, bypasses React)

### Root Cause
Hover scale and shadow are applied by mutating DOM style properties directly inside `onMouseOver`/`onMouseOut` event handlers:

```js
// catalogues/page.tsx ~line 1395
onMouseOver={(e) => {
  e.currentTarget.querySelector('[data-scale]').style.transform = 'scale(1.05)';
  e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)';
}}
```

This pattern was likely used to avoid React re-renders on every hover enter/exit (a valid micro-optimisation concern), but the approach introduces more problems than it solves.

### Business Impact
Low direct user impact today — the hover effect works on mouse. High maintenance risk for the engineering team. Any developer restructuring card JSX will silently break hover without a TypeScript or lint error. The effect has already drifted between pages (assets adds an `onFocus` shadow but not the scale; catalogues has no `onFocus` at all), meaning keyboard users have a different and degraded experience compared to mouse users.

### Technical Impact
1. **String fragility**: `querySelector('[data-scale]')` relies on a `data-scale` attribute on a specific child element. Renaming or restructuring JSX silently removes the effect — TypeScript cannot catch this.
2. **Inconsistent with F2**: scaling a `contain` image inside `overflow: hidden` clips the grey bars on both sides unevenly at the scaled border, looking broken.
3. **`onMouseOver` bubbles**: fires on every descendant element's mouse-over, not just the card's direct hover. Rapidly moving the mouse between nested child buttons (delete, download) triggers the handler repeatedly, causing potential flicker on low-end devices.
4. **Split source of truth**: imperative style mutations bypass React's virtual DOM. If a re-render resets `style.transform` to its original value while the mouse is still hovering, the effect disappears until the next mouse move.
5. **No `onFocus`/`onBlur` equivalent on catalogues page**: keyboard users navigating with Tab get no visual hover feedback, making the card look non-interactive.

### Affected Areas
- `catalogues/page.tsx` lines 1395–1412 (hover scale + shadow)
- `assets/page.tsx` lines 179–194 (hover scale + shadow; partial `onFocus`)

### Risks Introduced by the Fix
Minimal. Moving hover to CSS eliminates all of the above problems. CSS `:hover` is handled by the browser's style engine — no JS execution, no re-renders, no fragility.

One edge case: CSS `:hover` on a parent applies to all descendants, including nested `<button>` elements. If hovering a nested action button (delete, download) should *not* trigger the card image scale, the `transition` / `transform` must be scoped to the image element with the parent `:hover` selector:

```css
.card:hover .card-image { transform: scale(1.03); }
```

Action buttons inside the card use `position: absolute` and have their own hover styles — these are unaffected.

### Recommended Fix
```css
/* In a <style jsx> block or CSS module */
.card { transition: box-shadow 0.15s ease; }
.card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.12); }
.card:hover .card-image { transform: scale(1.03); transition: transform 0.2s ease; }
.card:focus-visible { outline: 2px solid var(--c-pink); outline-offset: 2px; }
```

Remove all `onMouseOver`, `onMouseOut`, `querySelector`, and direct `style` mutations from both files. Remove the `data-scale` attribute.

### How the Fix Resolves the Issue
CSS hover is declarative, browser-native, and zero-cost to render (no JS execution, no React re-render). It cannot be accidentally broken by JSX restructuring. The `transition` property on the card wrapper provides the same smooth animation. `focus-visible` gives keyboard users the same elevated state that mouse users get on hover.

### Downstream Consequences
- **Re-render cost eliminated**: the current pattern fires JS on every `onMouseOver` event (including child bubbles). CSS hover produces zero JS overhead.
- **Ties to F3**: CSS hover on a card wrapper (F3's fix) is the prerequisite for this fix — the wrapper is the stable element the CSS selector attaches to.
- **Test compatibility**: any Playwright/Cypress tests using `hover()` to trigger the hover effect will continue to work unchanged, since CSS `:hover` responds to the same pointer events.

---

## F8 — Inconsistent card geometry across three pages

### Root Cause
Each page was built independently with its own hardcoded dimensions. No shared `<ProductCard>` component was ever created. Over multiple iterations the three surfaces drifted:

| Property | Catalogues list | Catalogue detail | Assets |
|---|---|---|---|
| Card height | 376px | 316px | 376px |
| Grid gap | 8px | 16px | 16px |
| Grid track | 370px | 369.33px | 370px |
| Image radius | 8 | 8 | 8 |
| Meta row height | 16 | 28 | 16 |

The `316px` on the detail page was a one-time adjustment never propagated back. The gap difference (`8` vs `16`) is unexplained. The `369.33px` track is `container / 3` from a specific viewport snapshot.

### Business Impact
The same conceptual object — "an image card" — looks and feels different on every page. Users who navigate Catalogues → Catalogue Detail → Your Products experience jarring layout discontinuity. This erodes trust in the product's overall polish, particularly for design-sensitive buyers in the fashion industry.

### Technical Impact
Three separate implementations of the same component mean:
- Any visual update (hover, selection ring, status badge) must be applied in three separate files.
- Bug fixes apply inconsistently — the per-card download button fix (BUG 3.2) had to be applied in two places.
- Differing heights cause the catalogue detail page to show more cards vertically than the list page, even though they render the same data — this feels like a bug to users.

### Risks Introduced by the Fix
Centralising into a shared `<ProductCard>` component is a refactor touching three large files. Each page has page-specific interactive state (selection mode in catalogues list, deletion in detail, lightbox in assets). These must be passed as props rather than read from closures.

**Risk mitigation strategy**: keep page-specific logic entirely in the page component. `<ProductCard>` accepts render-prop callbacks (`onSelect`, `onDelete`, `onZoom`, `onDownload`) and a `selected` boolean. It renders no interactive controls directly — those are slots filled by the parent. This keeps the component purely presentational and easy to test.

### Recommended Fix
Create `apps/web/src/components/product-card.tsx`:

```tsx
interface ProductCardProps {
  imageUrl: string | null;
  imageAlt: string;
  aspectRatio?: '3/4' | '4/5' | '1/1';
  selected?: boolean;
  actions?: React.ReactNode;     // zoom, download, delete buttons
  footer?: React.ReactNode;      // status badge, title, count
  onClick?: () => void;
}
```

Adopt these unified geometry tokens:
- `aspect-ratio: 3/4` (replaces fixed heights)
- `border-radius: 14px`
- `gap: 16px` (all three grids)
- `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`

### How the Fix Resolves the Issue
A single source of truth means any visual change (a new shadow, a changed radius, a status badge position) is made once and propagates to all three pages. The card looks identical everywhere in the app.

### Downstream Consequences
- **Bundle size**: likely *smaller* — the three implementations together contain much duplicated code. A shared component eliminates that duplication.
- **Loading skeleton**: one `<ProductCardSkeleton>` component replaces three separate skeleton configurations.
- **Testing**: one set of card unit tests covers all three surfaces. Currently there are no card-level unit tests — this is an opportunity to add them.
- **Future cards**: any new page that shows image cards (e.g. a shared catalogue view, an admin results page) automatically gets the correct look by using `<ProductCard>`.

---

## F9 — Card metadata is developer-facing (UUID prefix, no status badge)

### Root Cause
The meta row was implemented during early development as a debugging aid (`#${id.slice(0,8)}`). No design decision was made about what human-readable information to show, and it was never revisited.

### Business Impact
Users cannot identify a catalogue by glancing at the card. They must click into each one to understand its contents. For users with many catalogues (fashion agencies running multiple brand clients), this is a serious navigation friction point. The status of each catalogue (how many looks are ready) is buried inside — not visible at a glance. Users may not know a catalogue finished generating without clicking in.

### Technical Impact
- `#id.slice(0,8)` truncates a UUID — meaningless to users, visually takes up the same space as a real title.
- No status badge means the in-progress/failed state is only visible if the cover image happens to be a non-completed job. A catalogue where all but one job is COMPLETED shows a completed cover image with no indication that one look failed.
- Without a date, users cannot sort by recency without relying on the list order.

### Affected Areas
- `catalogues/page.tsx` meta row (around line 1486–1502)
- `assets/page.tsx` meta row (around line 229–254)
- `catalogues/[id]/page.tsx` card action row (around line 359–370)

### Recommended Fix — No Schema Migration (immediate)
The following are derivable from existing data with no API changes:

| Field | Source |
|---|---|
| Date | `createdAt` of the oldest job in the catalogue, formatted "Jun 18" |
| Status badge | Derived from job statuses: all COMPLETED → "Ready" (green); any GENERATING/QUEUED → "In Progress" (amber); any FAILED → "Failed" (red); mixed COMPLETED+FAILED → "Partial" (orange) |
| Count | `jobs.length` — already shown |
| Platform | `params.platform` — already fetched in the `/v1/catalogues` grouping query |

### Recommended Fix — With Schema Migration (future)
Add a `name` column (`VARCHAR(100)`) to the jobs table (the catalogue is virtual — it has no own row), stored on the first job of each catalogue. Expose `PATCH /v1/catalogues/:id/name` endpoint. Add inline-edit UI on the card title. This is a separate milestone — the no-migration fixes above deliver immediate value.

### How the Fix Resolves the Issue
Status badges surface the most important information (is this catalogue done?) without requiring a click. Date and platform let users identify catalogues by context. Together these reduce the "click-in to understand" loop to "glance and understand."

### Downstream Consequences
- **Status badge computation**: runs client-side on the existing `jobs` array. No API change, no performance impact.
- **`name` column (if added)**: requires a Drizzle migration, a new API route, and inline-edit UI. Low risk — nullable column with no existing rows defaults cleanly.
- **Card height**: adding a richer footer may require more vertical space in the meta row. Coordinate with F3/F8 (unified `<ProductCard>`) to ensure the footer area is sized to accommodate status badge + title + date in one pass.

---

## F10 — Emoji placeholder for missing garment image

### Root Cause
The `👗` emoji at `fontSize: 40, opacity: 0.4` was added as a quick placeholder during early development of the assets page. It was never replaced with a proper branded placeholder.

### Business Impact
Emoji render significantly differently across operating systems:
- **Apple (macOS/iOS)**: colourful, detailed fashion illustration
- **Android**: flat colour outline (Google's design language)
- **Windows**: flat monochrome outline
- **Linux**: system font fallback, often a box or question mark

For a B2B tool targeting fashion brands — an industry with high sensitivity to visual consistency and brand identity — an OS-dependent emoji in the product UI reads as unfinished or careless. Any white-label scenario (where a fashion brand hosts the tool under their own brand) would flag this immediately.

### Technical Impact
Minimal. The emoji is wrapped in a `<div>` with flex centering. Replacing it is a 3-line change. No logic, state, or layout is affected.

### Risks Introduced by the Fix
None. A branded SVG icon is platform-independent, scales to any DPI, supports dark mode via `fill: currentColor`, and has zero runtime cost.

### Recommended Fix
Replace the emoji `<div>` with an SVG icon from the existing icon set — a hanger, garment outline, or image placeholder icon:

```jsx
// Before
<div style={{ fontSize: 40, opacity: 0.4 }}>👗</div>

// After
<div style={{ opacity: 0.3, color: C.mid }}>
  <GarmentIcon size={40} />   {/* or ImagePlaceholderIcon */}
</div>
```

If no suitable icon exists in the current set (`apps/web/src/components/icons.tsx`), add a simple SVG garment outline — approximately 8–10 lines of SVG path data.

### Downstream Consequences
- **Dark mode**: `fill: currentColor` (or `color: C.mid`) means the icon automatically adapts to dark mode without any additional CSS. The emoji did not.
- **Brand consistency**: any future empty state (empty catalogue, no results) can reuse the same icon pattern.

---

## F11 — Missing `loading="lazy"` and intrinsic image dimensions

### Root Cause
Card `<img>` elements intentionally use plain `<img>` rather than `next/image` because Next.js's image optimiser cannot proxy presigned external URLs (S3/R2 with time-limited tokens). When this decision was made, `loading="lazy"` and `width`/`height` attributes were not added — they are standard HTML attributes that do not require Next.js image handling.

### Business Impact
- **Slow initial load**: on a 20-image catalogue page, all 20 presigned R2 images are fetched simultaneously on page load, including those below the fold the user may never scroll to. On a mobile connection (4G with latency) this can add 2–5 seconds to time-to-interactive for above-the-fold content.
- **CLS contribution**: without `width`/`height`, the browser cannot reserve space for images before they load. Even after the skeleton fix (F5), individual image CLS within loaded cards still occurs as each image fetches and renders.

### Technical Impact
- `loading="lazy"`: a browser-native hint that defers fetching images until they are within a threshold distance of the viewport (typically 1–2 viewport heights). Broadly supported (>96% of browsers). No JavaScript required.
- `width`/`height` attributes: when set, the browser computes `aspect-ratio: width / height` before the image loads and reserves the correct space, eliminating layout shift. These values are ignored for actual rendered dimensions if CSS overrides them (e.g. `width: 100%; height: 100%`) — they serve only as the intrinsic-size hint.
- **Images above the fold**: `loading="lazy"` should *not* be applied to images that are in the viewport on initial load (the first 2–3 cards). Apply `loading="eager"` (or omit the attribute) for visible cards and `loading="lazy"` for the rest. This optimises LCP for above-the-fold content while deferring off-screen fetches.

### Affected Areas
- `catalogues/page.tsx` — cover `<img>` (around line 99)
- `catalogues/[id]/page.tsx` — result `<img>` in `ImageCard` (around line 229)
- `assets/page.tsx` — garment thumbnail `<img>` (around line 203)
- `generation-panel.tsx` — result and thumbnail strip `<img>` elements

### Risks Introduced by the Fix
- **`loading="lazy"` on near-viewport images**: if applied to an image just below the visible fold, there may be a brief moment where the user sees a blank card before the image fetches. The browser's intersection-margin threshold (usually `rootMargin: "200px"`) means this rarely happens in practice. Mitigate by applying `loading="eager"` to the first card in each grid (index 0).
- **`width`/`height` with CSS override**: setting `width={768} height={1024}` on an image rendered at `width: 100%; height: 100%` is safe — the CSS takes precedence for layout, and the attributes only inform the browser's pre-layout CLS calculation.

### Recommended Fix
```jsx
<img
  src={displayUrl}
  alt={alt}
  width={768}
  height={1024}
  loading={idx === 0 ? 'eager' : 'lazy'}
  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
/>
```

### How the Fix Resolves the Issue
- `loading="lazy"` defers off-screen image fetches until they are near the viewport. On a 20-image page this reduces initial page byte weight by 60–70% of image data for users who don't scroll.
- `width`/`height` allows the browser to paint the card at its correct size before the image arrives, eliminating image-level CLS entirely.

### Downstream Consequences
- **Core Web Vitals**: combined with F5 (skeleton CLS fix) and F2 (aspect-ratio), these three fixes together can bring CLS close to 0 and meaningfully improve LCP for above-the-fold images.
- **R2 egress cost**: lazy loading reduces unnecessary R2 bandwidth for images the user never scrolls to — a cost saving at scale.
- **No security or data integrity impact.**

---

## Cross-Cutting Impact Summary

| Concern | F1 | F2 | F3 | F4 | F5 | F6 | F7 | F8 | F9 | F10 | F11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Performance** | ✓ | ✓ | | | ✓ | | ✓ | | | | ✓ |
| **Dark mode** | | | ✓ | ✓ | | | | | | ✓ | |
| **Maintenance** | | | ✓ | ✓ | | | ✓ | ✓ | | ✓ | |
| **Accessibility** | | | | | | ✓ | ✓ | | | | |
| **Core Web Vitals** | | ✓ | | | ✓ | | | | | | ✓ |
| **Brand / UX polish** | ✓ | ✓ | ✓ | | | | | ✓ | ✓ | ✓ | |
| **Schema migration required** | | | | | | | | | F9 name only | | |
| **New dependencies** | | | | | | focus-trap (F6) | | | | | |

### Recommended Implementation Order

1. **F5** (skeleton) + **F4** (token cleanup) — mechanical, removes obvious functional breakage, zero visual regression risk.
2. **F11** (lazy loading + dimensions) — 3-line change per image, immediate LCP/CLS improvement.
3. **F1** (responsive grid) — `minmax` change in 3 files, fixes mobile overflow.
4. **F2** (cover + aspect-ratio) — must follow F1; together they are the biggest visual upgrade.
5. **F3 + F7 + F8** (card surface + CSS hover + unified `<ProductCard>`) — single refactor pass that resolves all three; F3 and F7 require F8's wrapper element.
6. **F6** (accessibility) — checkbox, alt text, focus trap; most complex, can be parallelised with step 5.
7. **F9 + F10** (status badge, branded placeholder) — polish pass after the structural work is done.
