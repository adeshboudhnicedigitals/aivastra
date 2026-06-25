# Premium Dark Mode for Merchant Dashboard

## Goal
Implement a proper, premium dark mode for the `apps/admin` merchant dashboard that:
- applies to the entire authenticated application,
- uses no hardcoded colors,
- supports Light / Dark / System modes with System as the default,
- persists per-admin across devices,
- provides a smooth animated transition when toggling,
- leaves the public login page in its current light/neutral state.

## Context
The admin dashboard already has a basic dark mode (`data-theme="dark"` in `tokens.css`, a theme toggle in Settings, and localStorage persistence in `App.tsx`). This design upgrades that foundation into a maintainable, premium implementation.

## Decisions

### Aesthetic direction
- **Warm Charcoal** premium dark palette.
- Brown-grey dark surfaces, saffron-gold accent, desaturated semantic colors.
- Avoid pure black; use layered elevation for depth.
- **Accent note:** The current admin dashboard already uses a saffron/orange accent in `tokens.css` (`oklch(0.68 0.15 55)`). This design preserves that admin-specific accent. Switching the admin accent to the web app's purple/pink brand would be a separate branding decision and is out of scope unless requested.

### Theme options
- **Light**, **Dark**, and **System**.
- Default is **System**.
- `System` resolves to the OS `prefers-color-scheme` value.

### Toggle placement
- **Topbar**: quick sun/moon/system icon button on every page.
- **Settings > Appearance**: segmented Light / Dark / System selector.

### Persistence
- Save immediately to `localStorage` (`aivastra-theme`).
- Save to the admin user account via `PATCH /admin/me/preferences`.
- On load: use server preference if present, else localStorage, else System.

### Architecture
- Introduce `ThemeProvider` in `apps/admin/src/context/ThemeContext.tsx`.
- Expose `useTheme()` hook.
- `App.tsx` consumes the hook instead of owning theme state.
- `tokens.css` remains the single source of truth for color tokens.

## Architecture

```
OS preference  ──┐
localStorage     ├──►  ThemeProvider  ──►  data-theme="light|dark" on <html>
/admin/me        ──┘         │
                               ▼
                         useTheme()
                               │
                    Topbar toggle
                    Settings selector
```

### `ThemeProvider` responsibilities
1. Read `localStorage.getItem('aivastra-theme')` on mount.
2. Fetch `/admin/me` and read `preferences.theme`.
3. Resolve effective mode:
   - server preference > localStorage > `'system'`.
   - If the stored value is `'system'` or invalid, resolve from `matchMedia('(prefers-color-scheme: dark)')`.
4. Write `data-theme` to `document.documentElement`.
5. Persist choice to `localStorage` immediately.
6. Debounce and `PATCH /admin/me/preferences` only when authenticated.
7. Listen to OS preference changes when in System mode.

### Auth coupling
- `AuthContext` exposes `isAuthenticated: boolean` (derived from `!!token`).
- `ThemeProvider` reads `isAuthenticated` from `useAuth()` and only calls `PATCH /admin/me/preferences` when `isAuthenticated` is true.
- If the user is logged out, theme changes still apply locally via `localStorage`; no server request is attempted.

### `useTheme()` API
```ts
interface UseTheme {
  theme: 'light' | 'dark' | 'system';
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleTheme: () => void;
}
```

## Token System

### Semantic tokens (kept, values refined)
- `--bg`
- `--surface`
- `--surface-2`
- `--surface-hover`
- `--border`
- `--border-strong`
- `--ink`
- `--ink-2`
- `--muted`
- `--muted-2`
- `--accent`
- `--accent-soft`
- `--accent-ink`
- `--success`, `--success-soft`, `--success-ink`, `--success-border`
- `--warn`, `--warn-soft`, `--warn-ink`, `--warn-border`
- `--danger`, `--danger-soft`, `--danger-ink`, `--danger-border`
- `--info`, `--info-soft`, `--info-ink`, `--info-border`
- `--sidebar-bg`, `--sidebar-bg-hover`, `--sidebar-border`, `--sidebar-text`, `--sidebar-text-active`, `--sidebar-text-muted`
- `--shadow-sm`, `--shadow-md`, `--shadow-lg`

### Warm Charcoal dark palette
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#181412` | App background |
| `--surface` | `#211d1a` | Cards, panels, topbar |
| `--surface-2` | `#25211e` | Hover states, secondary surfaces |
| `--surface-hover` | `#2b2622` | Hover elevation |
| `--border` | `#322e2a` | Dividers, input borders |
| `--border-strong` | `#3f3a34` | Focus/hover borders |
| `--ink` | `#f2efec` | Primary text |
| `--ink-2` | `#d8d3cd` | Secondary text |
| `--muted` | `#a39a93` | Tertiary text |
| `--muted-2` | `#7a736d` | Placeholders, disabled |
| `--accent` | `#d4a05f` | Saffron gold |
| `--accent-soft` | `#3d3222` | Accent backgrounds |
| `--accent-ink` | `#1a160f` | Text on accent |
| `--success` | `#7fd0a1` | Success |
| `--warn` | `#f5c876` | Warning |
| `--danger` | `#ff8a8a` | Danger |
| `--info` | `#8ab4f8` | Info |

### Global transition
Add a short transition on all theme-reactive properties:
```css
html {
  transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
}
```

## Component Changes

### New / changed files
- `apps/admin/src/context/ThemeContext.tsx` — new ThemeProvider + hook.
- `apps/admin/src/main.tsx` — wrap `<App />` with `<ThemeProvider>`.
- `apps/admin/src/App.tsx` — remove local theme state, consume `useTheme()`.
- `apps/admin/src/components/Topbar.tsx` — add theme toggle button.
- `apps/admin/src/pages/SettingsPage.tsx` — replace theme button with Light/Dark/System segmented control.
- `apps/admin/src/components/Switch.tsx` — fix a11y (`tabIndex`, keyboard handler).
- `apps/admin/src/styles/tokens.css` — refine palettes, remove hardcoded colors, add transition.
- `apps/admin/src/lib/data.ts` — add `patchAdminPreferences` helper.
- `apps/admin/index.html` — add a blocking inline script to set `data-theme` before React hydrates.

### First-paint anti-flash
Add a small inline `<script>` in `apps/admin/index.html` inside `<head>`:
```html
<script>
  (function () {
    const stored = localStorage.getItem('aivastra-theme');
    const theme = stored === 'light' || stored === 'dark' ? stored : 'system';
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
  })();
</script>
```
This prevents a flash of the wrong theme on hard reload before React mounts.

### Hardcoded colors to replace
- `.status-dot::before` — use `--bg` and `--success-soft`.
- `.role-pill` — use `--accent-ink`.
- `.inactive-overlay` — use `--surface` with alpha.
- `.imgpv-cap` — use `--ink` / `--bg`.
- `.nav-item.alert .count` — use `--bg`.
- `.brand-mark` — use `--accent-ink`.
- Inline `style={{ color: '#fff' }}` or similar in components.

## API / Backend Changes

### Schema
Add to `packages/db/src/schema/admin.ts`:
```ts
preferences: jsonb('preferences').$type<{ theme?: 'light' | 'dark' | 'system' }>().default({}),
```

### Migration
Run `pnpm db:generate` to produce the next migration (current highest is `0058`, so the generated file will be `0059_*` unless a parallel migration is added first).

### Routes (`apps/api/src/modules/admin/me.routes.ts`)
- `GET /admin/me` — include `preferences` in response.
- `PATCH /admin/me/preferences` — validate with Zod, update `admin_users.preferences`, return updated object.

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| System mode + OS changes | App updates automatically. |
| API save fails | UI keeps local choice; show toast; retry on next change. |
| Invalid localStorage value | Fall back to System. |
| First paint / flash | Inline script in `index.html` sets `data-theme` before React mounts. |
| Login page | Remains light/neutral; `ThemeProvider` only controls authenticated shell. |
| Logout | Clear in-memory theme; next login loads that admin's preference. |

## Testing

### Manual QA
- Topbar toggle cycles modes and updates icon.
- Settings selector syncs with topbar state.
- System mode reacts to OS changes.
- Refresh preserves theme via localStorage.
- Login/logout loads server-persisted theme.
- Spot-check Dashboard, Jobs, Assets, Settings, modals, drawers, toasts in dark mode.

### Static checks
- `pnpm --filter @aivastra/admin lint` passes.
- No literal hex colors outside CSS variable definitions in `tokens.css`.
- `pnpm build` passes for `apps/admin`.

## Out of Scope
- Theming for `apps/web` or `apps/admin-mobile`.
- Login page redesign.
- Additional accessibility themes (high-contrast, color-blind).
- Server-side rendering concerns (admin app is client-rendered Vite).

## Open Questions
- None remaining. All decisions validated with product owner.