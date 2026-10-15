#!/usr/bin/env node
// Pulls the prod-snapshot distribution bucket's assets (admin-curated
// faces/backgrounds/poses etc., ~15-25G depending on export) into the local
// MinIO bucket. Exists because pull-prod-snapshot.sh's `mc mirror` step
// cannot work through the /minio reverse-proxy path -- see that script's
// header comment and docs/local-dev-snapshot-runbook.md §4.
//
// Why mc/a plain SDK call can't do this: MinIO validates a SigV4 signature
// against the request path *without* /minio, but the request has to
// physically arrive at a /minio-prefixed URL for Nginx to route it to MinIO
// at all -- Nginx strips the prefix before forwarding. Any client that signs
// and sends through one conflated URL (mc, aws-cli, a plain S3Client) signs
// a path that never matches what it sends. The only thing that survives this
// is a presigned URL: sign against the no-prefix host, then string-rewrite
// the result to insert /minio before a plain `fetch` sends it -- Nginx
// strips the prefix, so MinIO receives exactly the path that was signed.
// apps/api/.../prod-snapshot.routes.ts uses this trick for one object (the
// DB dump download link); this script does it for every object in the
// bucket, including ListObjectsV2, which that route never needed and the
// AWS SDK has no built-in way to presign generically.
//
// Usage: node scripts/local-sync/pull-prod-assets.mjs [--dry-run] [--concurrency=8]

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

// Neither @aws-sdk package is hoisted to the workspace root -- they're only
// declared (and installed) under packages/storage. Resolve from there
// explicitly rather than relying on ESM's directory walk-up from this
// script's own location, which stops short of packages/storage/node_modules.
const requireFromStorage = createRequire(path.join(ROOT, 'packages/storage/package.json'));
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} = requireFromStorage('@aws-sdk/client-s3');
const { getSignedUrl } = requireFromStorage('@aws-sdk/s3-request-presigner');
const ENV_FILE = path.join(ROOT, '.env');
const ENV_TEXT = readFileSync(ENV_FILE, 'utf8');

function envVar(key) {
  const lines = ENV_TEXT.split('\n').filter((l) => l.startsWith(`${key}=`));
  if (lines.length === 0) return undefined;
  return lines[lines.length - 1]
    .slice(key.length + 1)
    .trim()
    .replace(/^"|"$/g, '');
}

// Same MinIO instance the live bucket runs on -- public host with no /minio
// prefix is what gets signed; the prefix is spliced in afterward, purely as
// a string rewrite on the presigned URL, never touching the signature.
const SIGN_ENDPOINT = 'https://app.aivastra.com';
const PRESIGN_PREFIX = 'https://app.aivastra.com/minio';

const DIST_BUCKET = envVar('DEV_SNAPSHOT_BUCKET');
const DIST_ACCESS_KEY = envVar('DEV_SNAPSHOT_ACCESS_KEY_ID');
const DIST_SECRET_KEY = envVar('DEV_SNAPSHOT_SECRET_ACCESS_KEY');

const LOCAL_ENDPOINT = envVar('R2_ENDPOINT') || 'http://127.0.0.1:9000';
const LOCAL_BUCKET = envVar('R2_BUCKET');
const LOCAL_ACCESS_KEY = envVar('MINIO_ROOT_USER');
const LOCAL_SECRET_KEY = envVar('MINIO_ROOT_PASSWORD');

const DRY_RUN = process.argv.includes('--dry-run');
const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
const CONCURRENCY = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : 8;

for (const [name, val] of Object.entries({
  DIST_BUCKET,
  DIST_ACCESS_KEY,
  DIST_SECRET_KEY,
  LOCAL_BUCKET,
  LOCAL_ACCESS_KEY,
  LOCAL_SECRET_KEY,
})) {
  if (!val) {
    console.error(`missing ${name} in .env`);
    process.exit(1);
  }
}

const signClient = new S3Client({
  endpoint: SIGN_ENDPOINT,
  region: 'auto',
  forcePathStyle: true,
  credentials: { accessKeyId: DIST_ACCESS_KEY, secretAccessKey: DIST_SECRET_KEY },
});

const localClient = new S3Client({
  endpoint: LOCAL_ENDPOINT,
  region: 'auto',
  forcePathStyle: true,
  credentials: { accessKeyId: LOCAL_ACCESS_KEY, secretAccessKey: LOCAL_SECRET_KEY },
});

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  json: 'application/json',
};

function guessContentType(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

async function presignedFetch(command) {
  const url = await getSignedUrl(signClient, command, { expiresIn: 300 });
  const proxied = url.replace(SIGN_ENDPOINT, PRESIGN_PREFIX);
  const res = await fetch(proxied);
  if (!res.ok) {
    throw new Error(`${command.constructor.name} ${proxied} -> ${res.status} ${await res.text()}`);
  }
  return res;
}

function unescapeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Minimal hand-rolled parse of ListObjectsV2's flat XML shape -- no XML
// parser is a hoisted dependency anywhere in this workspace, and the
// response has no nesting beyond one <Contents> level, so regex is enough.
function parseListResponse(xml) {
  const keys = [];
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while ((m = contentsRe.exec(xml))) {
    const block = m[1];
    const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(block);
    const sizeMatch = /<Size>([\s\S]*?)<\/Size>/.exec(block);
    if (keyMatch) {
      keys.push({ key: unescapeXml(keyMatch[1]), size: sizeMatch ? Number(sizeMatch[1]) : 0 });
    }
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const tokenMatch = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
  return { keys, truncated, nextToken: tokenMatch ? unescapeXml(tokenMatch[1]) : undefined };
}

async function listAllObjects() {
  const all = [];
  let token;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: DIST_BUCKET,
      ContinuationToken: token,
      MaxKeys: 1000,
    });
    const res = await presignedFetch(cmd);
    const { keys, truncated, nextToken } = parseListResponse(await res.text());
    all.push(...keys);
    token = truncated ? nextToken : undefined;
  } while (token);
  return all;
}

async function ensureLocalBucket() {
  try {
    await localClient.send(new HeadBucketCommand({ Bucket: LOCAL_BUCKET }));
  } catch {
    await localClient.send(new CreateBucketCommand({ Bucket: LOCAL_BUCKET }));
  }
}

async function pullOne(obj, attempt = 1) {
  try {
    const res = await presignedFetch(new GetObjectCommand({ Bucket: DIST_BUCKET, Key: obj.key }));
    const body = Buffer.from(await res.arrayBuffer());
    await localClient.send(
      new PutObjectCommand({
        Bucket: LOCAL_BUCKET,
        Key: obj.key,
        Body: body,
        ContentType: guessContentType(obj.key),
      }),
    );
  } catch (err) {
    if (attempt < 3) return pullOne(obj, attempt + 1);
    throw err;
  }
}

async function runPool(items, limit, worker) {
  let next = 0;
  let completed = 0;
  async function spawn() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
      completed += 1;
      if (completed % 200 === 0 || completed === items.length) {
        console.log(`   ${completed}/${items.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, spawn));
}

async function main() {
  console.log(`-> listing ${DIST_BUCKET}`);
  const objects = (await listAllObjects()).filter((o) => !o.key.startsWith('db/'));
  const totalGiB = objects.reduce((sum, o) => sum + o.size, 0) / 1024 ** 3;
  console.log(`   ${objects.length} objects, ${totalGiB.toFixed(2)} GiB`);

  if (DRY_RUN) {
    console.log(
      `DRY-RUN: would mirror these into local bucket ${LOCAL_BUCKET} at ${LOCAL_ENDPOINT}`,
    );
    return;
  }

  console.log(`-> ensuring local bucket ${LOCAL_BUCKET} exists`);
  await ensureLocalBucket();

  console.log(`-> pulling ${objects.length} objects (concurrency ${CONCURRENCY})`);
  await runPool(objects, CONCURRENCY, pullOne);

  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
