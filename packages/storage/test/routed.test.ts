import { describe, expect, it, vi } from 'vitest';
import type { StorageProvider } from '../src/index.js';
import { createRoutedStorage, isNotFoundError } from '../src/routed.js';
import { UnroutableKeyError } from '../src/routing.js';

/** In-memory provider whose not-found errors have the shape the AWS SDK throws. */
function memoryProvider(name: string) {
  const objects = new Map<string, Buffer>();
  const notFound = (code: 'NotFound' | 'NoSuchKey') =>
    Object.assign(new Error(code), { name: code, $metadata: { httpStatusCode: 404 } });
  const provider: StorageProvider = {
    presignPut: async (key) => ({ url: `${name}://put/${key}`, expiresIn: 300 }),
    presignGet: async (key) => ({ url: `${name}://get/${key}`, expiresIn: 300 }),
    deleteObject: async (key) => {
      objects.delete(key);
    },
    putObject: async (key, body) => {
      objects.set(key, Buffer.from(body));
    },
    getObject: async (key) => {
      const o = objects.get(key);
      if (!o) throw notFound('NoSuchKey');
      return o;
    },
    headObject: async (key) => {
      const o = objects.get(key);
      if (!o) throw notFound('NotFound');
      return { contentLength: o.length, contentType: null };
    },
    listObjects: async (prefix) =>
      [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key, lastModified: undefined })),
    publicUrl: (key) => `${name}://public/${key}`,
  };
  return { provider, objects };
}

const USER_KEY = 'outputs/job-1/result.png';
const ASSET_KEY = 'models/faces/f-1.jpg';
const buf = (s: string) => Buffer.from(s);

describe('createRoutedStorage — no user backend (staging, local dev)', () => {
  it('serves every key from the asset backend', async () => {
    const asset = memoryProvider('vps');
    const s = createRoutedStorage({ asset: asset.provider });
    await s.putObject(USER_KEY, buf('out'), 'image/png');
    await s.putObject(ASSET_KEY, buf('face'), 'image/jpeg');
    expect(asset.objects.size).toBe(2);
    expect((await s.presignGet(USER_KEY)).url).toBe(`vps://get/${USER_KEY}`);
  });

  it('still rejects unrouted writes, so they fail here before production', async () => {
    const s = createRoutedStorage({ asset: memoryProvider('vps').provider });
    await expect(s.putObject('mystery/x.jpg', buf('x'), 'image/jpeg')).rejects.toThrow(
      UnroutableKeyError,
    );
    await expect(s.presignPut('mystery/x.jpg', 'image/jpeg', 1)).rejects.toThrow(
      UnroutableKeyError,
    );
  });
});

describe('createRoutedStorage — split, no fallback', () => {
  it('routes each key to its own backend', async () => {
    const asset = memoryProvider('vps');
    const user = memoryProvider('r2');
    const s = createRoutedStorage({ asset: asset.provider, user: user.provider });
    await s.putObject(USER_KEY, buf('out'), 'image/png');
    await s.putObject(ASSET_KEY, buf('face'), 'image/jpeg');
    expect([...user.objects.keys()]).toEqual([USER_KEY]);
    expect([...asset.objects.keys()]).toEqual([ASSET_KEY]);
    expect((await s.presignPut(USER_KEY, 'image/png', 1)).url).toBe(`r2://put/${USER_KEY}`);
    expect((await s.presignGet(ASSET_KEY)).url).toBe(`vps://get/${ASSET_KEY}`);
    expect(s.publicUrl(USER_KEY)).toBe(`r2://public/${USER_KEY}`);
  });

  it('does not read a user key from the asset backend', async () => {
    const asset = memoryProvider('vps');
    const user = memoryProvider('r2');
    asset.objects.set(USER_KEY, buf('legacy'));
    const s = createRoutedStorage({ asset: asset.provider, user: user.provider });
    await expect(s.getObject(USER_KEY)).rejects.toMatchObject({ name: 'NoSuchKey' });
  });
});

describe('createRoutedStorage — unrouted keys', () => {
  it('serves unrouted reads and deletes from the asset backend, reporting each once', async () => {
    const asset = memoryProvider('vps');
    const user = memoryProvider('r2');
    const onUnroutedRead = vi.fn();
    const s = createRoutedStorage({
      asset: asset.provider,
      user: user.provider,
      readFallback: true,
      onUnroutedRead,
    });
    asset.objects.set('legacy-shape/x.jpg', buf('old'));
    expect((await s.getObject('legacy-shape/x.jpg')).toString()).toBe('old');
    expect((await s.presignGet('pose-thumb.jpg')).url).toBe('vps://get/pose-thumb.jpg');
    await s.deleteObject('legacy-shape/x.jpg');
    expect(asset.objects.has('legacy-shape/x.jpg')).toBe(false);
    expect(onUnroutedRead.mock.calls).toEqual([
      ['legacy-shape/x.jpg'],
      ['pose-thumb.jpg'],
      ['legacy-shape/x.jpg'],
    ]);
  });

  it('still refuses unrouted writes when R2 is configured', async () => {
    const s = createRoutedStorage({
      asset: memoryProvider('vps').provider,
      user: memoryProvider('r2').provider,
    });
    await expect(s.putObject('legacy-shape/x.jpg', buf('x'), 'image/jpeg')).rejects.toThrow(
      UnroutableKeyError,
    );
  });
});

describe('createRoutedStorage — split with read fallback (production migration window)', () => {
  function setup() {
    const asset = memoryProvider('vps');
    const user = memoryProvider('r2');
    const onFallback = vi.fn();
    const s = createRoutedStorage({
      asset: asset.provider,
      user: user.provider,
      readFallback: true,
      onFallback,
    });
    return { asset, user, onFallback, s };
  }

  it('reads from R2 first and does not report a fallback on a hit', async () => {
    const { asset, user, onFallback, s } = setup();
    user.objects.set(USER_KEY, buf('new'));
    asset.objects.set(USER_KEY, buf('legacy'));
    expect((await s.getObject(USER_KEY)).toString()).toBe('new');
    expect((await s.presignGet(USER_KEY)).url).toBe(`r2://get/${USER_KEY}`);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('falls back to MinIO for pre-cutover objects, and reports each fallback', async () => {
    const { asset, onFallback, s } = setup();
    asset.objects.set(USER_KEY, buf('legacy'));
    expect((await s.getObject(USER_KEY)).toString()).toBe('legacy');
    expect((await s.headObject(USER_KEY)).contentLength).toBe(6);
    expect((await s.presignGet(USER_KEY)).url).toBe(`vps://get/${USER_KEY}`);
    expect(onFallback.mock.calls).toEqual([
      [USER_KEY, 'getObject'],
      [USER_KEY, 'headObject'],
      [USER_KEY, 'presignGet'],
    ]);
  });

  it('surfaces not-found when the object is on neither backend', async () => {
    const { s } = setup();
    await expect(s.getObject(USER_KEY)).rejects.toSatisfy(isNotFoundError);
  });

  it('does not fall back on errors other than not-found', async () => {
    const { asset, user, s } = setup();
    asset.objects.set(USER_KEY, buf('legacy'));
    user.provider.getObject = async () => {
      throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' });
    };
    await expect(s.getObject(USER_KEY)).rejects.toThrow('AccessDenied');
  });

  it('writes new objects to R2 only', async () => {
    const { asset, user, s } = setup();
    await s.putObject(USER_KEY, buf('new'), 'image/png');
    expect(user.objects.has(USER_KEY)).toBe(true);
    expect(asset.objects.has(USER_KEY)).toBe(false);
  });

  it('deletes a user key from both backends, so no legacy copy survives retention or GDPR', async () => {
    const { asset, user, s } = setup();
    user.objects.set(USER_KEY, buf('new'));
    asset.objects.set(USER_KEY, buf('legacy'));
    await s.deleteObject(USER_KEY);
    expect(user.objects.has(USER_KEY)).toBe(false);
    expect(asset.objects.has(USER_KEY)).toBe(false);
  });

  it('lists a user prefix across both backends, without duplicates', async () => {
    const { asset, user, s } = setup();
    user.objects.set('inputs/a/garment.jpg', buf('a'));
    user.objects.set('inputs/b/garment.jpg', buf('b'));
    asset.objects.set('inputs/b/garment.jpg', buf('b-legacy'));
    asset.objects.set('inputs/c/garment.jpg', buf('c'));
    const listed = (await s.listObjects('inputs/')).map((o) => o.key).sort();
    expect(listed).toEqual([
      'inputs/a/garment.jpg',
      'inputs/b/garment.jpg',
      'inputs/c/garment.jpg',
    ]);
  });

  it('never involves R2 for asset keys', async () => {
    const { asset, user, onFallback, s } = setup();
    asset.objects.set(ASSET_KEY, buf('face'));
    user.objects.set(ASSET_KEY, buf('stray'));
    expect((await s.getObject(ASSET_KEY)).toString()).toBe('face');
    await s.deleteObject(ASSET_KEY);
    expect(user.objects.has(ASSET_KEY)).toBe(true);
    expect(onFallback).not.toHaveBeenCalled();
  });
});
