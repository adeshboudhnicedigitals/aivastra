# Developer Try-On API — Quickstart

Send a person photo and a garment photo, get back a generated try-on image. This is the
server-to-server API — no browser, no cookies, no admin-curated faces/poses. Just two
images, a category, and a poll loop.

Base URL in this guide: `http://localhost:4000` (dev). In production, use your deployment's
API host.

## 1. Authentication

Every request carries your API key as a bearer token:

```
Authorization: Bearer sk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Get a key from the **Developers** dashboard (`/developers` in the web app) after your
merchant account has been activated by an admin. Click **Create key** — the full key is
shown **exactly once**, at creation time. It is stored server-side only as a salted hash;
if you lose the key, revoke it and create a new one, you cannot recover the original value.

Treat the key like any other server secret:

- Never embed it in browser/client-side JavaScript, a mobile app binary, or a public repo.
- Call `/v1/dev/*` only from your own backend.
- Keep multiple keys (one per environment) so you can rotate one without downtime — revoking
  a key does not affect your other keys.

A missing, malformed, or revoked key returns `401 UNAUTHORIZED` (see the error table below).

## 2. The three-call flow

1. **`GET /v1/dev/categories`** — list the garment categories your merchant account can
   submit jobs for. Pick a `slug` from the response.
2. **`POST /v1/dev/tryon`** — multipart upload: a `person` image, a `garment` image, and the
   chosen `category` slug. Returns `202` with a `jobId` immediately; generation happens
   asynchronously.
3. **`GET /v1/dev/jobs/:id`** — poll until `status` is `COMPLETED` (with an `imageUrl`) or
   `FAILED` (with an `error`).

Optionally call **`GET /v1/dev/me`** any time as a key smoke test — it returns your
`merchantId`, `companyName`, and current credit balance.

## 3. curl example — full flow

```bash
export API_KEY="sk_live_abc123def456ghi789jkl012mno345pqr678stu9"
export API_URL="http://localhost:4000"

# 1. List categories
curl -s "$API_URL/v1/dev/categories" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool
# => {"categories": [{"slug": "upper", "name": "Upper Body"}, ...]}

# 2. Create a try-on job (person.jpg and garment.jpg are local files)
curl -s -X POST "$API_URL/v1/dev/tryon" \
  -H "Authorization: Bearer $API_KEY" \
  -F "category=upper" \
  -F "person=@person.jpg" \
  -F "garment=@garment.jpg"
# => {"jobId": "5f2b1a3e-9c4d-4e2a-8f1b-1234567890ab", "status": "QUEUED"}

# 3. Poll for the result (repeat until status is COMPLETED or FAILED)
curl -s "$API_URL/v1/dev/jobs/5f2b1a3e-9c4d-4e2a-8f1b-1234567890ab" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool
# => {"jobId": "...", "status": "RUNNING"}
# => {"jobId": "...", "status": "COMPLETED", "imageUrl": "https://.../result.png?X-Amz-..."}
```

`imageUrl` is a presigned URL valid for **15 minutes**. If it expires before you download
it, call `GET /v1/dev/jobs/:id` again — it reissues a fresh presigned URL for the same
completed job.

## 4. Node.js example — `FormData` + `fetch` with a backing-off poll loop

Requires Node 20+ (global `fetch`, `FormData`, and `Blob` — no extra dependencies).

```js
import { readFileSync } from 'node:fs';

const API_URL = process.env.DEV_API_URL ?? 'http://localhost:4000';
const API_KEY = process.env.DEV_API_KEY; // e.g. "sk_live_abc123def456ghi789jkl012mno345pqr678stu9"

if (!API_KEY) {
  throw new Error('Set DEV_API_KEY to your sk_live_... key before running this script.');
}

async function createTryon({ category, personPath, garmentPath }) {
  const form = new FormData();
  form.append('category', category);
  form.append('person', new Blob([readFileSync(personPath)], { type: 'image/jpeg' }), 'person.jpg');
  form.append('garment', new Blob([readFileSync(garmentPath)], { type: 'image/jpeg' }), 'garment.jpg');

  const res = await fetch(`${API_URL}/v1/dev/tryon`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`create failed: ${body.error.code} — ${body.error.message}`);
  }
  return body; // { jobId, status: "QUEUED" }
}

async function pollJob(jobId, { maxAttempts = 20, initialDelayMs = 2000, maxDelayMs = 20000 } = {}) {
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${API_URL}/v1/dev/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(`poll failed: ${body.error.code} — ${body.error.message}`);
    }

    if (body.status === 'COMPLETED') return body.imageUrl;
    if (body.status === 'FAILED') throw new Error(`job ${jobId} failed: ${body.error}`);

    // QUEUED or RUNNING — back off (capped) and try again.
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, maxDelayMs);
  }

  throw new Error(`gave up polling job ${jobId} after ${maxAttempts} attempts`);
}

const { jobId } = await createTryon({
  category: 'upper',
  personPath: './person.jpg',
  garmentPath: './garment.jpg',
});
console.log('job created:', jobId);

const imageUrl = await pollJob(jobId);
console.log('done:', imageUrl);
```

With the defaults above (2s initial delay, ×1.5 backoff, 20s cap, 20 attempts) the loop
gives up after a little over 5 minutes. Tune `maxAttempts`/`maxDelayMs` to your own
tolerance for generation latency.

## 5. Errors

Every error response has the same envelope:

```json
{ "error": { "code": "VALIDATION", "message": "category is required" } }
```

| Code | HTTP status | When it happens |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/malformed `Authorization` header, unknown or revoked key, or the key's merchant account is deactivated. Message is intentionally generic for all of these — key existence is never disclosed. |
| `VALIDATION` | 400 | Missing `category` field, missing `person` or `garment` file, an unexpected multipart field name, a file over 10MB, or a file that fails the image-type check. |
| `BAD_CATEGORY` | 400 | The `category` slug doesn't match an active category, or its category has no active workflow configured. No credits are charged. |
| `INSUFFICIENT_CREDITS` | 402 | Your merchant credit balance is too low to cover this job's cost. No job is created. |
| `NOT_FOUND` | 404 | The job ID doesn't exist, or belongs to a different merchant. Returned as 404 (not 403) so job IDs aren't enumerable. |
| `RATE_LIMIT` | 429 | You've exceeded 60 requests/minute on this key. Response includes a `Retry-After` header — wait that long before retrying. |
| `ENQUEUE_FAIL` | 503 | The job was accepted but couldn't be queued for processing (transient infra issue). Credits already charged are **automatically refunded**; retry the request. |
| `FORBIDDEN` | 403 | Your merchant account is suspended. Contact support. |

A `500 INTERNAL` is also possible on unexpected server errors; if you see one repeatedly,
contact support with the `jobId` (if any) and approximate timestamp.

## 6. Limits

| Limit | Value |
|---|---|
| Rate limit | 60 requests/minute per API key (`429 RATE_LIMIT` + `Retry-After` header past that) |
| Max image size | 10MB per file (`person` and `garment` each) |
| Accepted image types | JPEG, PNG, WebP — detected by file content (magic bytes), not by the filename or the `Content-Type` you send |
| Files per request | Exactly 2 (`person` and `garment`) |
| Result URL expiry | Presigned `imageUrl` is valid for 900 seconds (15 minutes). If it expires, call `GET /v1/dev/jobs/:id` again for a fresh one — the underlying result doesn't disappear, only the signed link does. |

## 7. Credits

Each `POST /v1/dev/tryon` call costs a fixed number of credits — the same admin-configured
try-on price used elsewhere in the product (check `GET /v1/dev/me` for your current
balance). Credits are deducted atomically at job creation, before the job is queued:

- If your balance is too low, the call fails with `402 INSUFFICIENT_CREDITS` and **no job
  is created** — you're never charged for a rejected request.
- If the job is accepted but fails to queue (`503 ENQUEUE_FAIL`) or later fails during
  generation, the credits charged for it are **refunded automatically** — no action needed
  on your end.
- Successful jobs (`COMPLETED`) are not refunded.

Credit top-ups are managed the same way as any other merchant credit balance — talk to
your account admin.
