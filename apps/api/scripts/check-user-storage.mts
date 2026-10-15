/**
 * Answers one question: is the R2 user-storage split actually working in THIS
 * environment, with its real credentials, buckets and CORS rule?
 *
 * Unit tests prove the routing logic against fakes and local MinIO; none of
 * them can prove that a given .env reaches a real Cloudflare bucket, that the
 * token can write to it, or that the bucket's CORS rule (Cloudflare dashboard
 * state, not in this repo) lets a browser PUT to it. Run this after setting or
 * rotating USER_STORAGE_* and after any change to the bucket's CORS rule.
 *
 * Touches only its own objects — every key sits under a unique
 * `__storage-check-<timestamp>/` segment — and deletes them all on the way out,
 * pass or fail. Safe to run against production.
 *
 * Usage (from the api container, where /app/.env is the environment's env file):
 *   docker exec -w /app/apps/api aivastra-staging-api pnpm check:storage
 *
 * Exits non-zero if any check fails.
 */

import {
  createR2Provider,
  createRoutedStorage,
  isNotFoundError,
  resolveUserStorageConfig,
  type StorageProvider,
} from '@aivastra/storage';

const env = process.env;
const run = `__storage-check-${Date.now().toString(36)}`;
// Storefront uploads (Shopify widget, WordPress plugin) PUT straight from a
// merchant's own domain, so the CORS rule can't be a fixed allow-list of ours.
// This stands in for "some origin we don't control".
const FOREIGN_ORIGIN = 'https://aivastra-storage-check.myshopify.com';

let failed = 0;
function report(ok: boolean, name: string, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}
const exists = (p: StorageProvider, key: string) =>
  p.headObject(key).then(
    () => true,
    (err) => (isNotFoundError(err) ? false : Promise.reject(err)),
  );

const userConfig = resolveUserStorageConfig(env);
if (!userConfig) {
  console.log('USER_STORAGE_* is not set in this environment — every key stays on MinIO.');
  process.exit(1);
}
const readFallback = env.USER_STORAGE_READ_FALLBACK === 'true';
console.log(`R2 bucket: ${userConfig.bucket} · read fallback: ${readFallback ? 'on' : 'off'}`);

const asset = createR2Provider({
  endpoint: env.R2_ENDPOINT as string,
  accessKeyId: env.R2_ACCESS_KEY_ID as string,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
  bucket: env.R2_BUCKET as string,
  publicUrl: env.R2_PUBLIC_URL as string,
  forcePathStyle: env.R2_FORCE_PATH_STYLE !== 'false',
  presignBaseUrl: env.R2_PUBLIC_PRESIGN_BASE || undefined,
  signEndpoint: env.R2_SIGN_ENDPOINT || undefined,
});
const user = createR2Provider(userConfig);
const fallbacks: string[] = [];
const storage = createRoutedStorage({
  asset,
  user,
  readFallback,
  onFallback: (key, op) => fallbacks.push(`${op}:${key}`),
});

const userKey = `outputs/${run}/result.png`;
const browserKey = `inputs/${run}/garment.jpg`;
const legacyKey = `outputs/${run}/legacy.png`;
const assetKey = `models/${run}/face.jpg`;
const created: [StorageProvider, string][] = [];

try {
  // 1. Credentials + routing: a user key lands on R2 and only R2.
  await storage.putObject(userKey, Buffer.from('r2-check'), 'image/png');
  created.push([user, userKey], [asset, userKey]);
  report(await exists(user, userKey), 'user key written to R2');
  report(!(await exists(asset, userKey)), 'user key not written to MinIO');
  report(
    (await storage.getObject(userKey)).toString() === 'r2-check',
    'user key read back through the router',
  );

  // 2. Asset keys never touch R2.
  await storage.putObject(assetKey, Buffer.from('asset-check'), 'image/jpeg');
  created.push([asset, assetKey], [user, assetKey]);
  report(
    (await exists(asset, assetKey)) && !(await exists(user, assetKey)),
    'asset key written to MinIO only',
  );

  // 3. Browser path: CORS preflight, then the presigned PUT a browser would make.
  const put = await storage.presignPut(browserKey, 'image/jpeg', 8);
  created.push([user, browserKey], [asset, browserKey]);
  const origins = [
    ...new Set([
      ...(env.CORS_ORIGIN ?? '').split(',').map((o) => o.trim()),
      env.WEB_URL ?? '',
      FOREIGN_ORIGIN,
    ]),
  ].filter(Boolean);
  for (const origin of origins) {
    const pre = await fetch(put.url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const allowed = pre.headers.get('access-control-allow-origin');
    report(
      pre.ok && (allowed === '*' || allowed === origin),
      `CORS preflight allows PUT from ${origin}`,
      allowed ? `allow-origin: ${allowed}` : `status ${pre.status}, no allow-origin header`,
    );
  }
  const putRes = await fetch(put.url, {
    method: 'PUT',
    body: 'garment!',
    headers: { 'Content-Type': 'image/jpeg', Origin: FOREIGN_ORIGIN },
  });
  report(
    putRes.ok && (await exists(user, browserKey)),
    'presigned PUT stores the object in R2',
    `status ${putRes.status}`,
  );
  const get = await fetch((await storage.presignGet(browserKey)).url);
  report(
    get.ok && (await get.text()) === 'garment!',
    'presigned GET serves it back',
    `status ${get.status}`,
  );

  // 4. Migration fallback: a pre-cutover object that exists only on MinIO.
  if (readFallback) {
    await asset.putObject(legacyKey, Buffer.from('legacy'), 'image/png');
    created.push([asset, legacyKey]);
    report(
      (await storage.getObject(legacyKey)).toString() === 'legacy',
      'pre-cutover object served from MinIO via fallback',
    );
    report(fallbacks.includes(`getObject:${legacyKey}`), 'fallback was reported');
    await storage.deleteObject(legacyKey);
    report(!(await exists(asset, legacyKey)), 'delete removes the MinIO copy too');
  } else {
    console.log('skip  fallback checks — USER_STORAGE_READ_FALLBACK is off');
  }
} catch (err) {
  report(
    false,
    'unexpected error',
    err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  );
} finally {
  for (const [p, key] of created) await p.deleteObject(key).catch(() => {});
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
