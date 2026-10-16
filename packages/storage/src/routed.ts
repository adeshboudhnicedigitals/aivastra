import type { StorageProvider } from './index.js';
import { backendFor, type StorageBackend, UnroutableKeyError } from './routing.js';

export type FallbackOp = 'getObject' | 'headObject' | 'presignGet';

export interface RoutedStorageOptions {
  /** VPS MinIO — admin assets and merchant library content. */
  asset: StorageProvider;
  /** Cloudflare R2 — end-user inputs and outputs. Omitted (staging, local dev,
   *  tests) means every key is served by `asset`, exactly as before the split. */
  user?: StorageProvider;
  /**
   * Migration window: a `user` key that R2 reports missing is retried against
   * `asset`, where every object written before the cutover still lives. Writes
   * never fall back — new objects go to R2 only — and deletes hit both, so a
   * retention or GDPR delete can't leave the pre-cutover copy behind.
   */
  readFallback?: boolean;
  /** Called on every read served by the fallback — wire to a log + metric so
   *  it's visible when the fallback has stopped being needed. */
  onFallback?: (key: string, op: FallbackOp) => void;
  /** Called when a read or delete names a key with no routing rule (served from
   *  `asset`) — a bad DB row or a key shape missing from routing.ts. */
  onUnroutedRead?: (key: string) => void;
}

/** S3's not-found errors differ by call: HEAD → `NotFound` (no body to carry a
 *  code), GET → `NoSuchKey`. The status code covers either. */
export function isNotFoundError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/**
 * A StorageProvider that sends each key to the backend `backendFor` assigns it.
 *
 * Unrouted keys are treated asymmetrically, in every environment (including
 * when `user` is omitted, so a gap shows up on staging and in tests first):
 *  - writes throw UnroutableKeyError — new data under an unknown shape would
 *    land on whichever backend happened to be the default, silently.
 *  - reads and deletes go to `asset`. Any object under an unknown shape can
 *    only predate the split, and everything that predates it lives on `asset`.
 *    Throwing here instead would turn one bad key in one DB row into a 500 for
 *    a whole listing endpoint, where it used to be one dead image link.
 */
export function createRoutedStorage(opts: RoutedStorageOptions): StorageProvider {
  const { asset, user, readFallback = false, onFallback, onUnroutedRead } = opts;

  const providerFor = (backend: StorageBackend | null): StorageProvider =>
    backend === 'user' && user ? user : asset;
  const writeTarget = (key: string): StorageProvider => providerFor(backendFor(key));
  const readBackend = (key: string): StorageBackend | null => {
    try {
      return backendFor(key);
    } catch (err) {
      if (!(err instanceof UnroutableKeyError)) throw err;
      onUnroutedRead?.(key);
      return null;
    }
  };
  // True only for a user-backend key while the migration fallback is on.
  const fallsBack = (backend: StorageBackend | null): boolean =>
    readFallback && user !== undefined && backend === 'user';

  async function readWithFallback<T>(
    key: string,
    op: FallbackOp,
    read: (p: StorageProvider) => Promise<T>,
  ): Promise<T> {
    const backend = readBackend(key);
    if (!fallsBack(backend)) return read(providerFor(backend));
    try {
      return await read(user as StorageProvider);
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
      onFallback?.(key, op);
      return read(asset);
    }
  }

  return {
    // async throughout so an unrouted key always surfaces as a rejection, never
    // a synchronous throw a caller's .catch() wouldn't see.
    presignPut: async (key, contentType, contentLength, expiresIn) =>
      writeTarget(key).presignPut(key, contentType, contentLength, expiresIn),

    presignGet: async (key, expiresIn) => {
      const backend = readBackend(key);
      if (!fallsBack(backend)) return providerFor(backend).presignGet(key, expiresIn);
      // A presigned URL can't fail over on its own, so look first. Any HEAD
      // error other than not-found presigns against R2 as normal — the caller
      // is no worse off than without the fallback.
      try {
        await (user as StorageProvider).headObject(key);
      } catch (err) {
        if (isNotFoundError(err)) {
          onFallback?.(key, 'presignGet');
          return asset.presignGet(key, expiresIn);
        }
      }
      return (user as StorageProvider).presignGet(key, expiresIn);
    },

    getObject: async (key) => readWithFallback(key, 'getObject', (p) => p.getObject(key)),
    headObject: async (key) => readWithFallback(key, 'headObject', (p) => p.headObject(key)),

    putObject: async (key, body, contentType) => writeTarget(key).putObject(key, body, contentType),

    deleteObject: async (key) => {
      const backend = readBackend(key);
      await providerFor(backend).deleteObject(key);
      // S3 DELETE of an absent key succeeds, so this is safe for objects that
      // were only ever written to R2.
      if (fallsBack(backend)) await asset.deleteObject(key);
    },

    listObjects: async (prefix) => {
      const backend = readBackend(prefix);
      const primary = await providerFor(backend).listObjects(prefix);
      if (!fallsBack(backend)) return primary;
      // Same key on both sides (overwritten after cutover): report it once,
      // with R2's metadata, since R2 is where reads resolve first.
      const seen = new Set(primary.map((o) => o.key));
      const legacy = (await asset.listObjects(prefix)).filter((o) => !seen.has(o.key));
      return [...primary, ...legacy];
    },

    publicUrl: (key) => providerFor(readBackend(key)).publicUrl(key),
  };
}
