# Admin-Mobile — Production Gaps Audit

**Date:** 2026-06-30  
**Audited by:** Antigravity  
**Scope:** `apps/admin-mobile` — all screens, hooks, stores, lib utilities, and build config  
**React Native / Expo version:** Expo ~53.0, RN 0.79.6, expo-router ~5.1

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 P0 — Blocker | 6 | Breaks production immediately; must fix before release |
| 🟠 P1 — High risk | 10 | Data loss, security, or reliability risk under normal use |
| 🟡 P2 — Medium | 11 | Quality, correctness, or UX degradation |
| 🔵 P3 — Low / polish | 9 | Nice-to-have improvements |

**Total: 36 findings.**

---

## 🔴 P0 — Blocks Production

### P0-1 · Hardcoded developer LAN IP in the `preview` EAS build

**File:** `apps/admin-mobile/eas.json` (lines 13–16)

```json
"preview": {
  "env": {
    "ADMIN_MOBILE_API_URL": "http://192.168.29.54:4000",
    "EXPO_PUBLIC_STORAGE_URL": "http://192.168.29.54:9000/virtual-tryon-dev"
  }
}
```

**Problem:** The `preview` build profile (used for distributing internal test APKs) hardcodes a developer's local LAN IP. Any device not on the same WiFi network as the developer machine gets a completely broken app — all API calls fail, all images fail to load.

**Fix:** Point `preview` at a real staging server URL. Treat it like a second production environment.

```json
"preview": {
  "env": {
    "APP_ENV": "staging",
    "ADMIN_MOBILE_API_URL": "https://staging.aivastra.com",
    "EXPO_PUBLIC_STORAGE_URL": "https://staging.aivastra.com/storage/virtual-tryon-dev"
  }
}
```

---

### P0-2 · Cleartext HTTP traffic enabled in preview (and any non-production) APKs

**File:** `apps/admin-mobile/app.config.js` (line 30)

```js
const IS_DEV = process.env.APP_ENV !== 'production';
// ...
android: {
  ...(IS_DEV && { usesCleartextTraffic: true }),
}
```

**Problem:** `IS_DEV` is true for anything that isn't `APP_ENV=production`. The EAS `preview` profile sets `APP_ENV=development`, so all distributed internal APKs allow cleartext HTTP. This is a **security violation** — network traffic is unencrypted on every test device. Android 9+ blocks cleartext by default for good reason.

**Fix:** Either use `APP_ENV=staging` for preview and only allow cleartext for local development (where the device is on-prem), or limit the cleartext domain allowlist to `127.0.0.1` / `localhost` only via a `network_security_config.xml`.

---

### P0-3 · Two separate sources of truth for the access token cause divergence after silent refresh

**Files:**
- `apps/admin-mobile/src/lib/api.ts` (lines 16–20, 60–68)
- `apps/admin-mobile/src/store/auth.ts` (lines 54–60, 88–94)
- `apps/admin-mobile/src/app/_layout.tsx` (lines 24–26)

**Problem:** The access token is stored in two places:
1. A module-level `let token` in `lib/api.ts`, updated by `setToken()` and `tryRefreshToken()`
2. `useAuthStore.token` in Zustand state

When `apiFetch` silently refreshes the token via `tryRefreshToken()`, it updates the module-level variable (`token = accessToken`) but **never calls `useAuthStore.setState({ token })`**. The Zustand store keeps the old token.

Consequences:
- `useSSE` reads `useAuthStore(state => state.token)` for its dependency — it never re-fires with the new token, so the SSE stream uses a stale/expired Bearer token
- Any component reading `token` from the store sees the pre-refresh value
- The `setApiToken` call in `_layout.tsx` only runs when the store's token changes — but the store's token never changes after a silent refresh

**Fix:** After a successful silent refresh, sync the result back to the auth store:

```ts
// In tryRefreshToken(), after token = accessToken:
const { useAuthStore } = await import('../store/auth');
useAuthStore.setState({ token: accessToken });
```

Or — better — store the token only in one place. Let `apiFetch` read from `useAuthStore.getState().token` directly instead of maintaining a separate module variable.

---

### P0-4 · `login()` doesn't call `setApiToken()` — first API calls after login fire with `null` token

**File:** `apps/admin-mobile/src/store/auth.ts` (lines 67–94)

**Problem:** After a successful login, `auth.ts` calls `set({ token: accessToken })`, which triggers the `useEffect` in `_layout.tsx` that calls `setApiToken(token)`. However, this `useEffect` fires **asynchronously** — on the next render cycle after the state update.

If navigation happens synchronously after login (Expo Router redirects immediately on token change), the newly-mounted screen's `useApi` hook fires `apiFetch` before the `useEffect` has run. At that point, `lib/api.ts`'s module-level `token` is still `null`, so the request goes out with no `Authorization` header and gets a 401.

**Fix:** Call `setApiToken(accessToken)` directly inside `login()` in `auth.ts`:

```ts
import { setToken as setApiToken } from '../lib/api';
// ...
login: async (email, password) => {
  // ...after successful login:
  setApiToken(accessToken);  // ← add this
  set({ token: accessToken, ... });
}
```

---

### P0-5 · `confirmAction` in `ConfirmDialog.ts` silently swallows all async errors

**File:** `apps/admin-mobile/src/components/ConfirmDialog.ts`

```ts
export function confirmAction({ ..., onConfirm }: ConfirmOptions) {
  Alert.alert(title, message, [
    { text: cancelLabel ?? 'Cancel', style: 'cancel' },
    {
      text: confirmLabel,
      style: destructive ? 'destructive' : 'default',
      onPress: () => void onConfirm(),  // ← error is silently dropped
    },
  ]);
}
```

**Problem:** `void onConfirm()` discards the returned promise. If `onConfirm` throws (e.g., a network error during a delete/ban/revoke), the error is swallowed — no toast, no alert, no user feedback. This affects every destructive action in the app:

- Ban user (`users/[id].tsx`)
- Delete user (`users/[id].tsx`)
- Revoke admin (`users/[id].tsx`)
- Delete credit plan (`settings.tsx`)
- Delete category (`backgrounds/index.tsx`, `catalog/index.tsx`)
- Delete workflow (`workflows/[id].tsx`)
- Restore from recycle bin (`recycle-bin.tsx`)

**Fix:**

```ts
onPress: async () => {
  try {
    await onConfirm();
  } catch (cause) {
    Alert.alert('Action failed', cause instanceof Error ? cause.message : 'Please try again.');
  }
},
```

---

### P0-6 · Widget client "Copy key" button is a complete no-op

**File:** `apps/admin-mobile/src/app/(tabs)/more/widget-clients/[id].tsx` (lines 55–60)

```tsx
function copyToClipboard(text: string) {
  Alert.alert('Widget Key', text, [
    { text: 'Copy', onPress: () => {} },  // ← does nothing
    { text: 'OK' },
  ]);
}
```

**Problem:** The "Copy" button in the Alert does nothing at all. `expo-clipboard` is already installed in `package.json` (and correctly used in `workflows/[id].tsx` to copy JSON), but was not wired up here.

**Fix:**

```ts
import * as Clipboard from 'expo-clipboard';

async function copyToClipboard(text: string) {
  await Clipboard.setStringAsync(text);
  useToastStore.getState().show('Widget key copied', 'success');
}
```

---

## 🟠 P1 — High Risk

### P1-1 · No logout triggered when 401 persists after refresh failure — app gets stuck

**Files:** `src/lib/api.ts` (lines 31–42), `src/app/_layout.tsx`

When `tryRefreshToken()` returns `null` (refresh token expired or invalid), `apiFetch` re-throws the original error. But the auth store is **not cleared**. The user stays on authenticated routes, all API calls continue to throw 401, screens show error states, and the only recovery is killing and re-opening the app.

**Fix:** After `tryRefreshToken()` returns null, trigger a full logout:

```ts
if (res.status === 401 && token) {
  const newToken = await tryRefreshToken();
  if (!newToken) {
    // Refresh failed — force logout
    const { useAuthStore } = await import('../store/auth');
    void useAuthStore.getState().logout();
    throw new ApiError(401, {});
  }
  // retry with newToken...
}
```

---

### P1-2 · Catalog bulk-delete serially loops individual DELETEs with silent partial failures

**File:** `src/app/(tabs)/more/catalog/index.tsx` (lines 141–162)

```ts
for (const id of ids) {
  try {
    await apiFetch(`/admin/catalog/items/${id}`, { method: 'DELETE' });
    deleted++;
  } catch {
    // continue — failure silently skipped
  }
}
useToastStore.getState().show(`${deleted} items deleted`, 'success');
```

**Problems:**
1. Partial failures are completely invisible to the user — they see "5 items deleted" when 3 actually failed
2. Serial await in a loop is slow for large selections
3. No rollback — items that did delete are gone, items that failed stay

**Fix:** Either use a batch delete endpoint (pass all IDs in one request body), or collect failures and display them:

```ts
const results = await Promise.allSettled(ids.map(id =>
  apiFetch(`/admin/catalog/items/${id}`, { method: 'DELETE' })
));
const failed = results.filter(r => r.status === 'rejected').length;
if (failed > 0) Alert.alert('Partial failure', `${failed} items could not be deleted.`);
```

---

### P1-3 · `usePagination` initial `page = 0` causes duplicate page-1 fetch on rapid `loadMore`

**File:** `src/hooks/usePagination.ts` (lines 6, 35–52)

`page` starts at `0`. The first `refresh()` call sets it to `1`. But if `loadMore()` fires before the initial fetch resolves (e.g., on a fast scroll or a race), it computes `page + 1 = 0 + 1 = 1` and fetches page 1 again, duplicating all items in the list.

**Fix:** Initialize `page` to `1` and set it to the result page on success, or add a guard: don't call `loadMore` if `page === 0` (meaning initial load hasn't completed).

---

### P1-4 · Notification settings (sound, email, Slack webhook) are stored locally but never sent to the API

**File:** `src/app/(tabs)/more/settings.tsx` (lines 146–183), `src/store/settings.ts`

Sound alerts, email alerts, and Slack webhook URL are saved to `AsyncStorage` only. No API call is made when these values change. An admin configuring a Slack webhook expects notifications to actually fire — they won't.

**Recommended fix:** Either:
- Wire `slackWebhookUrl`, `soundAlerts`, `emailAlerts` to a PATCH endpoint on `/admin/config` or a user preferences API
- Or mark them clearly as "Coming soon" in the UI with a disabled state and a tooltip

---

### P1-5 · SSE stream uses stale token after silent refresh — connection never re-establishes

**File:** `src/hooks/useSSE.ts` (lines 30–42)

```ts
useEffect(() => {
  if (!token || options.enabled === false) return;
  const connection = createSSEConnection({ ..., token, ... });
  return connection.close;
}, [options.enabled, path, token]);  // ← token from store
```

The SSE connection is tied to `useAuthStore.token`. As established in P0-3, after a silent refresh via `apiFetch`, the store token is never updated — so this `useEffect` never re-fires. The SSE stream continues with the original (possibly expired) Bearer token. When the server closes the connection (token expired), the SSE library reconnects with the same stale token indefinitely.

**Fix:** Resolve P0-3 first (unify token source). The SSE hook will then automatically reconnect with the new token.

---

### P1-6 · `storageUrl()` returns `null` silently when `EXPO_PUBLIC_STORAGE_URL` is unset

**File:** `src/lib/storage.ts` (lines 3–12)

```ts
const BASE = (
  Constants.expoConfig?.extra?.storageUrl ??
  process.env.EXPO_PUBLIC_STORAGE_URL ??
  ''
).replace(/\/$/, '');

export function storageUrl(key: string | null | undefined): string | null {
  if (!key || !BASE) return null;  // ← silent null
  return `${BASE}/${key.replace(/^\//, '')}`;
}
```

If the storage URL env var isn't set (common in CI, in new dev environment setups, or when the `.env` is missing), every `storageUrl()` call returns `null`. Every asset card, background thumbnail, pose thumbnail, and catalog item image renders as blank. The asset count shows correctly, making it look like a rendering bug rather than a config issue.

**Fix:** Add a visible warning in development:

```ts
if (!BASE && __DEV__) {
  console.warn('[storage] EXPO_PUBLIC_STORAGE_URL is not set — all asset images will be blank');
}
```

---

### P1-7 · `recycle-bin.tsx` "Empty Bin" action has no item count preview and no itemized confirmation

**File:** `src/app/(tabs)/more/recycle-bin.tsx`

The "Empty bin permanently" action asks the user to type a confirmation phrase, but doesn't show them **what** they're about to permanently delete (counts per type, labels). For a destructive action that bypasses the recycle bin permanently, the confirmation UX is insufficient.

**Fix:** Show a breakdown before the type-to-confirm prompt:
```
You are about to permanently delete:
• 12 backgrounds
• 4 faces
• 0 pose assets
This cannot be undone.
```

---

### P1-8 · `useApi` shows stale data from the previous item on navigate-back without clearing first

**File:** `src/hooks/useApi.ts` (lines 31–48)

When navigating from `users/[id]` for user A to `users/[id]` for user B, `path` changes, `refresh()` fires, but `data` still holds user A's data until the fetch resolves. The user briefly sees **user A's profile** on user B's screen.

**Fix:** Reset `data` to `null` when `path` changes:

```ts
useEffect(() => {
  setData(null);  // ← clear stale data on path change
  if (enabled) void refresh();
  else { requestId.current += 1; setLoading(false); }
}, [enabled, refresh]);
```

---

### P1-9 · Category long-press edit in `catalog/index.tsx` has no role guard

**File:** `src/app/(tabs)/more/catalog/index.tsx` (lines 321–325)

```tsx
onLongPress={() => openEditCat(cat)}
```

No role check. Any user with catalog access (ADMIN, MODERATOR) can open the category edit modal. They can't save (the API will 403), but the UI is misleading — they see a fully editable form, try to save, and only then get an error.

**Fix:**
```tsx
onLongPress={canDeleteAssets(role) ? () => openEditCat(cat) : undefined}
```

---

### P1-10 · Missing UI refresh when job status changes to `FAILED` in live stream

**File:** `src/app/(tabs)/jobs/[id].tsx` (lines 63-66)

The SSE `onStreamEvent` handles `'COMPLETED'` by calling `refresh()`. However, if the job status changes to `'FAILED'`, it updates `liveStatus` but never triggers `refresh()`.
Because `data` is not refreshed, `data.errorCode` will remain empty. The user sees a "FAILED" status badge but no error reason unless they manually pull to refresh.

**Fix:** Add `'FAILED'` to the refresh condition:
```ts
if (event.status === 'COMPLETED' || event.status === 'FAILED') {
  setLiveEvents([]);
  void refresh();
}
```

---

## 🟡 P2 — Medium / Quality

### P2-1 · `KeyboardAvoidingView behavior="padding"` breaks login form on Android

**File:** `src/app/(auth)/login.tsx` (line 41)

`behavior="padding"` only works reliably on iOS. On Android, the keyboard pushes the view up or overlaps the form depending on `windowSoftInputMode`. 

**Fix:** Use `Platform.OS === 'ios' ? 'padding' : 'height'` or `'position'` for Android.

---

### P2-2 · `eas.json` production profile builds an APK, not an AAB — Play Store incompatible

**File:** `apps/admin-mobile/eas.json` (lines 21–24)

```json
"production": {
  "android": {
    "buildType": "apk",
    "gradleCommand": ":app:assembleRelease"
  }
}
```

Google Play requires Android App Bundles (AAB). An APK can only be sideloaded.

**Fix:**
```json
"production": {
  "android": {
    "buildType": "app-bundle",
    "gradleCommand": ":app:bundleRelease"
  }
}
```

---

### P2-3 · `workers.tsx` "Active jobs" metric is always hardcoded `'1'` or `'0'`

**File:** `src/app/(tabs)/more/workers.tsx` (line 140)

```tsx
<Metric label="Active jobs" value={worker.status === 'BUSY' ? '1' : '0'} />
```

This hardcodes the assumption that a busy worker has exactly 1 job. The `AdminWorkerRegistryEntry` type doesn't expose a job count. Either get real data from the API or rename the metric to "Status" and remove the misleading count.

---

### P2-4 · `settings.tsx` — `useEffect` with empty deps calls `localSettings.load()` with stale closure

**File:** `src/app/(tabs)/more/settings.tsx` (lines 44–46)

```tsx
useEffect(() => {
  void localSettings.load();
}, []);  // ← localSettings missing from deps array
```

Breaks the exhaustive-deps lint rule. While benign in practice (Zustand actions are stable), it's inconsistent with how `bootstrap` and `loadTheme` are handled in `_layout.tsx` (both passed as deps).

---

### P2-5 · `home.tsx` magic number `paddingBottom: bottom + 100` for floating tab bar

**File:** `src/app/(tabs)/home.tsx` (line 97)

```ts
paddingBottom: bottom + 100,
```

Hardcoded `100` assumes tab bar height (72) + margins and padding (~28). This will break on devices with unusual safe area insets (foldables, tablets) or if the tab bar dimensions change.

**Fix:** Export the tab bar height as a constant and compute it explicitly.

---

### P2-6 · `WorkerDetailCard` in `home.tsx` duplicates the `WorkerCard` component

**File:** `src/app/(tabs)/home.tsx` (lines 351–378)

An inline `WorkerDetailCard` function renders essentially the same layout as `src/components/WorkerCard.tsx`. Two divergent implementations to maintain.

**Fix:** Unify into `WorkerCard`, adding any extra props the home screen needs.

---

### P2-7 · `statusColor` / `statusLabel` in `home.tsx` re-implement logic from `StatusBadge`

**File:** `src/app/(tabs)/home.tsx` (lines 20–50)

Worker status color/label mapping is re-implemented inline rather than extracting a shared utility used by both `home.tsx` and `StatusBadge.tsx`.

---

### P2-8 · No accessibility roles on interactive elements across all asset screens

**Files:** `assets/backgrounds/index.tsx`, `assets/faces/index.tsx`, `assets/garment-types/index.tsx`, `assets/poses/index.tsx`, `assets/pose-assets/index.tsx`

Asset cards, category cards, and bulk-action bars have no `accessibilityRole`, `accessibilityLabel`, or `accessibilityHint` on `TouchableOpacity` elements. Screen readers announce nothing useful. This affects **Play Store accessibility policy compliance**.

---

### P2-9 · `uploadTwoImage` orphaned main image on thumbnail failure

**File:** `src/lib/upload.ts` (lines 39-60)

If the main image uploads successfully to R2, but thumbnail generation (`makeThumbnail`) or thumbnail upload fails, the function throws an error. The `confirmEndpoint` is never called. This leaves the uploaded main image orphaned in R2 storage forever (unless cleared by a lifecycle policy), costing storage.

**Fix:** Consider a try-catch that calls a delete endpoint, or rely on a 24-hour R2 lifecycle rule for unconfirmed uploads.

---

### P2-10 · `jobs/index.tsx` `loadInitial` stops spinner on stale request completion

**File:** `src/app/(tabs)/jobs/index.tsx` (lines 76-85)

`loadInitial` wraps `fetchPage(1)`. If `fetchPage(1)` resolves but was ignored due to `requestId.current` mismatch (e.g. user triggered a refresh or search while loading), `loadInitial`'s `finally` block still calls `setLoading(false)`. This hides the loading spinner while the *actual* active request is still pending.

**Fix:** Check `requestId` inside `loadInitial` before setting loading to false, or rely entirely on `refreshing`/`paginating` states managed inside `fetchPage`.

---

### P2-11 · `jobs/index.tsx` SSE live stream does not prepend newly created jobs

**File:** `src/app/(tabs)/jobs/index.tsx` (lines 94-117)

The SSE handler updates `current.map(job => ...)`. If a completely new job is created, it is not yet in the `current` jobs array. The `map` operation ignores it. The user will not see new jobs appear in the list until they manually pull-to-refresh.

**Fix:** If `update.jobId` is not found in the array (and matches current filters), fetch the job details or append a placeholder to the top of the list.

---

## 🔵 P3 — Low / Polish

### P3-1 · UUID regex in `home.tsx` SmartSearch accepts malformed IDs

**File:** `src/app/(tabs)/home.tsx` (line 82)

```ts
const id = query.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
```

The character class `[0-9a-f-]` includes a literal `-`, so it matches non-UUID strings like `00000000-aaaa----`. Use a proper UUID v4 pattern: `/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i`.

---

### P3-2 · No automated version/build number bump in CI

**File:** `apps/admin-mobile/app.config.js` (line 9) — `version: '1.0.1'`

There is no CI step to auto-increment `versionCode` / `buildNumber`. Manual bumping in a fast-moving repo is error-prone. Play Store and TestFlight will reject duplicate build numbers.

**Fix:** Use EAS `appVersionSource: "remote"` or a pre-build hook that reads from `git describe`.

---

### P3-3 · `widget-clients/[id].tsx` skeleton loader doesn't fill screen height

**File:** `src/app/(tabs)/more/widget-clients/[id].tsx` (lines 140–145)

The loading wrapper `View` lacks `flex: 1`, so skeletons render in a compact block at the top rather than filling the screen. Inconsistent with every other detail screen in the app.

---

### P3-4 · Home screen 30s polling spinner is visually distracting in production

**File:** `src/app/(tabs)/home.tsx` (lines 72–76)

The pull-to-refresh indicator (`refreshControl` with `refreshing={loading}`) activates every 30 seconds during background polls. On a mounted monitor or long-session device, the spinner pulses constantly. Consider using a subtle "Last refreshed: HH:MM:SS" badge (already implemented) instead of the spinner for background polls.

---

### P3-5 · `users/index.tsx` debounce timer could fire after unmount

**File:** `src/app/(tabs)/more/users/index.tsx` (lines 30–33)

The `clearTimeout` in `useEffect` cleanup correctly prevents the timer from firing post-unmount. However, if the component unmounts **after** the timer fires (400ms elapsed) but **before** `apiFetch` resolves, `setDebouncedSearch` would still run on an unmounted component (though React 18 suppresses most unmounted state-set warnings). Low risk, but worth a mounted-ref guard.

---

### P3-6 · App version `1.0.1` with no changelog or release notes in the repo

**File:** `app.config.js`

No `CHANGELOG.md` exists for the mobile app. Given that this is distributed internally via EAS, testers have no reference for what changed between builds.

---

### P3-7 · Unmounted state update in `more/users/[id].tsx` on user delete

**File:** `src/app/(tabs)/more/users/[id].tsx` (lines 129-144)

In `deleteUser`, `router.back()` is called synchronously after success. Then the `finally` block calls `setActioning(false)`. Calling state updates after navigating back executes on an unmounted component, leading to a React memory leak warning.

---

### P3-8 · Unmounted state update in `login.tsx` on successful login

**File:** `src/app/(auth)/login.tsx` (lines 24-39)

After `await login(...)` succeeds, the Zustand store updates, triggering the `AuthGate` in `_layout.tsx` to redirect the user to `/(tabs)/home`. The `LoginScreen` unmounts, but the `finally` block then calls `setLoading(false)`, causing another unmounted state update.

---

### P3-9 · `useAdminJobStream` recreates `options` object unnecessarily

**File:** `src/hooks/useAdminJobStream.ts` (lines 9-13)

The signature uses a default parameter: `options: UseAdminJobStreamOptions = {}`. On every render, if the caller omits `options` (which `jobs/[id].tsx` does), a new empty object is created and passed to `useSSE`. While `useSSE` currently handles this safely via refs, it's an anti-pattern that could trigger unnecessary effect re-runs if `useSSE`'s dependencies change.

---

## Recommended Fix Schedule

### Week 1 — P0 Blockers (before any release APK)
1. **P0-1 / P0-2:** Fix `eas.json` — point `preview` at staging, remove cleartext from preview builds
2. **P0-3 / P0-4:** Unify token management to single source of truth; call `setApiToken` in `login()`
3. **P0-5:** Add error handling to `confirmAction` in `ConfirmDialog.ts`
4. **P0-6:** Wire `expo-clipboard` in widget client detail

### Week 2 — P1 High-Risk
5. **P1-1:** Logout on 401-after-refresh-fails inside `apiFetch`
6. **P1-2:** Replace serial catalog bulk-delete loop with batch or `Promise.allSettled` + failure report
7. **P1-4:** Remove notification settings or wire them to the API
8. **P1-8:** Clear stale `data` in `useApi` on path change

### Week 3 — P2 Quality
9. **P2-1:** Fix `KeyboardAvoidingView` behavior on Android
10. **P2-2:** Change EAS `production` to `buildType: "app-bundle"`
11. **P2-8:** Add `accessibilityRole` and labels to all asset screen touch targets
12. **P2-3:** Remove or fix "Active jobs" hardcoded metric in workers screen

---

*Generated by full static audit of `apps/admin-mobile/src` on 2026-06-30.*
