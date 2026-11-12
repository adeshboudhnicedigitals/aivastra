# virtual_tryon_android_merchant (test copy)

A copy of `apps/virtual_tryon_android_multi_flow`, taken 2026-11-12, for building and testing the
**Merchant Android** integration against the API: device pairing (`/v1/device/pair`), kiosk and
assisted sessions, in-session try-ons, sold/cart, and event upload (`/v1/device/events`).

**This is not the production app.** Another developer owns the real Merchant Android work in
`virtual_tryon_android_multi_flow`. Keep integration code here in self-contained files (API
client, session state) so it can be ported across, and do not ship this APK to stores.

## Differences from the original

| | Original | This copy |
|---|---|---|
| applicationId | `aivastra.nice.interactive` | `aivastra.nice.interactive.merchanttest` (installs side by side) |
| Backend | hard-coded `https://app.aivastra.com/` | `BuildConfig.API_BASE_URL`, default `http://localhost:4000/`. **Production is refused at build time** |
| Firebase / Crashlytics | on | removed: `CrashReporter` logs locally only |
| Cleartext HTTP | none | `localhost`, `127.0.0.1`, `10.0.2.2` only (`res/xml/network_security_config.xml`) |

Still pointing at production, but read-only: the pricing, try-on-library and kiosk-download web links
(`NavGraph.kt`, `DownloadPage.kt`). A QR for a locally created job will not resolve. Google sign-in
is probably broken in this copy, because the OAuth client is tied to the original package id.

## Run against the local stack

```bash
pnpm docker:up && pnpm db:migrate && pnpm --filter @aivastra/api dev   # repo root
adb reverse tcp:4000 tcp:4000                                         # tablet on USB
cd apps/virtual_tryon_android_merchant && ./gradlew installDebug
```

Emulator instead of a USB tablet: `./gradlew installDebug -PaivastraApiBaseUrl=http://10.0.2.2:4000/`.
Staging: `-PaivastraApiBaseUrl=https://staging-app.aivastra.com/`.
