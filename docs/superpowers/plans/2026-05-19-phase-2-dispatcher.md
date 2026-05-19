# Phase 2 — Dispatcher Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/dispatcher` — the service that consumes Redis Streams, orchestrates ComfyUI GPU workers via Cloudflare Tunnel, and drives jobs from QUEUED through COMPLETED (or FAILED with credit refund).

**Architecture:** A single long-running Node.js process with four concurrent loops: (1) priority-aware stream consumer via `XREADGROUP`, (2) health monitor probing each worker every 15s and setting a 30s-TTL Redis key, (3) a crash-recovery sweep of `XPENDING` entries on startup, and (4) a lightweight HTTP health server on port 4100. Each job follows the state machine `QUEUED → PREPROCESSING → GENERATING → UPLOADING → COMPLETED | FAILED`. On terminal failure (`attempts >= 2`), credits are refunded transactionally using the existing `refund()` helper from `@aivastra/db`.

**Tech Stack:** Node 20, TypeScript 5.6, ESM, ioredis, Drizzle ORM (postgres-js), @aivastra/db + @aivastra/storage + @aivastra/logger (workspace packages), `ws` (WebSocket), Vitest integration tests

---

## Pre-flight: Contracts from Phase 1 (read-only reference)

| What | Value |
|---|---|
| Redis stream names | `jobs:priority`, `jobs:normal` |
| Stream message fields | `jobId` (uuid), `userId` (uuid) |
| SSE pub/sub channel | `sse:events:{userId}` |
| SSE message shape | `{ jobId, type, status?, progress?, error? }` |
| Garment R2 key | `inputs/{jobId}/garment.jpg` — from `@aivastra/storage` `keys.inputGarment(jobId)` |
| Output R2 key | `outputs/{jobId}/result.png` — from `keys.output(jobId)` |
| Catalog R2 key | `catalog/{typeSlug}/{id}.jpg` — from `keys.catalogItem(typeSlug, id)` |
| Credit refund fn | `refund(db, userId, amount, jobId, reason)` in `packages/db` (idempotent) |
| Consumer group | `dispatcher-cg` |
| Worker registry key | `worker:registry` (Redis hash, field=workerId, value=JSON) |
| Worker health key | `worker:health:{workerId}` (Redis string, 30s TTL) |

---

## File Structure

```
apps/dispatcher/
  src/
    env.ts                    # Zod-validated process.env
    index.ts                  # Entry: starts all loops
    lib/
      db.ts                   # createDb wrapper
      redis.ts                # Two ioredis connections: main + subscriber
      storage.ts              # createR2Provider from env
    worker/
      registry.ts             # Worker type + HGETALL/HSET helpers
      health-monitor.ts       # 15s probe loop → set worker:health:{id} EXAT 30s
      selector.ts             # selectWorker() — Lua atomic IDLE→BUSY claim
    workflow/
      patcher.ts              # Deep-clone template + inject 5 R2 URLs
    comfyui/
      client.ts               # POST /prompt, GET /history/{id}, GET /view?filename=
      progress.ts             # WebSocket listener → resolves on execution_complete/error
    job/
      state.ts                # transitionJob() DB update + redis.publish SSE event
      processor.ts            # Orchestrates steps: fetch inputs → patch → submit → wait → upload → complete
    stream/
      consumer.ts             # Priority-aware XREADGROUP loop
      recovery.ts             # XPENDING sweep on startup (claim idle > 60s)
    health/
      server.ts               # http.createServer GET /health → 200 on port 4100
  test/
    helpers/
      containers.ts           # Fresh Postgres DB + Redis flush + MinIO bucket per test
      comfy-mock.ts           # Mock ComfyUI HTTP + WebSocket server
    integration/
      happy-path.test.ts      # QUEUED → PREPROCESSING → GENERATING → UPLOADING → COMPLETED
      retry.test.ts           # Failure → retry → FAILED + credit refund
      recovery.test.ts        # XPENDING claim on startup
  package.json
  tsconfig.json
  vitest.config.ts
  Dockerfile

templates/
  virtual-tryon-v1.json       # Workflow template (STUB — replace with real ComfyUI export)
```

---

## Task 1: Dispatcher package scaffold

**Files:**
- Create: `apps/dispatcher/package.json`
- Create: `apps/dispatcher/tsconfig.json`
- Create: `apps/dispatcher/vitest.config.ts`

- [ ] **Step 1.1: Create `apps/dispatcher/package.json`**

```json
{
  "name": "@aivastra/dispatcher",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run --reporter=verbose"
  },
  "dependencies": {
    "@aivastra/db": "workspace:*",
    "@aivastra/logger": "workspace:*",
    "@aivastra/storage": "workspace:*",
    "@aivastra/types": "workspace:*",
    "@aws-sdk/client-s3": "^3.600.0",
    "ioredis": "^5.3.2",
    "ws": "^8.17.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.10",
    "tsx": "^4.11.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 1.2: Create `apps/dispatcher/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 1.3: Create `apps/dispatcher/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

- [ ] **Step 1.4: Install dependencies**

```bash
pnpm install
```

Expected: lockfile updated, no errors.

- [ ] **Step 1.5: Commit**

```bash
git add apps/dispatcher/package.json apps/dispatcher/tsconfig.json apps/dispatcher/vitest.config.ts
git commit -m "chore(dispatcher): scaffold package"
```

---

## Task 2: Environment validation

**Files:**
- Create: `apps/dispatcher/src/env.ts`

- [ ] **Step 2.1: Create `apps/dispatcher/src/env.ts`**

```typescript
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('debug'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  R2_ENDPOINT: z.string().url(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET: z.string(),
  R2_PUBLIC_URL: z.string().url(),
  R2_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  DISPATCHER_HEALTH_PORT: z.coerce.number().default(4100),
  // Comma-separated: "worker-a,worker-b"
  WORKER_IDS: z.string().min(1),
  // Per-worker: WORKER_A_URL, WORKER_B_URL (resolved from WORKER_IDS)
  CF_ACCESS_CLIENT_ID: z.string(),
  CF_ACCESS_CLIENT_SECRET: z.string(),
  // How long a pending stream entry must be idle before recovery claims it (ms)
  XPENDING_CLAIM_THRESHOLD_MS: z.coerce.number().default(60_000),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(): Env {
  return Env.parse(process.env);
}

/** Read per-worker URL from env: WORKER_A_URL, WORKER_B_URL, etc. */
export function workerUrl(env: NodeJS.ProcessEnv, workerId: string): string {
  const key = `WORKER_${workerId.toUpperCase().replace(/-/g, '_')}_URL`;
  const val = env[key];
  if (!val) throw new Error(`Missing env var ${key} for worker ${workerId}`);
  return val;
}
```

- [ ] **Step 2.2: Commit**

```bash
git add apps/dispatcher/src/env.ts
git commit -m "feat(dispatcher): env validation"
```

---

## Task 3: Lib layer — DB, Redis, Storage

**Files:**
- Create: `apps/dispatcher/src/lib/db.ts`
- Create: `apps/dispatcher/src/lib/redis.ts`
- Create: `apps/dispatcher/src/lib/storage.ts`

- [ ] **Step 3.1: Create `apps/dispatcher/src/lib/db.ts`**

```typescript
import { createDb } from '@aivastra/db';
import type { Env } from '../env.js';

export function makeDb(env: Env) {
  return createDb(env.DATABASE_URL);
}
```

- [ ] **Step 3.2: Create `apps/dispatcher/src/lib/redis.ts`**

```typescript
import { Redis } from 'ioredis';
import type { Env } from '../env.js';

export function makeRedis(env: Env) {
  const main = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: null });
  const pub = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: null });
  async function close() {
    main.disconnect();
    pub.disconnect();
  }
  return { main, pub, close };
}
```

- [ ] **Step 3.3: Create `apps/dispatcher/src/lib/storage.ts`**

```typescript
import { createR2Provider } from '@aivastra/storage';
import type { Env } from '../env.js';

export function makeStorage(env: Env) {
  return createR2Provider({
    endpoint: env.R2_ENDPOINT,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicUrl: env.R2_PUBLIC_URL,
    forcePathStyle: env.R2_FORCE_PATH_STYLE,
  });
}
```

- [ ] **Step 3.4: Commit**

```bash
git add apps/dispatcher/src/lib/
git commit -m "feat(dispatcher): lib layer (db/redis/storage)"
```

---

## Task 4: Worker registry types + helpers

**Files:**
- Create: `apps/dispatcher/src/worker/registry.ts`

Worker status follows: `IDLE | BUSY | DRAINING`. The registry hash (`worker:registry`) stores JSON per worker. Health is tracked separately via TTL key `worker:health:{workerId}`.

- [ ] **Step 4.1: Create `apps/dispatcher/src/worker/registry.ts`**

```typescript
import type { Redis } from 'ioredis';

export type WorkerStatus = 'IDLE' | 'BUSY' | 'DRAINING';

export interface WorkerEntry {
  url: string;
  status: WorkerStatus;
  lastSeen: number; // unix ms
}

export const REGISTRY_KEY = 'worker:registry';

export function healthKey(workerId: string) {
  return `worker:health:${workerId}`;
}

export async function getWorkers(redis: Redis): Promise<Map<string, WorkerEntry>> {
  const raw = await redis.hgetall(REGISTRY_KEY);
  const map = new Map<string, WorkerEntry>();
  for (const [id, json] of Object.entries(raw)) {
    try { map.set(id, JSON.parse(json) as WorkerEntry); } catch { /* skip malformed */ }
  }
  return map;
}

export async function setWorkerStatus(
  redis: Redis,
  workerId: string,
  status: WorkerStatus,
): Promise<void> {
  const workers = await getWorkers(redis);
  const entry = workers.get(workerId);
  if (!entry) return;
  entry.status = status;
  entry.lastSeen = Date.now();
  await redis.hset(REGISTRY_KEY, workerId, JSON.stringify(entry));
}

export async function registerWorkers(
  redis: Redis,
  workers: Array<{ id: string; url: string }>,
): Promise<void> {
  for (const w of workers) {
    const existing = await redis.hget(REGISTRY_KEY, w.id);
    if (!existing) {
      const entry: WorkerEntry = { url: w.url, status: 'IDLE', lastSeen: Date.now() };
      await redis.hset(REGISTRY_KEY, w.id, JSON.stringify(entry));
    }
  }
}
```

- [ ] **Step 4.2: Commit**

```bash
git add apps/dispatcher/src/worker/registry.ts
git commit -m "feat(dispatcher): worker registry helpers"
```

---

## Task 5: Worker health monitor

**Files:**
- Create: `apps/dispatcher/src/worker/health-monitor.ts`

Probes `/system_stats` on each registered worker every 15s. On success: `SETEX worker:health:{id} 30 "1"`. On failure: key expires naturally (30s TTL).

- [ ] **Step 5.1: Create `apps/dispatcher/src/worker/health-monitor.ts`**

```typescript
import type { Redis } from 'ioredis';
import type { Logger } from '@aivastra/logger';
import { getWorkers, healthKey, setWorkerStatus } from './registry.js';

const PROBE_INTERVAL_MS = 15_000;
const HEALTH_TTL_SEC = 30;

async function probeWorker(
  workerId: string,
  workerUrl: string,
  cfClientId: string,
  cfClientSecret: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${workerUrl}/system_stats`, {
      headers: {
        'CF-Access-Client-Id': cfClientId,
        'CF-Access-Client-Secret': cfClientSecret,
      },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function startHealthMonitor(
  redis: Redis,
  cfClientId: string,
  cfClientSecret: string,
  log: Logger,
): () => void {
  let running = true;

  async function tick() {
    const workers = await getWorkers(redis);
    for (const [id, entry] of workers) {
      if (entry.status === 'DRAINING') continue;
      const healthy = await probeWorker(id, entry.url, cfClientId, cfClientSecret);
      if (healthy) {
        await redis.setex(healthKey(id), HEALTH_TTL_SEC, '1');
        log.debug({ workerId: id }, 'worker healthy');
      } else {
        log.warn({ workerId: id }, 'worker unhealthy — health key not renewed');
      }
    }
  }

  const interval = setInterval(async () => {
    if (!running) return;
    try { await tick(); } catch (err) { log.error({ err }, 'health monitor tick error'); }
  }, PROBE_INTERVAL_MS);

  // Run immediately on start
  tick().catch((err) => log.error({ err }, 'health monitor initial tick error'));

  return () => {
    running = false;
    clearInterval(interval);
  };
}
```

- [ ] **Step 5.2: Commit**

```bash
git add apps/dispatcher/src/worker/health-monitor.ts
git commit -m "feat(dispatcher): worker health monitor (15s probe, 30s TTL)"
```

---

## Task 6: Worker selector — atomic Lua claim

**Files:**
- Create: `apps/dispatcher/src/worker/selector.ts`

Uses a Redis Lua script to atomically find the first `IDLE` worker with a healthy health key and transition it to `BUSY`. Returns `null` if no worker is available.

- [ ] **Step 6.1: Create `apps/dispatcher/src/worker/selector.ts`**

```typescript
import type { Redis } from 'ioredis';
import { REGISTRY_KEY, healthKey } from './registry.js';

// Lua script: atomically find first IDLE+healthy worker, mark BUSY, return {id, url}
const CLAIM_LUA = `
local fields = redis.call('HGETALL', KEYS[1])
for i = 1, #fields, 2 do
  local id = fields[i]
  local ok, val = pcall(cjson.decode, fields[i+1])
  if ok and val.status == 'IDLE' then
    if redis.call('EXISTS', KEYS[2] .. id) == 1 then
      val.status = 'BUSY'
      val.lastSeen = tonumber(ARGV[1])
      redis.call('HSET', KEYS[1], id, cjson.encode(val))
      return {id, val.url}
    end
  end
end
return false
`;

export interface ClaimedWorker {
  id: string;
  url: string;
}

export async function selectWorker(redis: Redis): Promise<ClaimedWorker | null> {
  const healthPrefix = healthKey(''); // "worker:health:"
  const result = await redis.eval(
    CLAIM_LUA,
    2,
    REGISTRY_KEY,
    healthPrefix,
    String(Date.now()),
  ) as [string, string] | false | null;

  if (!result || result === false) return null;
  return { id: result[0]!, url: result[1]! };
}
```

- [ ] **Step 6.2: Commit**

```bash
git add apps/dispatcher/src/worker/selector.ts
git commit -m "feat(dispatcher): atomic worker selector (Lua IDLE→BUSY claim)"
```

---

## Task 7: Workflow template stub + patcher

**Files:**
- Create: `templates/virtual-tryon-v1.json`
- Create: `apps/dispatcher/src/workflow/patcher.ts`

> **BLOCKING:** This stub must be replaced with the real ComfyUI workflow export (API format) before Phase 4 E2E testing. See `infra/cloudflared/README.md` for setup instructions. Document actual node IDs after export.

- [ ] **Step 7.1: Create `templates/virtual-tryon-v1.json`**

```json
{
  "_meta": {
    "version": "v1",
    "note": "STUB — replace with real ComfyUI workflow API export before Phase 4 E2E. Node IDs below are placeholders. See docs/PHASES.md §2A for export instructions."
  },
  "prompt": {
    "upper_garment_loader": {
      "class_type": "LoadImage",
      "inputs": {
        "image": "__AIVASTRA_UPPER_GARMENT_URL__",
        "upload": "image"
      }
    },
    "model_loader": {
      "class_type": "LoadImage",
      "inputs": {
        "image": "__AIVASTRA_MODEL_URL__",
        "upload": "image"
      }
    },
    "pose_loader": {
      "class_type": "LoadImage",
      "inputs": {
        "image": "__AIVASTRA_POSE_URL__",
        "upload": "image"
      }
    },
    "background_loader": {
      "class_type": "LoadImage",
      "inputs": {
        "image": "__AIVASTRA_BACKGROUND_URL__",
        "upload": "image"
      }
    },
    "lower_garment_loader": {
      "class_type": "LoadImage",
      "inputs": {
        "image": "__AIVASTRA_LOWER_GARMENT_URL__",
        "upload": "image"
      }
    },
    "output_saver": {
      "class_type": "SaveImage",
      "inputs": {
        "filename_prefix": "__AIVASTRA_OUTPUT_PREFIX__",
        "images": ["final_node", 0]
      }
    }
  }
}
```

- [ ] **Step 7.2: Create `apps/dispatcher/src/workflow/patcher.ts`**

```typescript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Loaded once at startup, then cloned per job
const TEMPLATE_PATH = resolve(process.cwd(), '../../templates/virtual-tryon-v1.json');

let _template: unknown | null = null;

function loadTemplate(): unknown {
  if (_template) return _template;
  const raw = readFileSync(TEMPLATE_PATH, 'utf-8');
  _template = JSON.parse(raw);
  return _template;
}

export interface WorkflowInputs {
  upperGarmentUrl: string;
  modelUrl: string;
  poseUrl: string;
  backgroundUrl: string;
  lowerGarmentUrl: string;
  outputPrefix: string;
}

/**
 * Returns a deep-cloned workflow prompt with all placeholder URLs replaced.
 * The returned object is the `prompt` field suitable for POST /prompt body.
 */
export function patchWorkflow(inputs: WorkflowInputs): Record<string, unknown> {
  const tpl = loadTemplate() as { prompt: Record<string, unknown> };
  // Deep clone to avoid mutating the cached template
  const patched = JSON.parse(JSON.stringify(tpl.prompt)) as Record<string, unknown>;

  const replacements: Record<string, string> = {
    '__AIVASTRA_UPPER_GARMENT_URL__': inputs.upperGarmentUrl,
    '__AIVASTRA_MODEL_URL__': inputs.modelUrl,
    '__AIVASTRA_POSE_URL__': inputs.poseUrl,
    '__AIVASTRA_BACKGROUND_URL__': inputs.backgroundUrl,
    '__AIVASTRA_LOWER_GARMENT_URL__': inputs.lowerGarmentUrl,
    '__AIVASTRA_OUTPUT_PREFIX__': inputs.outputPrefix,
  };

  // Walk all string values and replace placeholders
  function walk(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return replacements[obj] ?? obj;
    }
    if (Array.isArray(obj)) return obj.map(walk);
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) result[k] = walk(v);
      return result;
    }
    return obj;
  }

  return walk(patched) as Record<string, unknown>;
}
```

- [ ] **Step 7.3: Commit**

```bash
git add templates/virtual-tryon-v1.json apps/dispatcher/src/workflow/patcher.ts
git commit -m "feat(dispatcher): workflow template stub + patcher (inject 5 R2 URLs)"
```

---

## Task 8: ComfyUI HTTP client

**Files:**
- Create: `apps/dispatcher/src/comfyui/client.ts`

Handles: `POST /prompt` (submit job), `GET /history/{promptId}` (fetch output metadata), `GET /view?filename=X&type=output` (download result bytes).

- [ ] **Step 8.1: Create `apps/dispatcher/src/comfyui/client.ts`**

```typescript
export interface ComfySubmitResult {
  promptId: string;
}

export interface ComfyOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

function cfHeaders(clientId: string, clientSecret: string): HeadersInit {
  return {
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
    'Content-Type': 'application/json',
  };
}

export async function submitPrompt(
  workerUrl: string,
  clientId: string,
  clientSecret: string,
  clientUuid: string,
  prompt: Record<string, unknown>,
): Promise<ComfySubmitResult> {
  const res = await fetch(`${workerUrl}/prompt`, {
    method: 'POST',
    headers: cfHeaders(clientId, clientSecret),
    body: JSON.stringify({ prompt, client_id: clientUuid }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI /prompt failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { prompt_id: string };
  return { promptId: json.prompt_id };
}

export async function fetchHistory(
  workerUrl: string,
  clientId: string,
  clientSecret: string,
  promptId: string,
): Promise<ComfyOutputImage[]> {
  const res = await fetch(`${workerUrl}/history/${promptId}`, {
    headers: { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ComfyUI /history failed: ${res.status}`);
  const history = await res.json() as Record<string, unknown>;
  const entry = history[promptId] as { outputs?: Record<string, { images?: ComfyOutputImage[] }> } | undefined;
  if (!entry?.outputs) return [];
  const images: ComfyOutputImage[] = [];
  for (const node of Object.values(entry.outputs)) {
    if (node.images) images.push(...node.images);
  }
  return images;
}

export async function downloadOutputImage(
  workerUrl: string,
  clientId: string,
  clientSecret: string,
  filename: string,
): Promise<Uint8Array> {
  const url = `${workerUrl}/view?filename=${encodeURIComponent(filename)}&type=output`;
  const res = await fetch(url, {
    headers: { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ComfyUI /view failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
```

- [ ] **Step 8.2: Commit**

```bash
git add apps/dispatcher/src/comfyui/client.ts
git commit -m "feat(dispatcher): ComfyUI HTTP client (submit/history/download)"
```

---

## Task 9: ComfyUI WebSocket progress listener

**Files:**
- Create: `apps/dispatcher/src/comfyui/progress.ts`

Connects to ComfyUI's WS endpoint, listens for execution events, resolves when the job completes or rejects on error/timeout.

- [ ] **Step 9.1: Create `apps/dispatcher/src/comfyui/progress.ts`**

```typescript
import WebSocket from 'ws';

export interface ProgressUpdate {
  node: string | null;
  value: number;
  max: number;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

/**
 * Connects to ComfyUI WebSocket and waits for the given promptId to complete.
 * Calls onProgress for intermediate execution_cached / progress events.
 * Resolves when execution_complete; rejects on execution_error or timeout.
 */
export function waitForCompletion(
  workerUrl: string,
  clientId: string,
  clientSecret: string,
  clientUuid: string,
  promptId: string,
  timeoutMs: number = 300_000, // 5 minutes
  onProgress?: ProgressCallback,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = workerUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsUrl}/ws?clientId=${clientUuid}`, {
      headers: {
        'CF-Access-Client-Id': clientId,
        'CF-Access-Client-Secret': clientSecret,
      },
    });

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`ComfyUI WS timeout after ${timeoutMs}ms for prompt ${promptId}`));
    }, timeoutMs);

    ws.on('message', (raw) => {
      let msg: { type: string; data?: Record<string, unknown> };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (!msg.data || (msg.data['prompt_id'] as string | undefined) !== promptId) return;

      if (msg.type === 'progress') {
        onProgress?.({
          node: (msg.data['node'] as string | null) ?? null,
          value: (msg.data['value'] as number) ?? 0,
          max: (msg.data['max'] as number) ?? 1,
        });
      } else if (msg.type === 'execution_complete') {
        clearTimeout(timer);
        ws.close();
        resolve();
      } else if (msg.type === 'execution_error') {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`ComfyUI execution_error: ${JSON.stringify(msg.data)}`));
      }
    });

    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    ws.on('close', (code) => {
      if (code !== 1000 && code !== 1005) {
        clearTimeout(timer);
        reject(new Error(`ComfyUI WS closed unexpectedly: code ${code}`));
      }
    });
  });
}
```

- [ ] **Step 9.2: Commit**

```bash
git add apps/dispatcher/src/comfyui/progress.ts
git commit -m "feat(dispatcher): ComfyUI WS progress listener"
```

---

## Task 10: Job state machine — DB transitions + SSE publish

**Files:**
- Create: `apps/dispatcher/src/job/state.ts`

All job status changes go through `transitionJob()`. Every transition publishes an SSE event to `sse:events:{userId}`.

- [ ] **Step 10.1: Create `apps/dispatcher/src/job/state.ts`**

```typescript
import type { Redis } from 'ioredis';
import { eq, and } from 'drizzle-orm';
import { schema, type DB } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';

export type JobStatus =
  | 'QUEUED'
  | 'PREPROCESSING'
  | 'GENERATING'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'FAILED';

export interface TransitionOptions {
  workerId?: string;
  errorCode?: string;
  resultKey?: string;
}

export async function transitionJob(
  db: DB,
  pub: Redis,
  jobId: string,
  userId: string,
  status: JobStatus,
  opts: TransitionOptions = {},
  log: Logger,
): Promise<void> {
  const now = new Date();
  const patch: Record<string, unknown> = { status };
  if (opts.workerId) patch['workerId'] = opts.workerId;
  if (opts.errorCode) patch['errorCode'] = opts.errorCode;
  if (status === 'GENERATING') patch['startedAt'] = now;
  if (status === 'COMPLETED' || status === 'FAILED') patch['completedAt'] = now;

  await db.update(schema.jobs)
    .set(patch as Parameters<typeof db.update>[0]['set'])
    .where(eq(schema.jobs.id, jobId));

  if (opts.resultKey && status === 'COMPLETED') {
    await db.insert(schema.jobOutputs)
      .values({ jobId, resultKey: opts.resultKey })
      .onConflictDoUpdate({ target: schema.jobOutputs.jobId, set: { resultKey: opts.resultKey } });
  }

  // Record event in DB
  await db.insert(schema.jobEvents).values({
    jobId,
    eventType: status,
    payload: opts as Record<string, unknown>,
  });

  // Publish SSE event
  const ssePayload = JSON.stringify({ jobId, type: 'STATUS', status, ...opts });
  await pub.publish(`sse:events:${userId}`, ssePayload);
  log.info({ jobId, userId, status }, 'job state transition');
}
```

- [ ] **Step 10.2: Commit**

```bash
git add apps/dispatcher/src/job/state.ts
git commit -m "feat(dispatcher): job state machine (DB + SSE publish)"
```

---

## Task 11: Job processor — main orchestration

**Files:**
- Create: `apps/dispatcher/src/job/processor.ts`

The `processJob()` function orchestrates all steps for a single job. It handles catalog resolution, workflow patching, ComfyUI submission, progress waiting, result upload, and state transitions. On error, it increments `attempts` and either re-enqueues or marks FAILED with credit refund.

- [ ] **Step 11.1: Create `apps/dispatcher/src/job/processor.ts`**

```typescript
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { schema, type DB } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import type { StorageProvider } from '@aivastra/storage';
import type { Redis } from 'ioredis';
import type { Logger } from '@aivastra/logger';
import { transitionJob } from './state.js';
import { selectWorker } from '../worker/selector.js';
import { setWorkerStatus } from '../worker/registry.js';
import { patchWorkflow } from '../workflow/patcher.js';
import { submitPrompt, fetchHistory, downloadOutputImage } from '../comfyui/client.js';
import { waitForCompletion } from '../comfyui/progress.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const MAX_ATTEMPTS = 2;

export interface ProcessorConfig {
  db: DB;
  redis: Redis;
  pub: Redis;
  storage: StorageProvider;
  s3: S3Client;
  r2Bucket: string;
  cfClientId: string;
  cfClientSecret: string;
  log: Logger;
}

export async function processJob(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
): Promise<void> {
  const { db, redis, pub, storage, s3, r2Bucket, cfClientId, cfClientSecret, log } = cfg;
  const jobLog = log.child({ jobId, userId });

  // 1. Load job + inputs from DB
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) { jobLog.error('job not found — skipping'); return; }
  if (job.status !== 'QUEUED') { jobLog.warn({ status: job.status }, 'job not QUEUED — skipping'); return; }

  const [inputs] = await db.select().from(schema.jobInputs).where(eq(schema.jobInputs.jobId, jobId));
  if (!inputs) { jobLog.error('job_inputs not found — marking FAILED'); await markFailed(cfg, jobId, userId, stream, messageId, 'NO_INPUTS'); return; }

  // 2. Resolve catalog R2 keys
  const catalogIds = [inputs.modelCatalogId, inputs.poseCatalogId, inputs.backgroundCatalogId, inputs.lowerCatalogId];
  const catalogItems = await db.select({ id: schema.catalogItems.id, r2Key: schema.catalogItems.r2Key })
    .from(schema.catalogItems).where(inArray(schema.catalogItems.id, catalogIds));
  const r2KeyMap = new Map(catalogItems.map((c) => [c.id, c.r2Key]));

  const modelKey = r2KeyMap.get(inputs.modelCatalogId);
  const poseKey = r2KeyMap.get(inputs.poseCatalogId);
  const bgKey = r2KeyMap.get(inputs.backgroundCatalogId);
  const lowerKey = r2KeyMap.get(inputs.lowerCatalogId);
  if (!modelKey || !poseKey || !bgKey || !lowerKey) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'CATALOG_NOT_FOUND');
    return;
  }

  // 3. Claim a worker
  await transitionJob(db, pub, jobId, userId, 'PREPROCESSING', {}, jobLog);
  const worker = await selectWorker(redis);
  if (!worker) {
    // No worker available — re-enqueue (re-add to stream, XACK this message)
    jobLog.warn('no idle worker — re-enqueuing');
    await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
    await redis.xadd(stream, '*', 'jobId', jobId, 'userId', userId);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    return;
  }
  jobLog.info({ workerId: worker.id }, 'worker claimed');

  try {
    // 4. Generate presigned GET URLs for all inputs
    const [upperUrl, modelUrl, poseUrl, bgUrl, lowerUrl] = await Promise.all([
      storage.presignGet(inputs.upperGarmentKey, 3600).then((r) => r.url),
      storage.presignGet(modelKey, 3600).then((r) => r.url),
      storage.presignGet(poseKey, 3600).then((r) => r.url),
      storage.presignGet(bgKey, 3600).then((r) => r.url),
      storage.presignGet(lowerKey, 3600).then((r) => r.url),
    ]);

    // 5. Patch workflow
    const prompt = patchWorkflow({
      upperGarmentUrl: upperUrl,
      modelUrl,
      poseUrl,
      backgroundUrl: bgUrl,
      lowerGarmentUrl: lowerUrl,
      outputPrefix: `aivastra_${jobId}`,
    });

    // 6. Submit to ComfyUI
    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: worker.id }, jobLog);
    const clientUuid = randomUUID();
    const { promptId } = await submitPrompt(worker.url, cfClientId, cfClientSecret, clientUuid, prompt);
    jobLog.info({ promptId }, 'prompt submitted to ComfyUI');

    // 7. Wait for completion via WebSocket
    await waitForCompletion(
      worker.url, cfClientId, cfClientSecret, clientUuid, promptId, 300_000,
      (update) => jobLog.debug(update, 'comfyui progress'),
    );

    // 8. Fetch output image metadata + download
    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(worker.url, cfClientId, cfClientSecret, promptId);
    if (!outputImages.length) throw new Error('ComfyUI returned no output images');

    const imageBytes = await downloadOutputImage(worker.url, cfClientId, cfClientSecret, outputImages[0]!.filename);

    // 9. Upload result to R2
    const resultKey = keys.output(jobId);
    await s3.send(new PutObjectCommand({
      Bucket: r2Bucket,
      Key: resultKey,
      Body: imageBytes,
      ContentType: 'image/png',
    }));

    // 10. Mark COMPLETED
    await transitionJob(db, pub, jobId, userId, 'COMPLETED', { resultKey }, jobLog);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, worker.id, 'IDLE');
    jobLog.info('job completed successfully');

  } catch (err) {
    jobLog.error({ err }, 'job processing error');
    await setWorkerStatus(redis, worker.id, 'IDLE');
    await handleFailure(cfg, jobId, userId, stream, messageId, err, jobLog);
  }
}

async function handleFailure(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
  _err: unknown,
  log: Logger,
): Promise<void> {
  const { db, redis, pub } = cfg;

  // Increment attempts atomically
  const [job] = await db.update(schema.jobs)
    .set({ attempts: schema.jobs.attempts })
    .where(eq(schema.jobs.id, jobId))
    .returning({ attempts: schema.jobs.attempts, creditsCharged: schema.jobs.creditsCharged });

  // Re-fetch to get incremented value
  const [current] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!current) return;

  const newAttempts = current.attempts + 1;
  await db.update(schema.jobs).set({ attempts: newAttempts }).where(eq(schema.jobs.id, jobId));

  if (newAttempts >= MAX_ATTEMPTS) {
    // Terminal failure: refund credits
    const { refund } = await import('@aivastra/db').then((m) => ({ refund: m.schema }));
    // Use raw SQL via drizzle for the refund (reuse the ledger pattern)
    await db.transaction(async (tx) => {
      const existing = await tx.select().from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, jobId));
      const alreadyRefunded = existing.some((e) => e.reason === 'JOB_FAIL_REFUND');
      if (!alreadyRefunded) {
        const { sql } = await import('drizzle-orm');
        await tx.update(schema.userCredits)
          .set({ balance: sql`${schema.userCredits.balance} + ${current.creditsCharged}` })
          .where(eq(schema.userCredits.userId, userId));
        await tx.insert(schema.creditLedger).values({
          userId, delta: current.creditsCharged, reason: 'JOB_FAIL_REFUND', jobId,
        });
      }
    });
    await transitionJob(db, pub, jobId, userId, 'FAILED', { errorCode: 'MAX_RETRIES' }, log);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    log.warn({ jobId, attempts: newAttempts }, 'job FAILED after max retries — credits refunded');
  } else {
    // Re-enqueue for retry
    await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
    await redis.xadd(stream, '*', 'jobId', jobId, 'userId', userId);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    log.info({ jobId, attempts: newAttempts }, `job re-enqueued for retry (attempt ${newAttempts})`);
  }
}

async function markFailed(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
  errorCode: string,
): Promise<void> {
  const { db, redis, pub, log } = cfg;
  await transitionJob(db, pub, jobId, userId, 'FAILED', { errorCode }, log);
  await redis.xack(stream, 'dispatcher-cg', messageId);
}
```

- [ ] **Step 11.2: Commit**

```bash
git add apps/dispatcher/src/job/processor.ts
git commit -m "feat(dispatcher): job processor orchestration"
```

---

## Task 12: Stream consumer — priority-aware XREADGROUP loop

**Files:**
- Create: `apps/dispatcher/src/stream/consumer.ts`

Reads from `jobs:priority` first (non-blocking), then `jobs:normal` (blocks up to 2s). Each message is processed sequentially. The consumer group `dispatcher-cg` must be created before reading.

- [ ] **Step 12.1: Create `apps/dispatcher/src/stream/consumer.ts`**

```typescript
import { hostname } from 'node:os';
import type { Redis } from 'ioredis';
import type { Logger } from '@aivastra/logger';
import type { ProcessorConfig } from '../job/processor.js';
import { processJob } from '../job/processor.js';

const GROUP = 'dispatcher-cg';
const CONSUMER = hostname();

async function ensureGroups(redis: Redis, log: Logger) {
  for (const stream of ['jobs:priority', 'jobs:normal']) {
    try {
      await redis.xgroup('CREATE', stream, GROUP, '$', 'MKSTREAM');
      log.info({ stream }, 'consumer group created');
    } catch (err: unknown) {
      // BUSYGROUP = group already exists, safe to ignore
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  }
}

type XReadGroupResult = Array<[string, Array<[string, string[]]>]> | null;

async function readOne(redis: Redis): Promise<{ stream: string; messageId: string; jobId: string; userId: string } | null> {
  // Try priority stream first (non-blocking, COUNT=1)
  for (const stream of ['jobs:priority', 'jobs:normal']) {
    const result = await redis.xreadgroup(
      'GROUP', GROUP, CONSUMER, 'COUNT', '1', 'BLOCK', stream === 'jobs:normal' ? '2000' : '0', 'STREAMS', stream, '>',
    ) as XReadGroupResult;
    if (!result || !result[0] || !result[0][1].length) continue;
    const [messageId, fields] = result[0][1][0]!;
    const fieldMap: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) fieldMap[fields[i]!] = fields[i + 1]!;
    if (!fieldMap['jobId'] || !fieldMap['userId']) continue;
    return { stream, messageId, jobId: fieldMap['jobId'], userId: fieldMap['userId'] };
  }
  return null;
}

export async function runConsumer(
  redis: Redis,
  cfg: ProcessorConfig,
  log: Logger,
): Promise<() => void> {
  await ensureGroups(redis, log);
  let running = true;

  async function loop() {
    while (running) {
      try {
        const msg = await readOne(redis);
        if (!msg) continue;
        const { stream, messageId, jobId, userId } = msg;
        log.info({ jobId, userId, stream }, 'consumed job from stream');
        await processJob(cfg, jobId, userId, stream, messageId);
      } catch (err) {
        log.error({ err }, 'consumer loop error — resuming');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Start loop in background (don't await)
  loop().catch((err) => log.error({ err }, 'consumer loop crashed'));

  return () => { running = false; };
}
```

- [ ] **Step 12.2: Commit**

```bash
git add apps/dispatcher/src/stream/consumer.ts
git commit -m "feat(dispatcher): priority-aware Redis stream consumer"
```

---

## Task 13: Crash recovery — XPENDING sweep on startup

**Files:**
- Create: `apps/dispatcher/src/stream/recovery.ts`

On startup, claims any `XPENDING` entries idle longer than `XPENDING_CLAIM_THRESHOLD_MS` (default 60s) and re-processes them. This handles dispatcher crash mid-job.

- [ ] **Step 13.1: Create `apps/dispatcher/src/stream/recovery.ts`**

```typescript
import { hostname } from 'node:os';
import type { Redis } from 'ioredis';
import type { Logger } from '@aivastra/logger';
import type { ProcessorConfig } from '../job/processor.js';
import { processJob } from '../job/processor.js';

const GROUP = 'dispatcher-cg';
const CONSUMER = hostname();

type PendingEntry = [string, string, number, number]; // [id, consumer, idle, deliveries]

export async function recoverPendingJobs(
  redis: Redis,
  cfg: ProcessorConfig,
  thresholdMs: number,
  log: Logger,
): Promise<void> {
  for (const stream of ['jobs:priority', 'jobs:normal']) {
    let startId = '-';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pending = await redis.xpending(stream, GROUP, startId, '+', 10) as PendingEntry[];
      if (!pending.length) break;

      for (const [messageId, , idleMs] of pending) {
        if (idleMs < thresholdMs) continue;
        log.warn({ stream, messageId, idleMs }, 'claiming stale pending entry');
        const claimed = await redis.xclaim(stream, GROUP, CONSUMER, thresholdMs, messageId) as Array<[string, string[]]>;
        if (!claimed.length) continue;

        const [, fields] = claimed[0]!;
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) fieldMap[fields[i]!] = fields[i + 1]!;
        if (!fieldMap['jobId'] || !fieldMap['userId']) {
          await redis.xack(stream, GROUP, messageId);
          continue;
        }
        log.info({ jobId: fieldMap['jobId'] }, 'reprocessing claimed pending job');
        await processJob(cfg, fieldMap['jobId']!, fieldMap['userId']!, stream, messageId);
      }

      const lastId = pending[pending.length - 1]![0];
      // Advance cursor past last seen ID
      startId = lastId.replace(/^(\d+)-(\d+)$/, (_, ms, seq) => `${ms}-${Number(seq) + 1}`);
      if (pending.length < 10) break;
    }
  }
}
```

- [ ] **Step 13.2: Commit**

```bash
git add apps/dispatcher/src/stream/recovery.ts
git commit -m "feat(dispatcher): XPENDING crash recovery on startup"
```

---

## Task 14: Health HTTP server

**Files:**
- Create: `apps/dispatcher/src/health/server.ts`

Simple HTTP server on `DISPATCHER_HEALTH_PORT` (default 4100). Returns `200 {"status":"ok"}` on `GET /health`.

- [ ] **Step 14.1: Create `apps/dispatcher/src/health/server.ts`**

```typescript
import { createServer } from 'node:http';
import type { Logger } from '@aivastra/logger';

export function startHealthServer(port: number, log: Logger): () => void {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404).end();
    }
  });

  server.listen(port, '127.0.0.1', () => {
    log.info({ port }, 'health server listening');
  });

  return () => server.close();
}
```

- [ ] **Step 14.2: Commit**

```bash
git add apps/dispatcher/src/health/server.ts
git commit -m "feat(dispatcher): health HTTP server on port 4100"
```

---

## Task 15: Entry point — wire everything together

**Files:**
- Create: `apps/dispatcher/src/index.ts`

- [ ] **Step 15.1: Create `apps/dispatcher/src/index.ts`**

```typescript
import { hostname } from 'node:os';
import { S3Client } from '@aws-sdk/client-s3';
import { createLogger } from '@aivastra/logger';
import { loadEnv, workerUrl } from './env.js';
import { makeDb } from './lib/db.js';
import { makeRedis } from './lib/redis.js';
import { makeStorage } from './lib/storage.js';
import { registerWorkers } from './worker/registry.js';
import { startHealthMonitor } from './worker/health-monitor.js';
import { runConsumer } from './stream/consumer.js';
import { recoverPendingJobs } from './stream/recovery.js';
import { startHealthServer } from './health/server.js';

const log = createLogger('dispatcher', { hostname: hostname() });

async function main() {
  const env = loadEnv();
  log.info({ NODE_ENV: env.NODE_ENV }, 'dispatcher starting');

  const { db, close: closeDb } = makeDb(env);
  const { main: redis, pub, close: closeRedis } = makeRedis(env);
  const storage = makeStorage(env);
  const s3 = new S3Client({
    endpoint: env.R2_ENDPOINT,
    region: 'auto',
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    forcePathStyle: env.R2_FORCE_PATH_STYLE,
  });

  // Register known workers from env
  const workerIds = env.WORKER_IDS.split(',').map((s) => s.trim());
  const workers = workerIds.map((id) => ({ id, url: workerUrl(process.env, id) }));
  await registerWorkers(redis, workers);
  log.info({ workerIds }, 'workers registered');

  const processorCfg = {
    db, redis, pub, storage, s3,
    r2Bucket: env.R2_BUCKET,
    cfClientId: env.CF_ACCESS_CLIENT_ID,
    cfClientSecret: env.CF_ACCESS_CLIENT_SECRET,
    log,
  };

  // Crash recovery: claim stale XPENDING entries from previous run
  await recoverPendingJobs(redis, processorCfg, env.XPENDING_CLAIM_THRESHOLD_MS, log);

  // Start subsystems
  const stopHealthMonitor = startHealthMonitor(redis, env.CF_ACCESS_CLIENT_ID, env.CF_ACCESS_CLIENT_SECRET, log);
  const stopConsumer = await runConsumer(redis, processorCfg, log);
  const stopHealthServer = startHealthServer(env.DISPATCHER_HEALTH_PORT, log);

  log.info('dispatcher ready');

  // Graceful shutdown
  async function shutdown(signal: string) {
    log.info({ signal }, 'shutting down dispatcher');
    stopConsumer();
    stopHealthMonitor();
    stopHealthServer();
    await closeRedis();
    await closeDb();
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => { log.error({ err }, 'dispatcher crashed'); process.exit(1); });
```

- [ ] **Step 15.2: Commit**

```bash
git add apps/dispatcher/src/index.ts
git commit -m "feat(dispatcher): entry point with graceful shutdown"
```

---

## Task 16: Test harness helpers

**Files:**
- Create: `apps/dispatcher/test/helpers/containers.ts`
- Create: `apps/dispatcher/test/helpers/comfy-mock.ts`

- [ ] **Step 16.1: Create `apps/dispatcher/test/helpers/containers.ts`**

Same pattern as `apps/api/test/helpers/containers.ts` — fresh Postgres DB + random MinIO bucket per test file. Redis is shared but flushed per test.

```typescript
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { S3Client, CreateBucketCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';
import { createDb } from '@aivastra/db';
import { createR2Provider } from '@aivastra/storage';
import type { DB } from '@aivastra/db';
import type { StorageProvider } from '@aivastra/storage';

export interface TestEnv {
  db: DB;
  closeDb: () => Promise<void>;
  redisUrl: string;
  storage: StorageProvider;
  s3: S3Client;
  r2Bucket: string;
  r2Endpoint: string;
  cleanup: () => Promise<void>;
}

export async function setupTestEnv(): Promise<TestEnv> {
  const dbName = `disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const adminUrl = 'postgres://tryon:tryon_dev_pw@127.0.0.1:5432/tryon_dev';
  const adminClient = postgres(adminUrl, { max: 1 });
  await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
  await adminClient.end();

  const pgUrl = `postgres://tryon:tryon_dev_pw@127.0.0.1:5432/${dbName}`;
  const migClient = postgres(pgUrl, { max: 1 });
  await migrate(drizzle(migClient), { migrationsFolder: './node_modules/@aivastra/db/src/migrations' });
  await migClient.end();

  const { db, close: closeDb } = createDb(pgUrl);

  const r2Endpoint = 'http://127.0.0.1:9000';
  const bucket = `disp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const s3 = new S3Client({
    endpoint: r2Endpoint, region: 'auto',
    credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin_dev_pw' },
    forcePathStyle: true,
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));

  const storage = createR2Provider({
    endpoint: r2Endpoint, accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin_dev_pw',
    bucket, publicUrl: `${r2Endpoint}/${bucket}`, forcePathStyle: true,
  });

  return {
    db, closeDb,
    redisUrl: 'redis://127.0.0.1:6379',
    storage, s3, r2Bucket: bucket, r2Endpoint,
    cleanup: async () => {
      await closeDb();
      const cl = postgres(adminUrl, { max: 1 });
      await cl.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await cl.end();
      try { await s3.send(new DeleteBucketCommand({ Bucket: bucket })); } catch { /* ignore */ }
    },
  };
}
```

- [ ] **Step 16.2: Create `apps/dispatcher/test/helpers/comfy-mock.ts`**

Starts a local HTTP + WebSocket server that behaves like ComfyUI. Configure it to succeed or fail before each test.

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';

export interface ComfyMockOptions {
  /** If true, the mock will emit execution_error instead of execution_complete */
  fail?: boolean;
  /** Delay before sending completion event (ms) */
  completionDelayMs?: number;
  /** The output image filename to return in /history */
  outputFilename?: string;
  /** Bytes to return for /view */
  outputBytes?: Uint8Array;
}

export interface ComfyMock {
  url: string;
  lastPromptId: () => string | null;
  setOptions: (opts: ComfyMockOptions) => void;
  close: () => Promise<void>;
}

export function startComfyMock(): Promise<ComfyMock> {
  return new Promise((resolve) => {
    let opts: ComfyMockOptions = {};
    let lastPromptId: string | null = null;
    const clients = new Map<string, ReturnType<typeof wss.clients.values>>();

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/system_stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ system: { python_version: '3.10' } }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/prompt') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const { client_id, prompt } = JSON.parse(body) as { client_id: string; prompt: unknown };
          const promptId = `mock-prompt-${Date.now()}`;
          lastPromptId = promptId;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ prompt_id: promptId }));

          // Simulate async completion via WebSocket
          const delayMs = opts.completionDelayMs ?? 50;
          setTimeout(() => {
            wss.clients.forEach((ws) => {
              const event = opts.fail
                ? { type: 'execution_error', data: { prompt_id: promptId, exception_message: 'mock error' } }
                : { type: 'execution_complete', data: { prompt_id: promptId } };
              if (ws.readyState === 1) ws.send(JSON.stringify(event));
            });
          }, delayMs);
        });
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
        const filename = opts.outputFilename ?? 'result.png';
        const promptId = url.pathname.split('/').pop()!;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          [promptId]: { outputs: { '10': { images: [{ filename, subfolder: '', type: 'output' }] } } },
        }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/view') {
        const bytes = opts.outputBytes ?? new Uint8Array([137, 80, 78, 71]); // PNG magic
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from(bytes));
        return;
      }

      res.writeHead(404).end();
    });

    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => {
      // ComfyUI sends messages to all connected clients for the given clientId
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        lastPromptId: () => lastPromptId,
        setOptions: (newOpts) => { opts = newOpts; },
        close: () => new Promise((r) => { wss.close(); server.close(() => r()); }),
      });
    });
  });
}
```

- [ ] **Step 16.3: Commit**

```bash
git add apps/dispatcher/test/
git commit -m "test(dispatcher): test harness helpers (containers + ComfyUI mock)"
```

---

## Task 17: Integration test — happy path

**Files:**
- Create: `apps/dispatcher/test/integration/happy-path.test.ts`

Tests the full flow: seed a QUEUED job, register a mock worker, run the processor, verify COMPLETED + result in R2 + credits unchanged.

- [ ] **Step 17.1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { startComfyMock, type ComfyMock } from '../helpers/comfy-mock.js';
import { processJob } from '../../src/job/processor.js';
import { createLogger } from '@aivastra/logger';
import { registerWorkers } from '../../src/worker/registry.js';
import { Redis as IRedis } from 'ioredis';

const WORKER_ID = 'test-worker';

describe('dispatcher happy path', () => {
  let env: TestEnv;
  let redis: IRedis;
  let pub: IRedis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new IRedis('redis://127.0.0.1:6379');
    pub = new IRedis('redis://127.0.0.1:6379');
    comfy = await startComfyMock();

    // Seed a healthy worker in registry + health key
    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');
  }, 60_000);

  afterAll(async () => {
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  beforeEach(async () => {
    // Reset worker to IDLE
    const { setWorkerStatus } = await import('../../src/worker/registry.js');
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
  });

  async function seedJob() {
    // Create user
    const [user] = await env.db.insert(schema.users).values({
      email: `happy-${Date.now()}@test.com`, passwordHash: 'x', tier: 'FREE',
    }).returning();
    // Grant credits
    await env.db.insert(schema.userCredits).values({ userId: user!.id, balance: 5 });
    // Seed catalog
    const [ct] = await env.db.insert(schema.catalogTypes).values({ slug: `hp-${Date.now()}`, label: 'T' }).returning();
    const [cc] = await env.db.insert(schema.catalogCategories).values({ typeId: ct!.id, slug: 'c', label: 'C' }).returning();
    const makeItem = (label: string, r2Key: string) =>
      env.db.insert(schema.catalogItems).values({ categoryId: cc!.id, label, r2Key, thumbnailKey: r2Key }).returning();
    const [[m], [p], [b], [l]] = await Promise.all([makeItem('M', 'catalog/m/m.jpg'), makeItem('P', 'catalog/p/p.jpg'), makeItem('B', 'catalog/b/b.jpg'), makeItem('L', 'catalog/l/l.jpg')]);
    // Create job
    const [job] = await env.db.insert(schema.jobs).values({ userId: user!.id, status: 'QUEUED', priority: false, creditsCharged: 1 }).returning();
    await env.db.insert(schema.jobInputs).values({
      jobId: job!.id, upperGarmentKey: `inputs/${job!.id}/garment.jpg`,
      modelCatalogId: m!.id, poseCatalogId: p!.id, backgroundCatalogId: b!.id, lowerCatalogId: l!.id,
    });
    // Upload stub garment to MinIO
    await env.s3.send(new PutObjectCommand({
      Bucket: env.r2Bucket, Key: `inputs/${job!.id}/garment.jpg`,
      Body: Buffer.from('stub'), ContentType: 'image/jpeg',
    }));
    // Upload stub catalog images
    for (const key of ['catalog/m/m.jpg', 'catalog/p/p.jpg', 'catalog/b/b.jpg', 'catalog/l/l.jpg']) {
      await env.s3.send(new PutObjectCommand({ Bucket: env.r2Bucket, Key: key, Body: Buffer.from('stub'), ContentType: 'image/jpeg' }));
    }
    return { jobId: job!.id, userId: user!.id };
  }

  it('processes job to COMPLETED — result uploaded to R2, credits unchanged', async () => {
    const { jobId, userId } = await seedJob();
    const log = createLogger('test', { level: 'silent' });

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, cfClientId: 'x', cfClientSecret: 'y', log },
      jobId, userId, 'jobs:normal', 'mock-msg-id',
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job!.status).toBe('COMPLETED');
    expect(job!.workerId).toBe(WORKER_ID);

    const [output] = await env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, jobId));
    expect(output!.resultKey).toBe(`outputs/${jobId}/result.png`);

    // Verify file exists in MinIO
    const obj = await env.s3.send(new GetObjectCommand({ Bucket: env.r2Bucket, Key: `outputs/${jobId}/result.png` }));
    expect(obj.$metadata.httpStatusCode).toBe(200);

    // Credits unchanged (cost already deducted at job creation time by API)
    const [bal] = await env.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, userId));
    expect(bal!.balance).toBe(5);
  });
});
```

- [ ] **Step 17.2: Run test (expect FAIL — processor not yet importable with real template)**

```bash
pnpm --filter @aivastra/dispatcher test -- happy-path
```

Expected: test fails or errors (template file missing, imports can't resolve).

- [ ] **Step 17.3: Fix missing template path resolution**

The `patcher.ts` uses `process.cwd()` which in tests points to `apps/dispatcher`. Update `TEMPLATE_PATH` to be resolvable from tests:

Edit `apps/dispatcher/src/workflow/patcher.ts`, replace `TEMPLATE_PATH`:

```typescript
// Replace the TEMPLATE_PATH line with:
const TEMPLATE_PATH = resolve(
  new URL(import.meta.url).pathname,
  '../../../../templates/virtual-tryon-v1.json',
);
```

- [ ] **Step 17.4: Run test again**

```bash
pnpm --filter @aivastra/dispatcher test -- happy-path
```

Expected: PASS

- [ ] **Step 17.5: Commit**

```bash
git add apps/dispatcher/test/integration/happy-path.test.ts
git commit -m "test(dispatcher): happy path integration test (QUEUED → COMPLETED)"
```

---

## Task 18: Integration test — retry + credit refund

**Files:**
- Create: `apps/dispatcher/test/integration/retry.test.ts`

Tests that a failing job retries up to `MAX_ATTEMPTS=2` then marks FAILED and refunds credits.

- [ ] **Step 18.1: Write test**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { startComfyMock, type ComfyMock } from '../helpers/comfy-mock.js';
import { processJob } from '../../src/job/processor.js';
import { createLogger } from '@aivastra/logger';
import { registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';

const WORKER_ID = 'retry-worker';

describe('dispatcher retry + refund', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    comfy = await startComfyMock();
    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');
  }, 60_000);

  afterAll(async () => {
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  beforeEach(async () => {
    comfy.setOptions({});
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
  });

  async function seedJob() {
    const [user] = await env.db.insert(schema.users).values({ email: `retry-${Date.now()}@test.com`, passwordHash: 'x', tier: 'FREE' }).returning();
    await env.db.insert(schema.userCredits).values({ userId: user!.id, balance: 5 });
    const [ct] = await env.db.insert(schema.catalogTypes).values({ slug: `rt-${Date.now()}`, label: 'T' }).returning();
    const [cc] = await env.db.insert(schema.catalogCategories).values({ typeId: ct!.id, slug: 'c', label: 'C' }).returning();
    const mkItem = (r2Key: string) => env.db.insert(schema.catalogItems).values({ categoryId: cc!.id, label: 'I', r2Key, thumbnailKey: r2Key }).returning();
    const [[m], [p], [b], [l]] = await Promise.all([mkItem('k/m.jpg'), mkItem('k/p.jpg'), mkItem('k/b.jpg'), mkItem('k/l.jpg')]);
    const [job] = await env.db.insert(schema.jobs).values({ userId: user!.id, status: 'QUEUED', priority: false, creditsCharged: 1 }).returning();
    await env.db.insert(schema.jobInputs).values({ jobId: job!.id, upperGarmentKey: `inputs/${job!.id}/garment.jpg`, modelCatalogId: m!.id, poseCatalogId: p!.id, backgroundCatalogId: b!.id, lowerCatalogId: l!.id });
    for (const key of [`inputs/${job!.id}/garment.jpg`, 'k/m.jpg', 'k/p.jpg', 'k/b.jpg', 'k/l.jpg']) {
      await env.s3.send(new PutObjectCommand({ Bucket: env.r2Bucket, Key: key, Body: Buffer.from('s'), ContentType: 'image/jpeg' }));
    }
    return { jobId: job!.id, userId: user!.id };
  }

  it('refunds credits after MAX_ATTEMPTS failures', async () => {
    comfy.setOptions({ fail: true });
    const { jobId, userId } = await seedJob();
    const log = createLogger('test', { level: 'silent' });
    const cfg = { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, cfClientId: 'x', cfClientSecret: 'y', log };

    // First attempt — re-enqueues (attempts becomes 1)
    await processJob(cfg, jobId, userId, 'jobs:normal', 'msg-1');
    const [after1] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after1!.status).toBe('QUEUED');
    expect(after1!.attempts).toBe(1);

    // Reset worker to IDLE for second attempt
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');

    // Second attempt — marks FAILED, refunds
    await processJob(cfg, jobId, userId, 'jobs:normal', 'msg-2');
    const [after2] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after2!.status).toBe('FAILED');
    expect(after2!.attempts).toBe(2);

    const [bal] = await env.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, userId));
    // creditsCharged=1 refunded → balance back to 5
    expect(bal!.balance).toBe(6); // 5 initial + 1 refund (credits were NOT deducted here since processJob doesn't deduct)

    // Verify refund ledger entry
    const ledger = await env.db.select().from(schema.creditLedger)
      .where(eq(schema.creditLedger.jobId, jobId));
    expect(ledger.some((e) => e.reason === 'JOB_FAIL_REFUND')).toBe(true);
  });
});
```

- [ ] **Step 18.2: Run test**

```bash
pnpm --filter @aivastra/dispatcher test -- retry
```

Expected: PASS

- [ ] **Step 18.3: Commit**

```bash
git add apps/dispatcher/test/integration/retry.test.ts
git commit -m "test(dispatcher): retry + credit refund after max attempts"
```

---

## Task 19: Integration test — XPENDING crash recovery

**Files:**
- Create: `apps/dispatcher/test/integration/recovery.test.ts`

Verifies `recoverPendingJobs()` claims a stale pending message and processes it to COMPLETED.

- [ ] **Step 19.1: Write test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { startComfyMock, type ComfyMock } from '../helpers/comfy-mock.js';
import { recoverPendingJobs } from '../../src/stream/recovery.js';
import { createLogger } from '@aivastra/logger';
import { registerWorkers } from '../../src/worker/registry.js';

const WORKER_ID = 'rec-worker';
const STREAM = 'jobs:recovery-test';
const GROUP = 'dispatcher-cg';

describe('dispatcher crash recovery', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    comfy = await startComfyMock();
    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');

    // Ensure consumer group exists on our test stream
    try { await redis.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM'); } catch { /* ignore BUSYGROUP */ }
  }, 60_000);

  afterAll(async () => {
    await redis.del(STREAM);
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  it('claims stale XPENDING entry and processes to COMPLETED', async () => {
    // Seed job
    const [user] = await env.db.insert(schema.users).values({ email: `rec-${Date.now()}@test.com`, passwordHash: 'x', tier: 'FREE' }).returning();
    await env.db.insert(schema.userCredits).values({ userId: user!.id, balance: 5 });
    const [ct] = await env.db.insert(schema.catalogTypes).values({ slug: `rec-${Date.now()}`, label: 'T' }).returning();
    const [cc] = await env.db.insert(schema.catalogCategories).values({ typeId: ct!.id, slug: 'c', label: 'C' }).returning();
    const mkItem = (k: string) => env.db.insert(schema.catalogItems).values({ categoryId: cc!.id, label: 'I', r2Key: k, thumbnailKey: k }).returning();
    const [[m], [p], [b], [l]] = await Promise.all([mkItem('k/m.jpg'), mkItem('k/p.jpg'), mkItem('k/b.jpg'), mkItem('k/l.jpg')]);
    const [job] = await env.db.insert(schema.jobs).values({ userId: user!.id, status: 'QUEUED', priority: false, creditsCharged: 1 }).returning();
    await env.db.insert(schema.jobInputs).values({ jobId: job!.id, upperGarmentKey: `inputs/${job!.id}/garment.jpg`, modelCatalogId: m!.id, poseCatalogId: p!.id, backgroundCatalogId: b!.id, lowerCatalogId: l!.id });
    for (const key of [`inputs/${job!.id}/garment.jpg`, 'k/m.jpg', 'k/p.jpg', 'k/b.jpg', 'k/l.jpg']) {
      await env.s3.send(new PutObjectCommand({ Bucket: env.r2Bucket, Key: key, Body: Buffer.from('s'), ContentType: 'image/jpeg' }));
    }

    // Simulate a "previous consumer" reading the message without ACKing it
    const ghostConsumer = 'ghost-consumer';
    await redis.xadd(STREAM, '*', 'jobId', job!.id, 'userId', user!.id);
    await redis.xreadgroup('GROUP', GROUP, ghostConsumer, 'COUNT', '1', 'BLOCK', '0', 'STREAMS', STREAM, '>');

    // Immediately try recovery with threshold=0ms (claim all pending)
    const log = createLogger('test', { level: 'silent' });
    const cfg = { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, cfClientId: 'x', cfClientSecret: 'y', log };

    await recoverPendingJobs(redis, cfg, 0, log);

    const [completed] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, job!.id));
    expect(completed!.status).toBe('COMPLETED');
  });
});
```

- [ ] **Step 19.2: Run test**

```bash
pnpm --filter @aivastra/dispatcher test -- recovery
```

Expected: PASS

- [ ] **Step 19.3: Run all dispatcher tests**

```bash
pnpm --filter @aivastra/dispatcher test
```

Expected: all PASS

- [ ] **Step 19.4: Commit**

```bash
git add apps/dispatcher/test/integration/recovery.test.ts
git commit -m "test(dispatcher): XPENDING crash recovery integration test"
```

---

## Task 20: Dispatcher Dockerfile

**Files:**
- Create: `apps/dispatcher/Dockerfile`

- [ ] **Step 20.1: Create `apps/dispatcher/Dockerfile`**

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/dispatcher/package.json apps/dispatcher/
COPY packages/db/package.json packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/storage/package.json packages/storage/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build
COPY apps/dispatcher/ apps/dispatcher/
COPY packages/ packages/
COPY templates/ templates/
RUN pnpm --filter @aivastra/db build && \
    pnpm --filter @aivastra/logger build && \
    pnpm --filter @aivastra/storage build && \
    pnpm --filter @aivastra/types build && \
    pnpm --filter @aivastra/dispatcher build

FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/dispatcher/package.json apps/dispatcher/
COPY packages/db/package.json packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/storage/package.json packages/storage/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/apps/dispatcher/dist ./apps/dispatcher/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/logger/dist ./packages/logger/dist
COPY --from=build /app/packages/storage/dist ./packages/storage/dist
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/templates ./templates

ENV NODE_ENV=production
CMD ["node", "apps/dispatcher/dist/index.js"]
```

- [ ] **Step 20.2: Commit**

```bash
git add apps/dispatcher/Dockerfile
git commit -m "chore(dispatcher): production Dockerfile"
```

---

## Self-Review Checklist

### Spec coverage

| PHASES.md requirement | Plan task |
|---|---|
| Redis Stream consumer `XREADGROUP` | Task 12 |
| Priority queue (priority first, then normal) | Task 12 |
| Worker registry `worker:registry` hash | Task 4 |
| Health monitor 15s probe, 30s TTL key | Task 5 |
| Atomic IDLE→BUSY worker claim | Task 6 |
| ComfyUI POST /prompt | Task 8 |
| WebSocket progress listener | Task 9 |
| Fetch /history + /view (download result) | Task 8 |
| Workflow template clone-and-patch | Task 7 |
| State machine QUEUED→PREPROCESSING→GENERATING→UPLOADING→COMPLETED\|FAILED | Tasks 10, 11 |
| SSE publish at each state | Task 10 |
| Retry: max 2 attempts | Task 11 |
| Credit refund on terminal failure (transactional, idempotent) | Task 11 |
| XACK only after terminal state | Tasks 11, 12 |
| XPENDING sweep on startup | Task 13 |
| Health HTTP server port 4100 | Task 14 |
| Integration tests: state machine, retry, refund | Tasks 17, 18 |
| Integration tests: crash recovery | Task 19 |
| Dispatcher Dockerfile | Task 20 |

### Gaps / Decisions to Note

> **BLOCKING — Template (Task 7):** `templates/virtual-tryon-v1.json` is a stub. The real ComfyUI workflow must be exported from the ComfyUI UI (as API format via Save→API), with actual node IDs mapped to the 5 `__AIVASTRA_*__` placeholders. This is required before Phase 4 E2E.

> **Decision — Catalog key resolution (Task 11):** Dispatcher reads `catalog_items` to resolve catalog IDs → R2 keys. This deviates slightly from the CLAUDE.md invariant "Dispatcher trusts the resolved keys on the job row" because `job_inputs` stores catalog UUIDs, not r2Keys. Resolution: acceptable for v1. If this becomes a concern, add `model_r2_key`, `pose_r2_key`, `background_r2_key`, `lower_r2_key` columns to `job_inputs` in a future migration, populate them at job creation time in the API.

> **VPS + Tunnel (Phase 2B):** Tasks for VPS provisioning, ComfyUI install, and cloudflared registration are infra-only and not in this code plan. Follow `infra/cloudflared/README.md` and `docs/PHASES.md §2B`. Populate `.env` with `WORKER_A_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` before running the dispatcher.

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-phase-2-dispatcher.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
