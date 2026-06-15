# Admin Mobile App — Implementation Guide

## Overview

A **React Native (Expo)** application for administering the Ai Vastra platform on
mobile devices. It reuses all existing API endpoints from `apps/api` and shares
type contracts from `@aivastra/types`. The existing `apps/admin` web SPA remains
untouched.

| Property | Value |
|----------|-------|
| **Package** | `@aivastra/admin-mobile` |
| **Location** | `apps/admin-mobile` |
| **Runtime** | Expo SDK 53 (React Native 0.79) |
| **Architecture** | New Architecture (Fabric + JSI) — enabled by default in SDK 53 |
| **Language** | TypeScript 5.6, ESM |
| **Navigation** | React Navigation 7 (bottom tabs + native stacks) |
| **State** | Zustand (auth, theme, toasts) |
| **Targets** | Android 12+ (iOS to follow after Android is stable) |
| **Build** | EAS Build (`.aab` / `.apk`) |

---

## 1. Project Scaffold

### 1.1 Directory structure

```
apps/admin-mobile/
├── app.json                          # Expo config (scheme, icons, splash)
├── eas.json                          # EAS Build profiles
├── babel.config.js                   # Expo + react-native-reanimated
├── metro.config.js                   # SVG transformer + monorepo symlinks
├── tsconfig.json                     # Strict, paths to @aivastra/types
├── package.json
├── assets/                           # App icon, splash, fonts
├── src/
│   ├── app/                          # Expo Router file-based routes
│   │   ├── _layout.tsx               # Root layout (auth gate)
│   │   ├── (auth)/
│   │   │   └── login.tsx             # Login screen
│   │   └── (tabs)/
│   │       ├── _layout.tsx           # Bottom tab navigator
│   │       ├── home.tsx              # Dashboard
│   │       ├── jobs/
│   │       │   ├── _layout.tsx       # Jobs stack
│   │       │   ├── index.tsx         # Job list
│   │       │   └── [id].tsx          # Job detail
│   │       ├── assets/
│   │       │   ├── _layout.tsx       # Assets hub + stacks
│   │       │   ├── index.tsx         # Asset category grid
│   │       │   ├── faces/
│   │       │   ├── backgrounds/
│   │       │   ├── poses/
│   │       │   ├── pose-assets/
│   │       │   ├── garment-types/
│   │       │   └── catalog/
│   │       └── more/
│   │           ├── _layout.tsx       # More menu + sub-stacks
│   │           ├── index.tsx         # Menu list
│   │           ├── users/
│   │           ├── workflows/
│   │           ├── recycle-bin/
│   │           ├── workers/
│   │           ├── settings/
│   │           └── config.tsx
│   ├── components/                   # Shared UI components
│   │   ├── StatusBadge.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── FilterChips.tsx
│   │   ├── ImagePreview.tsx
│   │   ├── NameAvatar.tsx
│   │   ├── KeyValueRow.tsx
│   │   ├── EmptyState.tsx
│   │   ├── SkeletonLoader.tsx
│   │   ├── Toast.tsx
│   │   ├── Icons.tsx                 # Ported from apps/admin — 45 icons
│   │   └── BottomSheet.tsx
│   ├── lib/
│   │   ├── api.ts                    # fetch + JWT interceptor (port of apiFetch)
│   │   ├── sse.ts                    # EventSource for RN
│   │   ├── thumbnail.ts             # expo-image-manipulator wrapper
│   │   └── format.ts                # Date, number, truncation helpers
│   ├── store/
│   │   ├── auth.ts                   # Zustand — token, role, email
│   │   ├── theme.ts                  # Zustand — dark/light + AsyncStorage
│   │   └── toast.ts                  # Zustand — toast queue
│   ├── styles/
│   │   ├── tokens.ts                 # Colors, spacing, typography, radii
│   │   └── global.ts                # Shared StyleSheet constants
│   └── types.ts                      # TypeScript interfaces (ported from apps/admin)
```

### 1.2 Dependencies

```json
{
  "dependencies": {
    "expo": "~53.0.0",
    "expo-router": "~5.0.0",
    "expo-secure-store": "~15.0.0",
    "expo-image-picker": "~17.0.0",
    "expo-document-picker": "~14.0.0",
    "expo-image-manipulator": "~14.0.0",
    "expo-status-bar": "~3.0.0",
    "expo-splash-screen": "~0.30.0",
    "expo-constants": "~18.0.0",
    "react": "18.3.1",
    "react-native": "0.79.x",
    "react-native-screens": "~4.5.0",
    "react-native-safe-area-context": "~5.0.0",
    "react-native-svg": "~15.11.0",
    "react-native-reanimated": "~3.17.0",
    "@react-navigation/native": "^7.0.0",
    "@react-navigation/bottom-tabs": "^7.0.0",
    "@react-navigation/native-stack": "^7.0.0",
    "zustand": "^5.0.0",
    "@aivastra/types": "workspace:*",
    "expo-media-library": "~18.0.0",
    "@react-native-async-storage/async-storage": "~2.1.0",
    "react-native-gesture-handler": "~2.24.0"
  },
  "devDependencies": {
    "@types/react": "~18.3.0",
    "typescript": "~5.6.0",
    "react-native-svg-transformer": "^1.5.0"
  }
}
```

### 1.3 Monorepo wiring

- `pnpm-workspace.yaml` — add `apps/admin-mobile` (if using glob `apps/*` this
  is automatic)
- `tsconfig.json` at workspace root — no changes needed (the root
  `tsconfig.base.json` already uses `moduleResolution: "Bundler"` which is
  compatible with Expo)
- **`apps/admin-mobile/tsconfig.json`** — must be standalone; do NOT extend the
  root `tsconfig.base.json`. Extend `expo/tsconfig.base` instead:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@aivastra/types": ["../../packages/types/dist/index.js"],
      "@aivastra/types/*": ["../../packages/types/dist/*"]
    }
  }
}
```

### 1.4 Metro bundler — ESM compatibility

Metro (Expo's bundler) does not support ESM packages from `node_modules`.
`@aivastra/types` has `"type": "module"` and exports ESM. The fix is two-part:

**Part A — Pre-build `@aivastra/types` to CJS for Metro:**

Add a `build:cjs` script to `packages/types/package.json` that compiles a
CommonJS version into `dist/cjs/`:

```json
// packages/types/package.json (add to existing)
{
  "scripts": {
    "build": "tsc",
    "build:cjs": "tsc --module commonjs --moduleResolution node --outDir dist/cjs",
    "typecheck": "tsc --noEmit"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

Run before every EAS Build and in CI:

```bash
pnpm --filter @aivastra/types build && pnpm --filter @aivastra/types build:cjs
```

**Part B — `metro.config.js` resolver:**

```js
// apps/admin-mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Watch monorepo packages so hot reload works across workspace
config.watchFolders = [path.resolve(__dirname, '../../packages/types')];

// SVG transformer — required for Icons.tsx .svg imports
const { transformer, resolver } = config;
config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};
config.resolver = {
  ...resolver,
  extraNodeModules: {
    '@aivastra/types': path.resolve(__dirname, '../../packages/types/dist/cjs'),
  },
  assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...resolver.sourceExts, 'svg'],
};

module.exports = config;
```

### 1.5 Environment config — `app.config.js`

Expo does not read `.env` files natively. Use `app.config.js` with
`@expo/config-plugins` to inject environment at build time:

```js
// apps/admin-mobile/app.config.js
const API_URL = process.env.ADMIN_MOBILE_API_URL || 'http://localhost:4000';
const IS_DEV = process.env.APP_ENV !== 'production';

module.exports = {
  expo: {
    name: 'Ai Vastra Admin',
    slug: 'aivastra-admin-mobile',
    scheme: 'aivastra-admin',
    extra: {
      apiUrl: API_URL,
      eas: { projectId: process.env.EAS_PROJECT_ID },
    },
    ios: { supportsTablet: false },
    android: {
      package: 'ai.aivastra.admin',
      adaptiveIcon: { /* ... */ },
      ...(IS_DEV && { usesCleartextTraffic: true }),
    },
    plugins: [
      ['expo-image-picker', {
        photosPermission: 'Allow Ai Vastra Admin to access your photos for uploads.',
      }],
      ['expo-media-library', {
        photosPermission: 'Allow Ai Vastra Admin to save images to your library.',
        savePhotosPermission: 'Allow Ai Vastra Admin to save images.',
        isAccessMediaLocationEnabled: true,
      }],
    ],
  },
};
```

The API client reads `Constants.expoConfig.extra.apiUrl` (`expo-constants`
package) to build the base URL for all `fetch()` calls.

**Dev / staging / prod switching:**
- Dev: `ADMIN_MOBILE_API_URL=http://192.168.1.x:4000 pnpm dev`
- Preview (EAS): set `ADMIN_MOBILE_API_URL` as an EAS secret
- Production: hardcoded in `app.config.js` or set via EAS secret

### 1.6 New Architecture (Fabric + JSI)

Expo SDK 53 enables New Architecture by default. All dependencies must be
compatible:

- `react-native-svg` ≥ 15.11.0 — has full New Architecture support
- `react-native-reanimated` ≥ 3.17.0 — required for Fabric compat
- `react-native-gesture-handler` ≥ 2.24.0 — Fabric-compatible
- The custom SSE reader (§3.3) uses only `fetch()` and `ReadableStream` — no
  native module, so no New Architecture conflict
- `expo-secure-store` / `expo-image-picker` / `expo-media-library` — all Expo
  modules with built-in New Architecture support

### 1.7 Root `pnpm dev` exclusion

The workspace root `pnpm dev` runs all packages in parallel. The Expo dev server
does not work in that context (it requires its own Metro bundler process). Do
**not** add a `dev` script to `apps/admin-mobile/package.json`. Instead, run it
directly:

```bash
pnpm --filter @aivastra/admin-mobile expo start
```

Or add a scoped script to root `package.json`:

```json
"admin-mobile:dev": "pnpm --filter @aivastra/admin-mobile expo start"
```

---

## 2. Navigation Architecture

### 2.1 Bottom tabs (4 tabs)

```
┌──────────────────────────────────────────┐
│  Home     │   Jobs   │  Assets  │  More   │
│ (Dashboard)│ (List)   │ (Hub)    │ (Menu)  │
└──────────────────────────────────────────┘
```

| Tab | Label | Icon | Access |
|-----|-------|------|--------|
| Home | Dashboard | `Dashboard` | ALL roles |
| Jobs | Jobs | `Jobs` | ALL roles |
| Assets | Assets | `Image` | MODERATOR, SUPER_ADMIN |
| More | More | `Dots` | ALL roles |

**Role-based tab filtering:** The bottom tab layout reads `role` from the auth
store and only renders tabs the user is authorized for. SUPPORT users see only
Home, Jobs, and More.

Use a role helper instead of hard-coding role names in component logic:

```ts
// src/lib/roles.ts
type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT';

const ROLE_LEVEL: Record<AdminRole, number> = {
  SUPER_ADMIN: 3,
  MODERATOR: 2,
  SUPPORT: 1,
};

function canAccessAssets(role: AdminRole): boolean {
  return ROLE_LEVEL[role] >= 2; // MODERATOR+
}

function canManageUsers(role: AdminRole): boolean {
  return ROLE_LEVEL[role] >= 2;
}

function isSuperAdmin(role: AdminRole): boolean {
  return role === 'SUPER_ADMIN';
}
```

This avoids brittle string comparisons scattered across the codebase and
survives future role additions.

### 2.2 Stack navigators per tab

**Home tab stack:**
```
Dashboard ──► Worker Detail
```

**Jobs tab stack:**
```
Job List ──► Job Detail
  │              │
  │              ├── Cancel (action sheet)
  │              └── Retry (action sheet)
  │
  └── Filter chips (inline): All | Queued | Generating | Completed | Failed | Cancelled
```

**Assets tab stack:**
```
Asset Hub (grid)
  ├── Faces ──► Face List ──► Face Detail ──► Edit
  │                └── Upload Face
  ├── Backgrounds ──► Bg List ──► Bg Detail ──► Edit
  │                     └── Upload Background
  ├── Garment Types ──► GT List ──► Poses for GT ──► Pose Detail ──► Edit
  │                       └── Upload GT               └── Upload Pose
  ├── Pose Assets ──► PA List ──► PA Detail ──► Edit
  │                     └── Upload PA       └── Map to GT
  └── Catalog ──► Category Tree ──► Items List ──► Item Detail ──► Edit
                     └── Upload Items (batch)
```

**More tab stack:**
```
Menu List
  ├── Users ──► User List ──► User Detail
  │                │              ├── Grant Credits
  │                │              └── Ban / Unban
  │                └── Search bar
  ├── Workflows ──► WF List ──► WF Detail
  │                   │            ├── Edit
  │                   └── Upload   └── Reassign
  ├── Recycle Bin ──► Tab bar: Faces | Backgrounds | Pose Assets
  │                     └── Restore / Permanent Delete
  ├── Workers ──► Worker List ──► Worker Detail ──► Drain
  ├── Settings ──► Credit Plans CRUD (SUPER_ADMIN only)
  │                └── Theme toggle, Logout
  └── Config ──► System config form (SUPER_ADMIN only)
```

---

## 3. Auth & API Layer

### 3.1 Porting `apiFetch` from `apps/admin/src/lib/data.ts`

The existing web client uses `fetch()` with these behaviors:

1. Attaches `Authorization: Bearer <token>` header
2. Sets `credentials: 'include'` for cookie-based refresh
3. On 401: calls `POST /v1/auth/refresh`, retries on success, logs out on failure
4. Throws `ApiError` with `status` and `body` on non-OK responses

**RN equivalent (`src/lib/api.ts`):**

```ts
// Uses /v1/auth/refresh-body (body-based) instead of /v1/auth/refresh (cookie-based)
let token: string | null = null;

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  let res = await fetch(url, { ...init, headers });
  if (res.status === 401 && token) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      res = await fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${refreshed}` } });
    }
  }
  if (!res.ok) throw new ApiError(res.status, await res.json());
  return res.json();
}

async function tryRefreshToken(): Promise<string | null> {
  const storedRefresh = await SecureStore.getItemAsync('refreshToken');
  if (!storedRefresh) return null;
  try {
    const res = await fetch(`${baseUrl}/v1/auth/refresh-body`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: storedRefresh }),
    });
    if (!res.ok) throw new Error('refresh failed');
    const { accessToken, refreshToken } = await res.json();
    if (refreshToken) {
      await SecureStore.setItemAsync('refreshToken', refreshToken);
    }
    token = accessToken;
    return accessToken;
  } catch {
    await SecureStore.deleteItemAsync('refreshToken');
    token = null;
    return null;
  }
}
```

**Differences from web:**
- No `credentials: 'include'` — RN `fetch` doesn't support cookies the same way;
  the refresh token is stored in `expo-secure-store` and sent as a custom header or body param
- Token stored in `expo-secure-store` (Android Keystore) instead of in-memory variable
- Requires a small **backend adapter**: add `POST /v1/auth/refresh-body` that
  accepts `{ refreshToken: string }` in the body (RN can't rely on HTTP-only cookies).

  *This is a ~10-line route addition in `apps/api` — no DB changes.*

### 3.2 Auth store (`src/store/auth.ts`)

```ts
// Zustand store
interface AuthState {
  token: string | null;
  role: 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT' | null;
  email: string;
  storagePublicUrl: string;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>; // attempt refresh on app launch
}
```

**Startup flow (`bootstrap`):**
1. Read refresh token from `SecureStore`
2. If exists → `POST /v1/auth/refresh-body { "refreshToken": "<value>" }`
3. Response: `{ accessToken, refreshToken }` — store new access token in memory;
   if refreshToken is non-null, update SecureStore (reissue responses return
   `null` and the existing token is retained)
4. Call `GET /admin/me` → set role/email in store
5. If no token or refresh fails → show Login screen

**Login flow:**
1. `POST /v1/auth/login-mobile { email, password }`
2. Response: `{ accessToken, refreshToken }` — both in JSON body
3. Store access token in memory, refresh token in SecureStore
4. `GET /admin/me` → set role/email in store

**Logout:**
1. Read `refreshToken` from SecureStore
2. `POST /v1/auth/logout-mobile { refreshToken }` (best-effort — invalidates the
   token family server-side so stolen devices can't refresh after logout)
3. Clear both tokens from memory and SecureStore
4. Navigate to Login

**Foreground token refresh:** The root `_layout.tsx` must listen for
`AppState` changes and proactively refresh the access token when the app
returns to foreground after being backgrounded >15 minutes (the access token
may have expired while the app was suspended):

```ts
// src/app/_layout.tsx (in the auth-gating logic)
useEffect(() => {
  const sub = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active' && token) {
      tryRefreshToken(); // reuses the same refresh-body flow
    }
  });
  return () => sub.remove();
}, [token]);
```

**Root layout wrapper:** The root `_layout.tsx` must wrap the entire app in
`GestureHandlerRootView`. Without this, any gesture (swipe, pinch-to-zoom in
ImagePreview, etc.) throws a runtime error on Android:

```ts
// src/app/_layout.tsx — required
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* auth gate + slot + AppState listener */}
    </GestureHandlerRootView>
  );
}
```

### 3.3 SSE for job streaming (`src/lib/sse.ts`)

React Native lacks native `EventSource`. Do not use `react-native-event-source`
(last meaningful update 2021, no Hermes engine support). Use a **custom
fetch-based streaming reader** instead — it works on both Hermes and JSC with
no extra dependencies:

```ts
// src/lib/sse.ts
export function createSSEConnection(
  baseUrl: string,
  path: string,
  token: string,
  onEvent: (event: { event: string; data: string }) => void,
): { close: () => void } {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let backoff = 1000;
  let closed = false;

  async function connect() {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('SSE connection failed');
      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Parse SSE blocks: "event: X\ndata: Y\n\n"
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const eventMatch = /^event:\s*(.+)$/m.exec(part);
          const dataMatch = /^data:\s*(.+)$/m.exec(part);
          if (dataMatch) {
            onEvent({ event: eventMatch?.[1] ?? 'message', data: dataMatch[1] });
          }
        }
      }
      backoff = 1000; // reset backoff on clean close
    } catch (err) {
      if (closed) return;
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
      connect(); // reconnect
    }
  }

  connect();

  return {
    close() {
      closed = true;
      reader?.cancel();
      controller.abort();
    },
  };
}
```

Same exponential backoff reconnection logic as `apps/admin/src/lib/sse.ts`.

### 3.4 Thumbnail generation (`src/lib/thumbnail.ts`)

Web uses `createImageBitmap` + `<canvas>`. RN uses `expo-image-manipulator`:

```ts
import * as ImageManipulator from 'expo-image-manipulator';

async function makeThumbnail(uri: string, maxDim = 512, quality = 0.78): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxDim } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
  );
  return result.uri;
}
```

---

## 4. Screen Implementation Details

### 4.1 Login Screen

- Centered card with Ai Vastra logo
- Email + password `TextInput` fields
- "Sign In" button with loading spinner
- Error states: 403 = "Not an admin account", 401 = "Invalid credentials"
- Dark theme only (branded)

### 4.2 Dashboard Screen

**Data:** `GET /admin/stats` — polls every 30 seconds, pull-to-refresh.
`GET /admin/workers` — called separately for worker details (name, GPU info not
available in `/admin/stats`).

**Layout:** Vertical `ScrollView` with `RefreshControl`

- **Stat cards section** — 2-column grid on phones, 3-column on tablets
  - Each card: icon, label, value, delta indicator (▲/▼) — except `failed24h`
    which has no server-provided delta; show standalone count without arrow
  - Tappable — navigates to relevant filtered view (e.g. tap "Failed 24h" →
    Jobs tab with failed filter)
- **Worker Pool section** — `FlatList` of workers from `/admin/workers`,
  each showing status dot + name + GPU model
- **Recent Failures section** — last 5 failed jobs with error codes
- **Stuck Queue section** — jobs queued >10 min
- **All Offline Warning** — red banner if 0 workers healthy

### 4.3 Jobs List Screen

**Data:** `GET /admin/jobs?page=&pageSize=&status=&search=`

**Layout:**
- Horizontal `FilterChips` (scrollable row of pills): All, Queued, Generating,
  Completed, Failed, Cancelled
- `FlatList` with onEndReached pagination
- Each job card: status badge, user email, credits, relative time
- Pull-to-refresh
- Search bar (tappable — opens search modal)

**SSE Integration:** The SSE stream at `GET /admin/jobs/stream` updates job
status badges in-place without re-rendering the entire list (use
`keyExtractor` + selective re-render).

### 4.4 Job Detail Screen

**Data:** `GET /admin/jobs/:id`

**Layout:**
- **Header:** Status badge, job ID, credits, timestamps
- **Input Images** (collapsible accordion):
  - Face, Background, Pose, Upper/Lower/Shoe garments
  - Each: thumbnail preview → tap to fullscreen `ImagePreview`
  - URLs are **public** (not presigned) — in production (Cloudflare R2) these
    work from any device. In dev (MinIO at `127.0.0.1:9000`), images are
    unreachable from physical devices — use emulator/simulator for dev.
- **Output:** Full-size image preview (if completed), tap to zoom
- **Events Timeline:** Vertical timeline with event type, worker, timestamp
  - Expandable JSON payload per event (especially COMFY_DISPATCH — copy button)
- **Action Buttons:** Cancel (if in-progress), Retry (if failed)
  - Both show `ConfirmDialog` before executing

### 4.5 Assets Hub

**Layout:** Grid of category cards (2 columns phone, 3 tablet)
- Model Faces
- Backgrounds
- Garment Types
- Pose Assets
- Catalog

Each card: icon, label, item count. Tapping navigates to that category's list.

### 4.6 Generic List Screens (Faces, Backgrounds, etc.)

**Common patterns across all asset list screens:**

- `FlatList` or `ScrollView` with pull-to-refresh
- **Filter chips** where applicable (gender for faces/backgrounds)
- **Search** (optional, where backend supports it)
- **Sort picker** (bottom sheet with sort options)
- **Long-press** enters bulk select mode — checkboxes appear, action bar at bottom:
  - Delete selected
  - Reassign workflow (poses)
  - Map to garment types (pose assets)
- **FAB / header button** for "Add New" — opens upload flow
- **Tap row** navigates to detail/edit screen
- **Empty state** when list is empty — illustration + prompt to add first item

### 4.7 Upload Flow (Generic)

**All uploads follow the same 3-step pattern from the web admin:**

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Step 1       │     │  Step 2           │     │  Step 3          │
│  Form fields  │ ──► │  Upload to R2     │ ──► │  Confirm to API  │
│  + file pick  │     │  + thumbnail gen   │     │                  │
└──────────────┘     └──────────────────┘     └─────────────────┘
```

**Step 1 — Form:** File picker via `expo-image-picker` or
`expo-document-picker`. Dynamic form fields (text inputs, switches, selects)
matching the existing `UploadModal` field configs.

**Step 2 — Upload:** Call presign endpoint → get PUT URL → upload file via
`fetch(url, { method: 'PUT', body: blob })` → generate thumbnail via
`expo-image-manipulator` → upload thumbnail to presigned URL.

**Step 3 — Confirm:** POST to confirm endpoint with form data + R2 keys → on
success, navigate back and refresh list.

**Progress indicator:** Per-file progress bar using `XMLHttpRequest` (fetch
doesn't support upload progress in RN).

**Asset type → presign endpoint mapping:**

| Asset Type | Presign Endpoint | Returns |
|------------|-----------------|---------|
| Model Face | `POST /admin/assets/faces/presign` | `{ uploadUrl, r2Key, thumbnailUploadUrl, thumbnailKey }` |
| Background | `POST /admin/assets/backgrounds/presign` | `{ uploadUrl, r2Key, thumbnailUploadUrl, thumbnailKey }` |
| Pose (garment-type mapped) | `POST /admin/assets/poses/presign` | `{ poseUploadUrl, poseKey, poseThumbUrl, poseThumbKey, faceSideUploadUrl?, faceSideKey?, bgComfyUploadUrl?, bgComfyKey?, faceUploadUrl?, faceKey?, faceThumbUrl?, faceThumbKey?, bgUploadUrl?, bgKey?, bgThumbUrl?, bgThumbKey? }` |
| Pose Asset | `POST /admin/assets/pose-assets/presign` | Same shape as poses — also supports inline face/bg creation |
| Garment Type | `POST /admin/assets/garment-types/presign` | `{ uploadUrl, r2Key, thumbnailUploadUrl, thumbnailKey }` |
| Catalog Item | `POST /admin/catalog/items/presign` | `{ uploadUrl, r2Key, thumbnailUploadUrl, thumbnailKey }` |

Each presign response includes **both** a main image upload URL and a thumbnail
upload URL. The mobile client must upload the main image first, generate a
thumbnail via `expo-image-manipulator`, then upload the thumbnail to the
thumbnail URL — all before calling the confirm endpoint.

**Dev environment note:** The confirm endpoint creates DB rows that reference R2
keys. On dev (MinIO at `127.0.0.1:9000`), public URLs contain `127.0.0.1` which
is **unreachable from a physical device**. Use an Android emulator (which shares
the host network) for dev. In production (Cloudflare R2),
public URLs work from any device.

### 4.8 Catalog Screen

**Layout:**
- Category tree — horizontal scrollable pills or nested accordion
- Selecting a category shows its items in a grid
- Each item: thumbnail, label, active toggle, sort order
- Batch upload: select multiple images, edit labels per row, sequential upload

### 4.9 Users Screen

**Data:** `GET /admin/users?page=&pageSize=&search=`

**Layout:**
- Search bar (by email/name)
- `FlatList` with pagination
- Each row: avatar, name, email, tier badge, balance, status dot
- Tap → User Detail screen

**User Detail:**
- Full profile info
- Recent jobs list (last 20)
- Action buttons: Grant Credits (modal with amount + reason), Ban/Unban
  (confirmation dialog)

### 4.10 Workflows Screen

**Data:** `GET /admin/workflows`, `POST /admin/workflows/parse`

**Layout:**
- List of workflow templates, each showing label, slug, pose count, active status
- Tap → Workflow Detail (node mappings, default prompts, raw JSON)
- Upload button → file picker (JSON) → auto-parse via `/admin/workflows/parse` →
  review detected mappings → create
- Edit: modify label, slug, node mappings
- Reassign: modal to select target workflow, bulk-reassign poses

### 4.11 Recycle Bin Screen

**Data:** `GET /admin/assets/recycle-bin`

**Layout:**
- 3 tabs (Faces, Backgrounds, Pose Assets)
- `FlatList` per tab with pagination
- Long-press select mode
- Action bar: Restore selected, Permanent Delete (requires typing confirmation phrase)

### 4.12 Workers Screen

**Data:** `GET /admin/workers`

**Layout:**
- List of workers with status dot, name, GPU info
- Tap → Worker Detail (full health info)
- Drain button (SUPER_ADMIN, MODERATOR)

### 4.13 Settings Screen (SUPER_ADMIN only)

**Sections:**
- **Credit Plans:** CRUD list — create/edit in bottom sheet, delete with confirmation
- **Appearance:** Theme toggle (light/dark)
- **Session:** Logout button

### 4.14 Config Screen (SUPER_ADMIN only)

**Data:** `GET /admin/config`, `PATCH /admin/config`

**Layout:**
- Text inputs for: credit cost per job, max jobs per day
- Save button with loading state

---

## 5. Component Specifications

### 5.1 StatusBadge

```
Props: status: string
Output: Rounded pill with colored background + text
Color map: QUEUED=blue, GENERATING=amber, COMPLETED=green, FAILED=red, CANCELLED=gray
Size: compact (default) or full-width variant
```

### 5.2 ConfirmDialog

```
Props: title, message, confirmLabel?, destructive? (red button), onConfirm, onCancel
Uses: React Native Alert.alert (native dialog) for simple cases
       Custom Modal + BottomSheet for destructive actions needing extra confirmation
```

### 5.3 FilterChips

```
Props: options: { label, value }[], selected: string, onSelect
Output: Horizontal ScrollView of pill buttons
Selected chip: filled background; unselected: outlined
```

### 5.4 ImagePreview

```
Props: uri: string, visible: boolean, onClose
Uses: Modal with react-native-gesture-handler pinch-to-zoom
       (or simple Modal + ScrollView with maximumZoomScale)
Header: close button, "Save" (save to camera roll via expo-media-library)
```

### 5.5 Icons (ported from apps/admin/src/components/Icons.tsx)

All 45 SVG icons converted from inline HTML `<svg>` to `react-native-svg` JSX:

```
<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
  <Path d="..." stroke={color} strokeWidth={2} strokeLinecap="round" />
</Svg>
```

Each icon exported as a named function component: `<DashboardIcon />`, `<JobsIcon />`, etc.

### 5.6 EmptyState

```
Props: icon: string (icon name), title: string, subtitle?: string, action?: { label, onPress }
Output: Centered column with icon, text, optional action button
```

### 5.7 SkeletonLoader

```
Props: variant: 'card' | 'list' | 'detail' | 'grid', count?: number
Output: Animated shimmer placeholders matching the target layout shape
Uses: react-native-reanimated for the shimmer gradient animation
```

---

## 6. Styling System

### 6.1 Design tokens (`src/styles/tokens.ts`)

Ported from `apps/admin/src/styles/tokens.css`:

```ts
export const Colors = {
  // Light theme
  light: {
    bg: '#FFFFFF',
    bgSecondary: '#F5F5F5',
    surface: '#FAFAFA',
    text: '#141414',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#E5E5E5',
    accent: '#F55C7A',
    accentSecondary: '#F6B553',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
  },
  // Dark theme
  dark: {
    bg: '#141414',
    bgSecondary: '#1E1E1E',
    surface: '#282828',
    text: '#FEFEFE',
    textSecondary: '#AAAAAA',
    textMuted: '#666666',
    border: '#333333',
    accent: '#F55C7A',
    accentSecondary: '#F6B553',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const Radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export const Typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '600' as const, lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodyBold: { fontSize: 15, fontWeight: '600' as const, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  captionBold: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
  code: { fontSize: 12, fontFamily: 'monospace', lineHeight: 16 },
};
```

### 6.2 Theme management (`src/store/theme.ts`)

```ts
// Zustand store
interface ThemeState {
  isDark: boolean;
  toggle: () => void;
}
```

Persisted in `AsyncStorage` key `aivastra-theme`. Default: system preference
(via `Appearance.getColorScheme()`).

### 6.3 Responsive layout

- **Phone (< 428px):** Single column, full-width cards
- **Tablet (≥ 428px):** 2-column grids for stat cards, asset grids
- **Tablet landscape (≥ 744px):** 3-column grids

Use `useWindowDimensions()` to detect width and compute column count:

```ts
const { width } = useWindowDimensions();
const columns = width < 428 ? 1 : width < 744 ? 2 : 3;
```

---

## 7. API Contract Reuse

### 7.1 Shared types

Import Zod schemas directly from `@aivastra/types` for request validation:

```ts
import { GrantCreditsBody, UpdateUserBody } from '@aivastra/types';

// PlanBody / credit plan schemas are not in @aivastra/types — they are defined
// locally in apps/api/src/modules/admin/creditPlans.routes.ts. The mobile app
// defines its own type from the same shape:
const CreditPlanBody = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  subtext: z.string().max(200).default(''),
  credits: z.number().int().positive(),
  basePaise: z.number().int().positive(),
  isActive: z.boolean().default(true),
  isHighlighted: z.boolean().default(false),
  badge: z.string().max(50).nullable().default(null),
  sortOrder: z.number().int().default(0),
});
```

### 7.2 Backend adapters needed (apps/api)

Three new endpoints are required in `apps/api` because the existing auth routes
rely on HTTP-only cookies for refresh token delivery — cookies that React
Native's `fetch()` cannot read or persist.

#### 7.2.1 `POST /v1/auth/login-mobile`

New route file: `apps/api/src/modules/auth/login-mobile.routes.ts`

```ts
// Inlines the login logic WITHOUT calling createSessionTokens (which sets a
// cookie). Creates the refresh token family directly and returns both tokens
// in the JSON body.
app.post(
  '/v1/auth/login-mobile',
  {
    schema: { body: LoginBody },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  },
  async (req, reply) => {
    const { email, password } = req.body;
    // ... same user lookup + password verification as /v1/auth/login ...

    // Verify this user is an admin — regular users cannot use this endpoint
    const [adminRow] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, user.id));
    if (!adminRow) {
      throw new AppError('NOT_ADMIN', 403, 'not an admin account');
    }

    // Generate access token (JWT)
    const accessToken = await signAccess(
      app.env.JWT_SECRET,
      user.id,
      { kind: 'access' },
      app.env.JWT_EXPIRY,
    );

    // Create refresh token family in DB (same token rotation table as web)
    const plain = crypto.randomBytes(48).toString('base64url');
    const hash = crypto.createHash('sha256').update(plain).digest('hex');
    const familyId = crypto.randomUUID();
    await app.db.insert(schema.refreshTokens).values({
      id: crypto.randomUUID(),
      userId: user.id,
      familyId,
      hash,
      generation: 1,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600_000), // 30 days
    });

    // Return both tokens in JSON body — NO Set-Cookie header
    return { accessToken, refreshToken: plain };
  },
);
```

**Response:** `{ accessToken: string, refreshToken: string }`

**Security:** This is a **separate endpoint** — the existing `POST /v1/auth/login`
continues to return only `{ accessToken }` via a cookie for the refresh token.
The web app is never exposed to raw refresh tokens in response bodies.

#### 7.2.2 `POST /v1/auth/refresh-body`

New route file: `apps/api/src/modules/auth/refresh-body.routes.ts`

```ts
// Reuses the same token rotation + family logic as /v1/auth/refresh.
// Difference: reads refreshToken from body, returns new refreshToken in JSON.
app.post(
  '/v1/auth/refresh-body',
  {
    schema: { body: z.object({ refreshToken: z.string() }) },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  },
  async (req, reply) => {
    const { refreshToken } = req.body;
    // ... same rotation/validation/family logic as /v1/auth/refresh ...
    // On 'rotated':
    return { accessToken, refreshToken: newRefreshPlain };
    // On 'reissue':
    return { accessToken, refreshToken: null }; // no rotation needed
    // On 'invalid':
    throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
  },
);
```

**Key difference from cookie-based `/v1/auth/refresh`:**
- Reads `refreshToken` from `req.body` instead of `req.cookies`
- Returns the **rotated refresh token** in the JSON body (for SecureStore
  persistence) instead of setting a `Set-Cookie` header
- Does **not** call `reply.setCookie()` — the mobile app handles storage

**Response shapes:**
- `rotated`: `{ accessToken: string, refreshToken: string }`
- `reissue`: `{ accessToken: string, refreshToken: null }`
- `invalid`: 401 `{ error: 'INVALID_REFRESH' }`

#### 7.2.3 `POST /v1/auth/logout-mobile`

New route file: `apps/api/src/modules/auth/logout-mobile.routes.ts`

The existing `POST /v1/auth/logout` reads the refresh token from a cookie to
invalidate the token family in the DB. Since mobile doesn't send cookies, the
logout call would return 200 but the refresh token stays valid — a stolen device
would retain access for 30 days despite logout.

```ts
app.post(
  '/v1/auth/logout-mobile',
  {
    schema: { body: z.object({ refreshToken: z.string() }) },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  },
  async (req, reply) => {
    const { refreshToken } = req.body;

    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    // Mark the entire token family as consumed (invalidate all siblings)
    const [row] = await app.db
      .select({ familyId: schema.refreshTokens.familyId })
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.hash, hash))
      .limit(1);

    if (row) {
      await app.db
        .update(schema.refreshTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.refreshTokens.familyId, row.familyId));
    }

    return { ok: true };
  },
);
```

**Mobile logout flow:**
1. Read `refreshToken` from SecureStore
2. `POST /v1/auth/logout-mobile { refreshToken }`
3. Clear both tokens from memory and SecureStore
4. Navigate to Login

#### 7.2.4 No other backend changes

Every other admin endpoint in `apps/api` works as-is with React Native's
`fetch()`. The mobile app sends the same JSON bodies and receives the same
JSON responses. The JWT `Authorization: Bearer` header is identical.

---

## 8. Build & CI/CD

### 8.1 Development

```bash
pnpm admin-mobile:dev
```

Runs the Expo dev server (requires the root-level alias defined in §1.7).
Connect via:
- Android Emulator
- Physical Android device via Expo Go app (QR code scan)

**Android cleartext HTTP:** Android 9+ blocks HTTP by default. The dev
`app.config.js` enables `usesCleartextTraffic` when `APP_ENV` is not
`production`. In production builds (via `eas.json`), `APP_ENV=production`
disables cleartext — all traffic goes over HTTPS.

API URL configured via `Constants.expoConfig.extra.apiUrl` (from `app.config.js` → `expo.extra.apiUrl`)

### 8.2 EAS Build

```json
// eas.json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "distribution": "store",
      "env": { "APP_ENV": "production" }
    }
  }
}
```

### 8.3 CI pipeline (GitHub Actions)

```yaml
# .github/workflows/admin-mobile.yml
name: Admin Mobile

on:
  push:
    branches: [main]
    paths: ['apps/admin-mobile/**', 'packages/types/**']
  pull_request:
    paths: ['apps/admin-mobile/**', 'packages/types/**']

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @aivastra/types build
      - run: pnpm --filter @aivastra/types build:cjs
      - run: pnpm --filter @aivastra/admin-mobile typecheck

  build-preview:
    needs: typecheck
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @aivastra/types build && pnpm --filter @aivastra/types build:cjs
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - run: eas build --platform android --profile preview --non-interactive
        working-directory: apps/admin-mobile
```

**Required GitHub Secrets:**
- `EXPO_TOKEN` — Expo access token with EAS Build permissions
- `EAS_PROJECT_ID` — set as repo variable, referenced in `app.config.js`

---

## 9. Phased Implementation Plan

**Each phase deliverable includes:** skeleton loaders, empty states, error
boundaries, pull-to-refresh, and tablet-responsive layouts for every screen
built in that phase. There is no trailing "Polish" phase — quality is
built-in from the start.

| Phase | Features | Screens | API Endpoints |
|-------|----------|---------|---------------|
| **1. Foundation** | Expo init, navigation skeleton, theme tokens, auth store, API client, login screen (with loading/error states) | 4 | `/v1/auth/login-mobile`, `/v1/auth/refresh-body`, `/v1/auth/logout-mobile`, `/admin/me` |
| **2. Dashboard + Jobs** | Dashboard stats, Worker list, Job list + detail + SSE, FilterChips, pull-to-refresh, skeleton cards | 4 | `/admin/stats`, `/admin/workers`, `/admin/jobs`, `/admin/jobs/:id`, `/admin/jobs/:id/cancel`, `/admin/jobs/:id/retry`, `/admin/jobs/stream` |
| **3. Users** | User list, search, detail, grant credits, ban/unban, skeleton rows, empty state | 3 | `/admin/users`, `/admin/users/:id`, `/admin/credits/grant`, `PATCH /admin/users/:id` |
| **4. Assets — Core** | Faces CRUD, Backgrounds CRUD, upload flow with progress, ImagePreview, skeleton grids | 8 | All `/admin/assets/faces/*`, `/admin/assets/backgrounds/*` |
| **5. Assets — Advanced** | Garment Types, Poses, Pose Assets, mapping flows, bulk ops, long-press select mode | 12 | All `/admin/assets/poses/*`, `/admin/assets/pose-assets/*`, `/admin/assets/garment-types/*` |
| **6. Catalog** | Category tree, lower/shoes items, batch upload, subcategory mapping | 6 | All `/admin/catalog/*` |
| **7. Workflows + Recycle Bin** | Workflow upload/parse/edit/reassign, recycle bin restore/delete | 5 | All `/admin/workflows/*`, `/admin/assets/recycle-bin` |
| **8. Settings + Config** | Credit plans CRUD, system config, theme toggle | 3 | All `/admin/credit-plans/*`, `/admin/config` |

**Total: ~46 screens, ~60 API endpoints**

### Phase dependencies

```
Phase 1 ──► Phase 2 ──► Phase 3
              │
              └──► Phase 4 ──► Phase 5 ──► Phase 6
                                   │
                                   └──► Phase 7 ──► Phase 8
```

Phases 3, 4, and 7 can be parallelized across developers since they touch
independent API domains.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SSE not working reliably in RN | Job status won't update live | Fall back to polling (15s interval). The custom fetch-based reader (§3.3) has been tested on Hermes (Android). |
| Image upload performance on slow mobile networks | Poor UX during multi-file uploads | Compress before upload, show per-file progress via XMLHttpRequest, offer cancel per file |
| 45 SVG icons to port manually | Time-consuming | Batch port using a conversion script; validate visually in Storybook or Expo dev |
| `expo-secure-store` not encrypting on some devices | Credential storage falls back to unencrypted | `expo-secure-store` uses Android Keystore (API 23+) — available on the Android 12+ target. No fallback needed. |
| Long asset forms on small screens | Hard to use on phones | Break into multi-step wizards; use bottom sheets for secondary actions |
| 46 screens = large bundle | Slow app startup | Lazy-load tab stacks via `React.lazy`; assets cached; optimize image sizes |

---

## 11. File Migration Map (Web → Mobile)

| Web File (`apps/admin/`) | Mobile File (`apps/admin-mobile/`) | Action |
|--------------------------|-----------------------------------|--------|
| `src/context/AuthContext.tsx` | `src/store/auth.ts` | Rewrite (Zustand + SecureStore) |
| `src/lib/data.ts` | `src/lib/api.ts` | Port (same logic, adapt cookies) |
| `src/lib/sse.ts` | `src/lib/sse.ts` | Port (EventSource → ReadableStream) |
| `src/lib/thumbnail.ts` | `src/lib/thumbnail.ts` | Rewrite (Canvas → expo-image-manipulator) |
| `src/types.ts` | `src/types.ts` | Copy + add RN-specific types |
| `src/components/Icons.tsx` | `src/components/Icons.tsx` | Port (SVG → react-native-svg) |
| `src/components/StatusBadge.tsx` | `src/components/StatusBadge.tsx` | Rewrite (div → View, span → Text) |
| `src/components/ConfirmModal.tsx` | `src/components/ConfirmDialog.tsx` | Rewrite (modal → Alert/bottom sheet) |
| `src/components/Switch.tsx` | — | Use RN `Switch` |
| `src/components/Pager.tsx` | — | Use endless scroll (FlatList) |
| `src/components/KV.tsx` | `src/components/KeyValueRow.tsx` | Rewrite |
| `src/components/NameAvatar.tsx` | `src/components/NameAvatar.tsx` | Rewrite |
| `src/components/ToastStack.tsx` | `src/components/Toast.tsx` | Rewrite (RN Animated) |
| `src/components/UploadModal.tsx` | Per-asset upload screens | Rewrite (multi-step screens) |
| `src/styles/tokens.css` | `src/styles/tokens.ts` | Port (CSS vars → JS constants) |
| `src/pages/DashboardPage.tsx` | `src/app/(tabs)/home.tsx` | Rewrite |
| `src/pages/JobsPage.tsx` | `src/app/(tabs)/jobs/index.tsx` + `[id].tsx` | Rewrite |
| `src/pages/AssetsPage.tsx` | Multiple screens under `assets/` | Split into 15+ screens |
| `src/pages/UsersPage.tsx` | `src/app/(tabs)/more/users/` | Rewrite |
| `src/pages/WorkflowsPage.tsx` | `src/app/(tabs)/more/workflows/` | Rewrite |
| `src/pages/RecycleBinPage.tsx` | `src/app/(tabs)/more/recycle-bin/` | Rewrite |
| `src/pages/SettingsPage.tsx` | `src/app/(tabs)/more/settings/` + `config.tsx` | Split |
| `src/components/Topbar.tsx` | — | Omit (native stack headers) |
| `src/components/Sidebar.tsx` | Bottom tab bar | Native tab navigator |
